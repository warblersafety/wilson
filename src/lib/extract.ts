// The real ExtractFn (Issue #22, widened in Issue #44) — src/lib/talk.ts's
// ExtractFn port, backed by a live Claude Sonnet 5 call via the
// `wilson-evals` Anthropic key (docs/SECRETS-AND-COSTS.md).
//
// This module is the wiring only. The widened prompt lives in
// src/prompts/extractor.ts (buildFollowUpExtractorSystem/
// buildFollowUpUserContent); the grounding/turn-index/legal-option check
// that decides what's even a candidate lives in
// src/lib/extraction-validator.ts; the write-policy decision (direct
// write vs. correction offer vs. collision vs. later-instance suggestion)
// lives in src/lib/followup-sweep.ts. Nothing here re-implements any of
// that — a candidate's quote is trusted only after validateCandidates()
// confirms it, and what happens to an accepted candidate is decided only
// by classifyFollowUpActions().
import Anthropic from "@anthropic-ai/sdk";
import { sharedAnthropicClient } from "./anthropic-client";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTOR_MODEL,
  buildFollowUpExtractorSystem,
  buildFollowUpUserContent,
} from "../prompts/extractor";
import { ALL_FIELD_TYPES, validateCandidates, validateRepeatCandidate } from "./extraction-validator";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import { classifyFollowUpActions, describeFollowUpSweep } from "./followup-sweep";
import type { ExtractFn, ExtractResult, TalkSession, TalkTurn } from "./talk";
import { TOPICS, nextStep, openFollowUpFields, type Topic } from "./topics";

// Extraction is keyed to the step that was actually asked, not re-derived
// from message phrasing — computed from `session`'s PRE-turn state, which
// is exactly the state nextStep() saw when it produced the step the
// clinician's message is now answering (processTurn calls extract() before
// applying this turn's writes, so nothing has changed in between).
//
// `topics`/`fields` must be the SAME arrays a caller passes as
// processTurn's own `Deps.topics`/`Deps.fields` — nextStep() is only
// guaranteed to recompute the step processTurn's respond() already saw
// when both calls agree on what the topic map and field manifest are.
// There is currently exactly one production call site and it takes both
// defaults, so this can't diverge today; a future caller overriding one
// set without the other would silently extract against the wrong step.
export function createExtractFn(
  client: Anthropic = sharedAnthropicClient(),
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): ExtractFn {
  return async (session: TalkSession, message: string): Promise<ExtractResult> => {
    const step = nextStep(session.record, session.repeatCounts, topics, fields);
    if (step.kind === "done") {
      return { actions: [] };
    }

    // Includes the clinician's latest message so its index matches what
    // the model is told to cite (session.transcript doesn't have it yet —
    // processTurn only appends it after extract() returns). This same
    // array, not session.transcript, is what grounding is checked against
    // below, and its last index is the ONLY turn a candidate may cite
    // (Issue #44, design.md's citation-pool rule — resolves #59).
    const transcript: TalkTurn[] = [...session.transcript, { role: "clinician", text: message }];
    const currentTurnIndex = transcript.length - 1;

    // The widened field-target set (Issue #44): the ask's own fields,
    // plus every other currently `unasked`/`unknown` field, excluding
    // repeat-instance 2+ — named in the per-turn prompt suffix, never
    // carved out of the cached system prompt (design.md's cost posture).
    const openFields = openFollowUpFields(session.record, topics, fields);

    // step.fieldIds, uncapped, is now exactly right: with authored asks
    // it IS the set of facts the visible question named (topics.ts's
    // NextStep). The old MAX_FIELDS_PER_ASK slice existed because
    // nextStep() returned every unresolved field of a topic while the
    // template phrased only the first three, and classifying a candidate
    // for the 4th+ as "in-ask" would announce nothing for a write the
    // clinician was never asked about — exactly the invisible write
    // design.md forbids. That gap is closed at the source, not re-sliced
    // here. Still computed before the model call, because it is the
    // single source for BOTH what classifyFollowUpActions() treats as
    // in-ask and what the per-turn prompt tells the model this turn's ask
    // named (buildFollowUpUserContent() below) — one value, so the two
    // cannot drift apart.
    const askFieldIds = step.kind === "topic" ? step.fieldIds : [];

    const response = await client.messages.parse({
      model: EXTRACTOR_MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: buildFollowUpExtractorSystem(fields, topics), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildFollowUpUserContent(step, askFieldIds, openFields, transcript) }],
      output_config: { format: zodOutputFormat(EXTRACTION_RESPONSE_SCHEMA) },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      // `parsed_output` is genuinely null only for a response with no text
      // block at all (empty content, or a thinking/tool_use-only response)
      // — a degenerate case, failed closed here with no field writes and
      // no repeat decision.
      //
      // It is NOT what catches a malformed or truncated response: the
      // SDK's structured-output parser throws on invalid JSON or a Zod
      // validation failure rather than returning null (verified against
      // the installed @anthropic-ai/sdk). That throw is deliberately not
      // caught here either — letting it reject this function's promise is
      // the honest signal that extraction broke, which a caller can only
      // tell apart from "the turn had nothing reportable in it" if the
      // distinction survives.
      //
      // This comment used to say "structured-output parsing failed
      // (malformed model response)", which read as though this branch
      // were the app's defence against a bad response when the throw is
      // (warblersafety/wilson#54; #41 corrected the same wording on its
      // own copy in narrative-extract.ts).
      return { actions: [] };
    }

    // Checked against the FULL manifest (fields, not openFields) and
    // every field type (ALL_FIELD_TYPES, not the old ["text","date"]
    // default): a correction to an already-answered field, or a
    // volunteered later-instance mention, targets a field outside the
    // "open" set on purpose — see followup-sweep.ts's classification,
    // which is what actually decides whether an accepted candidate here
    // gets written, offered, or turned into a suggestion.
    const { accepted } = validateCandidates(transcript, parsed.candidates, fields, ALL_FIELD_TYPES, currentTurnIndex);

    // askFieldIds computed above, before the model call — see its own
    // comment for why this is the single source shared with the prompt.
    const classified = classifyFollowUpActions(accepted, session.record, askFieldIds, topics);
    const replyPrefix = describeFollowUpSweep(classified, fields);

    // Only ever considered when the step actually open right now is a
    // repeat-decision — never on an ordinary topic turn. Without this
    // gate, a model mis-fire during a normal field-answering turn could
    // silently commit a repeat-group count (e.g. fabricating or
    // foreclosing a second suspect product on this FDA adverse-event
    // report) with nothing deterministic standing in the way but prompt
    // wording. validateRepeatCandidate() independently re-checks the
    // group match too, as defense in depth, and now the turn-index too.
    let repeatDecision: ExtractResult["repeatDecision"];
    if (parsed.repeatDecision && step.kind === "repeat-decision") {
      const grounded = validateRepeatCandidate(transcript, parsed.repeatDecision, step.repeatGroup, currentTurnIndex);
      if (grounded.accepted) {
        repeatDecision = {
          repeatGroup: parsed.repeatDecision.repeatGroup,
          count: parsed.repeatDecision.count,
        };
      }
    }

    return {
      actions: classified.writes,
      repeatDecision,
      replyPrefix: replyPrefix.length > 0 ? replyPrefix : undefined,
      correctionOffers: classified.correctionOffers.length > 0 ? classified.correctionOffers : undefined,
      volunteeredRepeatGroups: classified.volunteeredRepeatGroups.length > 0 ? classified.volunteeredRepeatGroups : undefined,
    };
  };
}
