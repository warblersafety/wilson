// The narrative-extraction pass's prompt (Issue #41, design.md "Interaction
// model and UI" + "Extraction scope"). Unlike src/prompts/extractor.ts's
// per-turn job — a handful of fields the current step is asking about — this
// sweeps every open field across every currently-reachable topic in one
// call, over the clinician's opening dictated narrative rather than a
// back-and-forth transcript. Sized to that broader job, not a copy of the
// narrower one; QuoteSchema/REPEAT_GROUPS/EXTRACTOR_MODEL are shared with it
// because a quote is a quote and a repeat group is a repeat group regardless
// of which extraction job is asking, not because the jobs are the same
// shape.
//
// The deterministic grounding check in src/lib/extraction-validator.ts
// re-verifies everything this prompt promises — nothing here is load-bearing
// for safety on its own, same posture extractor.ts documents for itself.
import { z } from "zod";
import { legalEnumOptions, type FormFieldSpec } from "../lib/form-3500-fields";
import { QuoteSchema, REPEAT_GROUPS } from "./extractor";

// EXTRACTOR_MODEL (same Sonnet tier, not re-exported under a second name
// here) is imported directly from ./extractor by whatever wires a real
// model call — see src/lib/narrative-extract.ts.
export const NARRATIVE_EXTRACTOR_SYSTEM = `You are the narrative-extraction component of wilson, a clinician-facing tool for reporting adverse drug events to the FDA (Form 3500). Your job: read a clinician's opening dictated narrative describing an adverse event, and propose structured field values for as much of Form 3500 as that narrative actually supports — spanning every open topic, not just one.

You never converse. You never decide what to ask next. You only propose candidates with supporting evidence, and a deterministic validator decides what is actually written to the record. Candidates that fail the validator are discarded, so propose only what you can ground.

## The provenance contract (your hard rule)

Every candidate carries exactly one quote: a contiguous span copied exactly from the clinician's narrative (never paraphrased, never invented). The validator rejects any quote that does not appear, after light normalization (case, punctuation, whitespace), inside the narrative text.

A candidate's "quote" is not required to literally contain its "value" — clinicians phrase things referentially ("the water pill" grounds "furosemide"). What must be real is the quote itself, not a verbatim match between quote and value.

## Field candidates — every open field, any type

You will be given the full list of currently open fields (id, label, type), spanning every section of the form. For each field, decide in this order:

- Did the narrative address this field at all — stating it directly, or clearly implying it? If not, propose nothing for it. Do not fill from context, medical plausibility, or your own knowledge.
- Did the narrative give a usable value? -> kind "value", with that value and the quote that grounds it.
- Did the narrative explicitly say the answer isn't known or isn't on hand? -> kind "unknown".
- Did the narrative explicitly decline to say, or say it doesn't apply? -> kind "declined".

Sweep every open field you were given, not just the first one the narrative seems to address — one narrative commonly grounds many field candidates at once.

### Checkbox and enum fields — a tighter contract than text/date

Unlike text/date fields, a checkbox or enum candidate's "value" must be one of that field's actual legal options, spelled exactly as given to you:

- For a **checkbox** field, the legal values are exactly the strings "true" or "false" — nothing else. Propose "true" when the narrative clearly indicates the thing the checkbox represents applies; propose "false" when the narrative clearly, explicitly indicates it does not. A checkbox's label describes what "true" means (e.g. "Outcome: Hospitalization" — the narrative saying the patient was admitted overnight grounds "true" there).
- For an **enum** field, you will be given its exact list of legal options — the value must be spelled exactly as one of them, never a paraphrase or a close synonym.

## Companion fields — one fact, several boxes

Form 3500 keeps some single facts in several fields at once. When the narrative states the fact, propose every field it fills, each grounded on the same quote:

- **Units stated in the words.** "875 mg" fills the strength AND its unit enum; "1 tablet twice daily" fills the dose, its unit, and the frequency; "six months of therapy" fills the duration and its duration-unit enum. Propose a unit ONLY from what the clinician actually wrote — never from what seems medically likely. A bare number with no unit: propose the number alone and leave the unit open.
- **"Other" companions.** Frequency and route are enums. If the stated value matches a legal option, use it. If it matches none of them, propose the enum's "Other" option where one exists AND propose the free-text Other-companion field with the clinician's own words.
- **One-hot pairs.** "She was still on it" fills the ongoing-yes box; "he'd stopped it" fills ongoing-no. Propose "true" for the box the narrative selects. Do not propose "false" for a box unless the narrative says so — a narrative is not a form, and silence about a box is silence, not a negative.

## Repeat-group decisions — zero or more

Some fields belong to a repeating group (e.g. "suspect product," "concomitant medication") whose later instances only open once you say how many total instances the narrative describes. If — and only if — the narrative clearly states there is more than one instance of a group, propose a repeatDecision for that group:

- repeatGroup: the group's name, from the list you're given.
- count: the total number of instances the narrative confirms exist.
- quote: the same grounding rule as any other candidate.

You may propose a repeatDecision for more than one group in the same narrative if it genuinely addresses more than one — at most one decision per group. Only instance 1 of any repeating group's own fields are ever offered to you above — never propose a field candidate for a second or later instance; that gets asked separately, once the repeat decision above unblocks it.

## Never propose

- A field not in the given open-fields list.
- A checkbox/enum value that isn't one of that field's stated legal options.
- A value inferred from anything other than the narrative's own words.
- A quote from anywhere the clinician didn't actually say.
- More than one repeatDecision naming the same group.`;

