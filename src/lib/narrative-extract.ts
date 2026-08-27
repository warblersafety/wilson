// The real narrative-extraction pass (Issue #41) — src/lib/extract.ts's
// per-turn ExtractFn sweeps only the current step's ≤3 fields; this sweeps
// every open field across every currently-reachable topic in one call over
// the clinician's opening dictated narrative, per design.md's "Interaction
// model and UI" (dictation-first) and "Extraction scope".
//
// Library-level only: this module produces PROPOSALS and a batch-apply
// step, nothing more. It does not decide when to call the model, how a
// clinician confirms or edits a proposal, or how the resulting session
// continues into follow-ups — that orchestration belongs to the units that
// actually have the read-back UI (#42 Start, #43 Read-back) to drive it.
import Anthropic from "@anthropic-ai/sdk";
import { sharedAnthropicClient } from "./anthropic-client";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  NARRATIVE_EXTRACTION_RESPONSE_SCHEMA,
  NARRATIVE_EXTRACTOR_SYSTEM,
  buildNarrativeExtractionUserContent,
  type NarrativeExtractionResponse,
} from "../prompts/narrative-extractor";
import { EXTRACTOR_MODEL } from "../prompts/extractor";
import type { AgendaRecord } from "./agenda";
import { applyProposedActions, type ProposedAction, type TalkSession, type TalkTurn } from "./talk";
import {
  ALL_FIELD_TYPES,
  validateCandidates,
  validateRepeatCandidate,
  type Quote,
  type RejectedCandidate,
} from "./extraction-validator";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import {
  TOPICS,
  isValidRepeatCount,
  narrativePassFields,
  setRepeatCount,
  type RepeatCounts,
  type RepeatGroup,
  type Topic,
} from "./topics";
import { bareAgeDefaultWrites } from "./derive";
import { filterLabRowOverflow } from "./gates";

export interface NarrativeProposal {
  action: ProposedAction;
  // quote.turnIndex is always 0: it indexes into the single-clinician-turn
  // transcript this pass constructs internally ([{role:"clinician", text:
  // narrative}]), not necessarily session.transcript (which may already
  // hold other turns, or not yet include this narrative at all — this
  // module never appends to it). A caller highlighting the quote within
  // the displayed narrative should match quote.text against the narrative
  // string directly, not index into session.transcript with it.
  quote: Quote;
}

export interface NarrativeExtractResult {
  proposals: NarrativeProposal[];
  repeatDecisions: { repeatGroup: RepeatGroup; count: number }[];
  rejected: RejectedCandidate[];
}

export type NarrativeExtractFn = (session: TalkSession, narrative: string) => Promise<NarrativeExtractResult>;

// A fresh literal, not a shared const: this is returned by reference from
// two call sites below, and its arrays are ordinary mutable arrays — a
// caller that ever mutates a returned result in place (e.g. a read-back UI
// merging in an edit) would otherwise corrupt every subsequent empty
// result for the lifetime of this module, across unrelated sessions in a
// long-lived server process (reviewer pass, finding).
function emptyResult(): NarrativeExtractResult {
  return { proposals: [], repeatDecisions: [], rejected: [] };
}

// The pure core: given a transcript, an (real or scripted/fake) extraction
// response, and the fields this pass actually offered as targets, apply the
// real grounding/legality checks and shape the result. Exported so
// scripts/eval-narrative-extraction.ts's dry (API-free) mode can prove the
// fixture corpus's expected accepted/rejected sets against this exact
// logic — the same one a real model call feeds below — rather than a
// second, hand-derived copy of it that could silently drift.
export function resolveNarrativeExtraction(
  transcript: TalkTurn[],
  response: NarrativeExtractionResponse,
  openFields: FormFieldSpec[],
  topics: Topic[] = TOPICS,
): NarrativeExtractResult {
  // openFields, not the full manifest: a candidate targeting a
  // repeat-instance-2+ field (never offered above) is refused the same
  // deterministic way an unknown field id already is — it's simply absent
  // from the fields list validateCandidates checks against.
  const { accepted, rejected } = validateCandidates(transcript, response.candidates, openFields, ALL_FIELD_TYPES);
  // Recovers each accepted candidate's quote for read-back pairing:
  // `accepted` (ProposedAction[]) and `rejected` (which retains full
  // ExtractionCandidate objects) are both derived from `response.candidates`
  // by the same linear, per-candidate-independent scan, so filtering out
  // exactly what ended up in `rejected` (by reference) recovers the
  // accepted subset in the same order `accepted` is in — without
  // extraction-validator.ts needing to carry quotes through its own return
  // shape, which extract.ts's existing caller never needed.
  const rejectedCandidates = new Set(rejected.map((r) => r.candidate));
  const acceptedCandidates = response.candidates.filter((c) => !rejectedCandidates.has(c));
  const proposals: NarrativeProposal[] = accepted.map((action, i) => ({
    action,
    quote: acceptedCandidates[i].quote,
  }));

  // Each candidate validated against the group it itself names — for this
  // pass there is no single "the question being asked" the way a per-turn
  // repeat-decision step has, so the only real check is quote grounding
  // (validateRepeatCandidate's group-match check becomes a tautology
  // against the candidate's own group, deliberately) — PLUS a range check
  // neither validateRepeatCandidate nor the schema performs: a count is
  // `z.number().int()`, unbounded. Without this, an out-of-range count
  // (e.g. 3 "suspect products" when the form has 2 slots) would sail
  // through as an accepted, confirmable proposal and only fail later, at
  // applyNarrativeProposals's setRepeatCount call — where the whole
  // confirmed batch's object-literal return throws before any of it comes
  // back, discarding every other field answer confirmed alongside it, not
  // just the bad count (reviewer pass, finding).
  const acceptedRepeats = response.repeatDecisions.filter(
    (candidate) =>
      validateRepeatCandidate(transcript, candidate, candidate.repeatGroup).accepted &&
      isValidRepeatCount(candidate.repeatGroup, candidate.count, topics),
  );
  // At most one decision per group — first-accepted wins. Two proposals
  // for the same group is a mis-fire regardless of which is "right";
  // picking deterministically keeps the outcome reproducible rather than
  // depending on array order silently mattering to a caller.
  const seenGroups = new Set<RepeatGroup>();
  const repeatDecisions: { repeatGroup: RepeatGroup; count: number }[] = [];
  for (const candidate of acceptedRepeats) {
    if (seenGroups.has(candidate.repeatGroup)) continue;
    seenGroups.add(candidate.repeatGroup);
    repeatDecisions.push({ repeatGroup: candidate.repeatGroup, count: candidate.count });
  }

  return { proposals, repeatDecisions, rejected };
}

