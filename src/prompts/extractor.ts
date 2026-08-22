// The Extractor's prompt (Issue #22). Per docs/design.md's Extractor row
// and the charter's "clinician states facts directly" framing, this job is
// narrower than lucy's own extractor (murmurpv/lucy's
// src/prompts/extractor.ts): a clinician answers a direct question about a
// known set of fields, rather than a patient telling an ambiguous
// narrative a model has to mine for evidence. The prompt below is sized to
// that narrower job, not copied from lucy's.
//
// The deterministic grounding check in src/lib/extraction-validator.ts
// re-verifies everything this prompt promises (quote must be a real,
// literal substring of the cited clinician turn) — nothing here is
// load-bearing for safety on its own, same posture lucy documents for its
// own prompt.
import { z } from "zod";
import type { FormFieldSpec } from "../lib/form-3500-fields";
import { TOPICS, type NextStep, type RepeatGroup } from "../lib/topics";
import type { TalkTurn } from "../lib/talk";

// Derived from TOPICS' actual data, not hand-listed — topics.ts is the
// single source of truth for which repeat groups exist (RepeatGroup is a
// type only, with no runtime values of its own to import). A third repeat
// group added there is picked up here automatically; a hand-typed
// z.enum([...]) would otherwise silently under-enumerate.
const REPEAT_GROUPS = Array.from(
  new Set(TOPICS.map((t) => t.repeatGroup).filter((g): g is RepeatGroup => g !== null)),
) as [RepeatGroup, ...RepeatGroup[]];

// lucy's docs/SECRETS-AND-COSTS.md (dated 2026-07-27) named Sonnet 4.6;
// Sonnet 5 has since superseded it as the current Sonnet-tier model
// (per this account's claude-api skill reference, cached 2026-06-24). This
// unit matches lucy's chosen TIER (Sonnet, not Haiku — Issue #22's scoping
// conversation), not the specific point-release lucy happened to name.
export const EXTRACTOR_MODEL = "claude-sonnet-5";

export const EXTRACTOR_SYSTEM = `You are the extraction component of wilson, a clinician-facing tool for reporting adverse drug events to the FDA (Form 3500). Your only job: read a conversation transcript between a clinician and an intake assistant, and propose structured field values that are directly grounded in what the CLINICIAN said in their latest message.

You never converse. You never decide what to ask next. You only propose candidates with supporting evidence, and a deterministic validator decides what is actually written to the record. Candidates that fail the validator are discarded, so propose only what you can ground.

## The provenance contract (your hard rule)

Every candidate carries exactly one quote: a contiguous span copied exactly from a CLINICIAN turn (never from a talker/assistant turn, never stitched across turns). The validator rejects any quote that does not appear, after light normalization (case, punctuation, whitespace), inside the referenced clinician turn's text. Never paraphrase a quote, and never invent one.

A candidate's "quote" is not required to literally contain its "value" — clinicians phrase things referentially ("the water pill" grounds "furosemide"). What must be real is the quote itself, not a verbatim match between quote and value.

## Field candidates — text/date fields only

You will be given a specific list of open fields (id + label), each one either "text" or "date" type. Propose a candidate only for a field in that list — never invent a field id, and never propose for an enum or checkbox field (those are resolved by direct UI selection, not by you).

For each open field, decide in this order:

- Did the clinician address this field at all in their latest message — answering it directly, or volunteering it? If not, propose nothing for it. Do not fill from context, medical plausibility, or your own knowledge.
- Did they give a usable value? -> kind "value", with that value and the quote that grounds it.
- Did they explicitly say they don't know or don't have that information? -> kind "unknown".
- Did they explicitly decline to answer, or say it doesn't apply? -> kind "declined".

One clinician message can ground several field candidates at once — sweep every open field you were given, not just the first one the message seems to answer.

## Repeat-group decisions

Some conversations ask a yes/no-shaped question about whether another instance of a repeating group exists (e.g. "was there a second suspect product?", "any other concomitant medications?"). When the transcript's last TALKER turn is asking exactly that, and the clinician's latest message answers it, propose a repeatDecision instead of (or alongside) field candidates:

- repeatGroup: the group name given to you for this question.
- count: the total number of instances the clinician has now confirmed exist, INCLUDING the one(s) already established. "No, that's the only one" after suspect-product instance 1 means count 1. "Yes, there was a second one" means count 2.
- quote: the same grounding rule as any other candidate — a real, contiguous span of the clinician's words.

Only ever propose a repeatDecision when you were actually told this is a repeat-group question, and only when the clinician's latest message actually answers it. If they answered something else instead (e.g. volunteered a new field value without addressing the repeat question), propose no repeatDecision.

## Never propose

- A field not in the given open-fields list.
- A value inferred from anything other than the clinician's own words in their latest message.
- A quote from anywhere but a CLINICIAN turn.
- More than one repeatDecision per turn.`;

