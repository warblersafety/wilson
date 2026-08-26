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
//
// Checkbox/enum fields (Issue #44: "ordinary conversational asks... phrased
// with their options by the deterministic AskFn") layer an options suffix
// on top of the same base phrase, rather than a wholly separate phrasing
// path — see fieldPhrase()'s type-specific branches below.
import { FORM_3500_FIELDS, legalEnumOptions, type FormFieldSpec } from "./form-3500-fields";
import type { NextStep } from "./topics";
import type { AskFn } from "./talk";

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));

const DONE_MESSAGE = "That's everything — thanks for walking through this with me.";

// Exported for reuse by src/lib/followup-sweep.ts's sweep-acknowledgment
// phrasing (Issue #44) — a repeat group's human label is the same concept
// regardless of which module needs to say it in a sentence.
export const REPEAT_GROUP_LABELS = {
  "suspect-product": "suspect product",
  "concomitant-medication": "concomitant medication",
} as const;

// Named overrides for fields whose generic phrase would be broken or
// confusing, not a general-purpose content-authoring table — see the
// file header. More can be added later as discovered work if a specific
// phrase reads badly in practice; this isn't meant to be exhaustive.
//
// No field's phrase — override OR generic — may contain a comma
// (enforced in ask.test.ts across the whole real manifest, not just the
// override table): a phrase is joined into a multi-field question the
// same way every other phrase is (joinPhrases()), and a comma inside one
// item is indistinguishable from the join's own separators once several
// items are strung together — found twice by actually running
// askDeterministic against every real topic before committing, not just
// by inspection. First against the override table itself (the original
// "Other Frequency"/"Other Route" overrides each carried an explanatory
// clause after a comma); a fresh-context review then found the same
// class of bug in the generic fallback path, which had no comma guard
// at all — a field with a comma in its label and no override (e.g.
// "Manufacturer Name, City and State", no ":" to split on) sailed
// straight through. Two fields needed overrides purely to satisfy this:
// ManuName (exploitable today — its topic bundles other fields) and
// OtherHistory (not exploitable today, since its topic has no other
// field to bundle it with — but a future manifest change could make it
// so, and the mechanical test now catches that regardless of whether
// today's topic map happens to expose it).
//
// Defects and IdentityNo joined the table for the same reason once Issue
// #44 started phrasing checkbox fields at all — each carries a comma in
// its label (Defects: "Product Problem (e.g., defects/malfunctions)";
// IdentityNo: "If you do NOT want your identity disclosed to the
// manufacturer, please mark this box") that v1's own comma guard could
// never have caught, since no checkbox field was ever run through
// fieldPhrase() before checkbox/enum fields became ordinary
// conversational asks. IdentityNo's label is also phrased as an
// instruction rather than a noun phrase — the generic "the <label>" rule
// would read as nonsense ("the if you do not want...") even with the
// comma fixed, so it needed an override for both reasons at once.
export const PHRASING_OVERRIDES: Record<string, string> = {
  "Page1.SecA_Patient.Defects": "a product problem such as a defect or malfunction",
  "Page2.SecB_Adverse.DescEvent": "a description of what happened",
  "Page3.Sec6Data.OtherHistory": "any other relevant medical history",
  "Page3.TestDataTable.ReturnDate": "the date it was returned to the manufacturer",
  "Page4.Prod1.Prod1FreqOther": "the other frequency you had in mind",
  "Page4.Prod1.Prod1RouteOther": "the other route you had in mind",
  "Page5.Prod2.Prod2FreqOther": "the other frequency you had in mind",
  "Page5.Prod2.Prod2RouteOther": "the other route you had in mind",
  "Page6.SecE_Device.ExplantDate": "the date it was explanted",
  "Page6.SecE_Device.ImplantDate": "the date it was implanted",
  "Page6.SecE_Device.ManuName": "the manufacturer's name and location",
  "Page6.SecE_Device.ReprocInfo": "the name and address of whoever reprocessed it",
  "Page7.SecG_Reporter.IdentityNo": "whether to keep your identity from the manufacturer",
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

// Past this many legal options, spelling every one out inline (Issue #44)
// would replace a question with a wall of text before a clinician could
// even answer it — Country (~275 options), Route (~68), and Unit (~42)
// are the real fields this affects; every other real enum field tops out
// at 13 (Occupation), comfortably under this. Past the cap, the ask
// carries no option suffix at all: the clinician answers in plain text
// the same as any other field, and the Extractor performs the same
// referential mapping it already does for text fields ("the water pill"
// -> furosemide), checked mechanically against the FULL legal list
// regardless of what was shown in the question.
export const ASK_OPTIONS_INLINE_MAX = 15;

// A field's base noun phrase, with no type-specific suffix — the same
// derivation every field (of any type) has always used. Split out so
// fieldPhrase() below can layer a checkbox/enum options suffix on top of
// it without duplicating the override/row-pattern/generic logic three
// times.
function basePhrase(field: FormFieldSpec): string {
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

// Checkbox/enum fields are ordinary conversational asks now (Issue #44) —
// answered by typed/dictated text, never a widget — so the ask itself
// must carry the field's legal options, or a clinician has no way to
// know what vocabulary will actually validate. Joined with " / ", never
// ",": a field's own phrase must stay comma-free (see the file header's
// comma-guard rule, which every phrase — override, generic, or now
// option-suffixed — is tested against across the whole real manifest).
// Exported for followup-sweep.ts's sweep-acknowledgment/correction-offer
// phrasing (Issue #44) — a field's plain-language phrase is the same
// concept there ("you said X for <field>...") as it is in an ordinary ask.
export function fieldPhrase(field: FormFieldSpec): string {
  const base = basePhrase(field);
  if (field.type === "checkbox") {
    return `${base} (yes or no)`;
  }
  if (field.type === "enum") {
    const options = legalEnumOptions(field);
    if (options.length > 0 && options.length <= ASK_OPTIONS_INLINE_MAX) {
      return `${base} (${options.join(" / ")})`;
    }
  }
  return base;
}

function joinPhrases(phrases: string[]): string {
  if (phrases.length === 0) {
    // Unreachable via today's nextStep() (it only ever returns a "topic"
    // step with a non-empty fieldIds), but NextStep's type doesn't
    // enforce that, and nothing stops a caller from constructing one
    // directly — found by review, which pointed out this file's own
    // test helper does exactly that with no guard. Fail loud rather
    // than hand a clinician a broken "What's , and undefined?" message.
    throw new Error("askDeterministic: a 'topic' step must have at least one fieldId");
  }
  if (phrases.length === 1) return phrases[0];
  if (phrases.length === 2) return `${phrases[0]} and ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, and ${phrases[phrases.length - 1]}`;
}

export const askDeterministic: AskFn = async (step: NextStep, session) => {
  if (step.kind === "done") return DONE_MESSAGE;
  if (step.kind === "repeat-decision") {
    const base = `Was there another ${REPEAT_GROUP_LABELS[step.repeatGroup]}?`;
    // Issue #44: a hint when the widened follow-up sweep already saw a
    // later-instance field volunteered for this exact group earlier in
    // the conversation (talk.ts's processTurn() records it on
    // session.volunteeredRepeats — see design.md: "a volunteered later
    // instance surfaces... at the group's normal 'was there another?'
    // repeat-decision ask"). Once decided (yes or no), nextStep() never
    // returns this step for the group again, so the hint naturally stops
    // appearing — nothing here needs to clear it.
    if (session.volunteeredRepeats?.[step.repeatGroup]) {
      return `${base} You mentioned another earlier — I can pick that back up now.`;
    }
    return base;
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
