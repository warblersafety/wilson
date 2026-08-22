// A real, deterministic AskFn implementation (src/lib/talk.ts) — no model
// call anywhere. Per the 2026-08-22 design conversation: asking a clear
// question doesn't need interpretation the way parsing a loose answer
// does (that's the real Extractor's job, not built yet), so templated
// phrasing is enough for v1.
//
// Field phrasing: derived from the manifest label's text after the last
// ":" (most labels are "Section: Subsection: Field", and the topic
// itself already supplies that context, so repeating it in the question
// would be redundant) — lowercased and wrapped as a noun phrase. Scanned
// all 227 real labels against this rule before writing it: it reads fine
// for the large majority. A "Row N — X" sub-pattern (Section B's lab-data
// table, Section F's concomitant-medication rows, ~62 fields) gets its
// own transform rather than an override, since it's the same shape
// repeated many times. Six fields genuinely break the generic rule and
// are named overrides instead — see PHRASING_OVERRIDES.
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import type { NextStep } from "./topics";
import type { AskFn } from "./talk";

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));

const DONE_MESSAGE = "That's everything — thanks for walking through this with me.";

const REPEAT_GROUP_LABELS = {
  "suspect-product": "suspect product",
  "concomitant-medication": "concomitant medication",
} as const;

// Named overrides for fields whose generic phrase would be broken or
// confusing, not a general-purpose content-authoring table — see the
// file header. More can be added later as discovered work if a specific
// phrase reads badly in practice; this isn't meant to be exhaustive.
//
// No override may contain a comma (enforced in ask.test.ts): an override
// is joined into a multi-field question the same way a generic phrase
// is (joinPhrases()), and a comma inside one item is indistinguishable
// from the join's own separators once several items are strung together
// — found by actually running askDeterministic against every real topic
// before committing, not just by inspection: the original "Other
// Frequency"/"Other Route" overrides each carried an explanatory clause
// after a comma, which produced an unreadable run-on the moment either
// was bundled with "Dose or Amount" in the same question.
export const PHRASING_OVERRIDES: Record<string, string> = {
  "Page2.SecB_Adverse.DescEvent": "a description of what happened",
  "Page3.TestDataTable.ReturnDate": "the date it was returned to the manufacturer",
  "Page4.Prod1.Prod1FreqOther": "the other frequency you had in mind",
  "Page4.Prod1.Prod1RouteOther": "the other route you had in mind",
  "Page5.Prod2.Prod2FreqOther": "the other frequency you had in mind",
  "Page5.Prod2.Prod2RouteOther": "the other route you had in mind",
  "Page6.SecE_Device.ExplantDate": "the date it was explanted",
  "Page6.SecE_Device.ImplantDate": "the date it was implanted",
  "Page6.SecE_Device.ReprocInfo": "the name and address of whoever reprocessed it",
};

// Caps how many of a topic's unresolved fields get asked in one message.
// Several topics bundle 8-32 fields (lab data, purchase details, usage
// timelines); joining all of them into one run-on sentence isn't a real
// question anyone could answer. The rest surface on a later turn the
// same way partial-topic-completion already works — nextStep() already
// recomputes the unresolved subset on every call, so nothing new is
// needed here beyond not asking about all of them at once.
export const MAX_FIELDS_PER_ASK = 3;

const ROW_PATTERN = /^Row (\d+) — (.+)$/;

function fieldPhrase(field: FormFieldSpec): string {
  const override = PHRASING_OVERRIDES[field.id];
  if (override) return override;

  // Manifest labels are Title Case ("Patient Identifier"); every word
  // needs lowercasing to read as a noun phrase, not just the first
  // character.
  const lastSegment = field.label.split(":").pop()!.trim();
  const rowMatch = lastSegment.match(ROW_PATTERN);
  if (rowMatch) {
    const [, rowNumber, rest] = rowMatch;
    return `row ${rowNumber}'s ${rest.toLowerCase()}`;
  }
  return `the ${lastSegment.toLowerCase()}`;
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

export const askDeterministic: AskFn = async (step: NextStep) => {
  if (step.kind === "done") return DONE_MESSAGE;
  if (step.kind === "repeat-decision") {
    return `Was there another ${REPEAT_GROUP_LABELS[step.repeatGroup]}?`;
  }
  const phrases = step.fieldIds.slice(0, MAX_FIELDS_PER_ASK).map((fieldId) => {
    const field = FIELDS_BY_ID.get(fieldId);
    if (!field) {
      throw new Error(`askDeterministic: no such field: ${fieldId}`);
    }
    return fieldPhrase(field);
  });
  return `What's ${joinPhrases(phrases)}?`;
};