const QuoteSchema = z.object({
  turnIndex: z.number().int().describe("Index into the numbered transcript below, pointing at a CLINICIAN turn."),
  text: z.string().describe("A contiguous, verbatim span copied from that turn's text."),
});

const FieldCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ fieldId: z.string(), kind: z.literal("value"), value: z.string(), quote: QuoteSchema }),
  z.object({ fieldId: z.string(), kind: z.literal("unknown"), quote: QuoteSchema }),
  z.object({ fieldId: z.string(), kind: z.literal("declined"), quote: QuoteSchema }),
]);

const RepeatDecisionSchema = z.object({
  repeatGroup: z.enum(REPEAT_GROUPS),
  count: z.number().int(),
  quote: QuoteSchema,
});

export const EXTRACTION_RESPONSE_SCHEMA = z.object({
  candidates: z.array(FieldCandidateSchema),
  repeatDecision: RepeatDecisionSchema.nullable(),
});

export type ExtractionResponse = z.infer<typeof EXTRACTION_RESPONSE_SCHEMA>;

function renderTranscript(transcript: TalkTurn[]): string {
  return transcript
    .map((turn, i) => `[${i}] ${turn.role === "clinician" ? "CLINICIAN" : "TALKER"}: ${turn.text}`)
    .join("\n");
}

function renderOpenFields(fields: FormFieldSpec[]): string {
  return fields.map((f) => `- ${f.id} (${f.type}): ${f.label}`).join("\n");
}

// The user-turn content for one extraction call. `transcript` must already
// include the clinician's latest message as its last entry — its index in
// this array is what the model is told to cite, and it's the same array
// the caller must later pass to validateCandidates()/validateRepeatCandidate()
// so quote indices line up (see src/lib/extract.ts).
export function buildExtractionUserContent(
  step: NextStep,
  fields: FormFieldSpec[],
  transcript: TalkTurn[],
): string {
  const transcriptBlock = `Numbered transcript (quote only from a CLINICIAN line, citing its number as turnIndex):\n${renderTranscript(transcript)}`;

  if (step.kind === "topic") {
    const openFields = fields.filter((f) => step.fieldIds.includes(f.id));
    return `${transcriptBlock}\n\nOpen fields for this turn (text/date only):\n${renderOpenFields(openFields)}\n\nPropose field candidates grounded in the clinician's latest message. This is not a repeat-group question — propose no repeatDecision.`;
  }

  if (step.kind === "repeat-decision") {
    return `${transcriptBlock}\n\nThe talker's last turn asked whether another instance of the "${step.repeatGroup}" group exists, after instance ${step.afterInstance}. If the clinician's latest message answers that, propose a repeatDecision (repeatGroup: "${step.repeatGroup}", count including the confirmed instance(s)). There are no open text/date fields for this turn.`;
  }

  return `${transcriptBlock}\n\nThere is nothing left to ask — propose nothing.`;
}