const NarrativeFieldCandidateSchema = z.discriminatedUnion("kind", [
  z.object({ fieldId: z.string(), kind: z.literal("value"), value: z.string(), quote: QuoteSchema }),
  z.object({ fieldId: z.string(), kind: z.literal("unknown"), quote: QuoteSchema }),
  z.object({ fieldId: z.string(), kind: z.literal("declined"), quote: QuoteSchema }),
]);

const NarrativeRepeatDecisionSchema = z.object({
  repeatGroup: z.enum(REPEAT_GROUPS),
  count: z.number().int(),
  quote: QuoteSchema,
});

// `repeatDecisions` is a required array (never optional/nullable): unlike
// extractor.ts's single nullable `repeatDecision` (there's always exactly
// one candidate question in play in a per-turn ask), this pass can
// legitimately detect zero, one, or several groups in one narrative — an
// explicit `[]` is "I checked, none," not "I forgot this field."
export const NARRATIVE_EXTRACTION_RESPONSE_SCHEMA = z.object({
  candidates: z.array(NarrativeFieldCandidateSchema),
  repeatDecisions: z.array(NarrativeRepeatDecisionSchema),
});

export type NarrativeExtractionResponse = z.infer<typeof NARRATIVE_EXTRACTION_RESPONSE_SCHEMA>;

// Checkbox carries no per-field elaboration — NARRATIVE_EXTRACTOR_SYSTEM
// already states the "true"/"false" contract once, and restating it on
// every checkbox field (61 of them against a blank record) cost ~600
// tokens of identical text per call, in the uncached user block, for zero
// added information (reviewer pass, finding). Enum genuinely needs its
// per-field options rendered — those vary field to field.
function renderOpenField(field: FormFieldSpec): string {
  if (field.type === "enum") {
    const options = legalEnumOptions(field).map((option) => `"${option}"`);
    return `- ${field.id} (enum — legal values: ${options.join(", ")}): ${field.label}`;
  }
  return `- ${field.id} (${field.type}): ${field.label}`;
}

// `openFields` is computed by the caller via src/lib/topics.ts's
// narrativePassFields() — this module only shapes prompt text, the same
// separation extractor.ts keeps from topics.ts's nextStep().
export function buildNarrativeExtractionUserContent(narrative: string, openFields: FormFieldSpec[]): string {
  const narrativeBlock = `The clinician's opening narrative (quote only from this text, verbatim):\n[0] CLINICIAN: ${narrative}`;
  const fieldsBlock = `Open fields across every currently-reachable topic:\n${openFields.map(renderOpenField).join("\n")}`;
  const groupsBlock = `Repeat groups you may detect (at most one decision per group; never propose a field candidate for a second or later instance — only if the narrative clearly states more than one instance exists): ${REPEAT_GROUPS.join(", ")}.`;
  return `${narrativeBlock}\n\n${fieldsBlock}\n\n${groupsBlock}\n\nPropose every field candidate the narrative grounds, plus any repeat-group decisions it clearly states.`;
}