export function createNarrativeExtractFn(
  client: Anthropic = sharedAnthropicClient(),
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): NarrativeExtractFn {
  return async (session: TalkSession, narrative: string): Promise<NarrativeExtractResult> => {
    const openFields = narrativePassFields(session.record, topics, fields);
    if (openFields.length === 0) {
      return emptyResult();
    }

    // The opening narrative is the landing (design.md: "No separate
    // landing page; this is the landing") — turnIndex 0 is the whole
    // transcript this call grounds against, not one turn in a longer one.
    const transcript: TalkTurn[] = [{ role: "clinician", text: narrative }];

    const response = await client.messages.parse({
      model: EXTRACTOR_MODEL,
      // Larger than extract.ts's per-turn 4096: this call can legitimately
      // ground candidates across dozens of fields in one response, not ≤3.
      max_tokens: 8192,
      system: [{ type: "text", text: NARRATIVE_EXTRACTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildNarrativeExtractionUserContent(narrative, openFields) }],
      output_config: { format: zodOutputFormat(NARRATIVE_EXTRACTION_RESPONSE_SCHEMA) },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      // `parsed_output` is genuinely null only for a response with no text
      // block at all (empty content, or a thinking/tool_use-only response)
      // — a degenerate case, failed closed here. It is NOT what catches a
      // malformed/truncated response: the SDK's structured-output parser
      // throws on invalid JSON or a Zod validation failure rather than
      // returning null (verified against the installed
      // @anthropic-ai/sdk — same behavior in the pre-existing
      // src/lib/extract.ts, which copies this same check). That throw is
      // deliberately NOT caught here: letting it reject this function's
      // promise, rather than silently returning "nothing extracted", is
      // the honest signal for the one round of this whole app that a
      // clinician's dictated narrative could genuinely fail to process —
      // a caller can tell "extraction broke, try again" apart from "your
      // narrative had nothing reportable in it" only if this distinction
      // survives.
      return emptyResult();
    }

    return resolveNarrativeExtraction(transcript, parsed, openFields, topics);
  };
}

// The confirmed-batch apply step (design.md, AC #2 of Issue #41): whatever
// subset of a NarrativeExtractResult's proposals the clinician actually
// confirmed on read-back, written through the same write path
// processTurn() uses (talk.ts's applyProposedActions) — one Agenda write
// path, not two. Takes plain actions/decisions rather than a
// NarrativeExtractResult itself: which proposals were confirmed is a UI
// decision this library-level unit doesn't make.
export function applyNarrativeProposals(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  actions: ProposedAction[],
  repeatDecisions: { repeatGroup: RepeatGroup; count: number }[],
  topics: Topic[] = TOPICS,
): { record: AgendaRecord; repeatCounts: RepeatCounts } {
  // ask-copy.md rule 3's bare-age default applies here too: this is a
  // write path, and an age dictated as "61-year-old" must not leave four
  // unit checkboxes open just because it arrived through Read-back
  // instead of a follow-up turn (reviewer pass, PR #106, F4). Group
  // completion is deliberately absent — it is bounded by what an ask
  // voiced, and a narrative voices nothing.
  const withDerives = filterLabRowOverflow(record, [...actions, ...bareAgeDefaultWrites(record, actions)]);
  return {
    record: applyProposedActions(record, withDerives),
    repeatCounts: repeatDecisions.reduce(
      (counts, decision) => setRepeatCount(counts, decision.repeatGroup, decision.count, topics),
      repeatCounts,
    ),
  };
}
