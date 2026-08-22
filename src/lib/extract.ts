// The real ExtractFn (Issue #22) — src/lib/talk.ts's ExtractFn port, backed
// by a live Claude Sonnet 5 call via the `wilson-evals` Anthropic key
// (docs/SECRETS-AND-COSTS.md). Deferred from Issues #11/#13/#18 as the same
// kind of interpretation work each of those explicitly left out of scope.
//
// This module is the wiring only — the prompt lives in
// src/prompts/extractor.ts, and the grounding check that decides what
// survives lives in src/lib/extraction-validator.ts. Nothing here is a
// second copy of that grounding logic: a candidate's quote is trusted only
// after validateCandidates()/validateRepeatCandidate() confirm it's real.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTOR_MODEL,
  EXTRACTOR_SYSTEM,
  buildExtractionUserContent,
} from "../prompts/extractor";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import { validateCandidates, validateRepeatCandidate } from "./extraction-validator";
import type { ExtractFn, ExtractResult, TalkSession, TalkTurn } from "./talk";
import { TOPICS, nextStep, type Topic } from "./topics";

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
  client: Anthropic = new Anthropic(),
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
    // below.
    const transcript: TalkTurn[] = [...session.transcript, { role: "clinician", text: message }];

    const response = await client.messages.parse({
      model: EXTRACTOR_MODEL,
      max_tokens: 4096,
      system: [{ type: "text", text: EXTRACTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: buildExtractionUserContent(step, fields, transcript) }],
      output_config: { format: zodOutputFormat(EXTRACTION_RESPONSE_SCHEMA) },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      // Structured-output parsing failed (malformed model response). Fail
      // closed — no field writes, no repeat decision — rather than risk
      // acting on a partially-parsed guess.
      return { actions: [] };
    }

    const { accepted } = validateCandidates(transcript, parsed.candidates, fields);

    // Only ever considered when the step actually open right now is a
    // repeat-decision — never on an ordinary topic turn. Without this
    // gate, a model mis-fire during a normal field-answering turn could
    // silently commit a repeat-group count (e.g. fabricating or
    // foreclosing a second suspect product on this FDA adverse-event
    // report) with nothing deterministic standing in the way but prompt
    // wording. validateRepeatCandidate() independently re-checks the
    // group match too, as defense in depth.
    let repeatDecision: ExtractResult["repeatDecision"];
    if (parsed.repeatDecision && step.kind === "repeat-decision") {
      const grounded = validateRepeatCandidate(transcript, parsed.repeatDecision, step.repeatGroup);
      if (grounded.accepted) {
        repeatDecision = {
          repeatGroup: parsed.repeatDecision.repeatGroup,
          count: parsed.repeatDecision.count,
        };
      }
    }

    return { actions: accepted, repeatDecision };
  };
}
