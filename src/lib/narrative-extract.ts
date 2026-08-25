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
  narrativePassFields,
  setRepeatCount,
  type RepeatCounts,
  type RepeatGroup,
  type Topic,
} from "./topics";

export interface NarrativeProposal {
  action: ProposedAction;
  quote: Quote;
}

export interface NarrativeExtractResult {
  proposals: NarrativeProposal[];
  repeatDecisions: { repeatGroup: RepeatGroup; count: number }[];
  rejected: RejectedCandidate[];
}

export type NarrativeExtractFn = (session: TalkSession, narrative: string) => Promise<NarrativeExtractResult>;

const EMPTY_RESULT: NarrativeExtractResult = { proposals: [], repeatDecisions: [], rejected: [] };

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
  // against the candidate's own group, deliberately).
  const acceptedRepeats = response.repeatDecisions.filter(
    (candidate) => validateRepeatCandidate(transcript, candidate, candidate.repeatGroup).accepted,
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
  client: Anthropic = new Anthropic(),
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): NarrativeExtractFn {
  return async (session: TalkSession, narrative: string): Promise<NarrativeExtractResult> => {
    const openFields = narrativePassFields(session.record, topics, fields);
    if (openFields.length === 0) {
      return EMPTY_RESULT;
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
      // Structured-output parsing failed. Fail closed — nothing proposed —
      // same posture as extract.ts's per-turn ExtractFn.
      return EMPTY_RESULT;
    }

    return resolveNarrativeExtraction(transcript, parsed, openFields);
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
  return {
    record: applyProposedActions(record, actions),
    repeatCounts: repeatDecisions.reduce(
      (counts, decision) => setRepeatCount(counts, decision.repeatGroup, decision.count, topics),
      repeatCounts,
    ),
  };
}
