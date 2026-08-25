// Per docs/design.md's Extractor row: a proposal is "checked against the
// specific conversation turn it came from before being treated as
// accepted... lighter than lucy's literal quote match (clinicians phrase
// things referentially: 'the water pill,' 'about a week before')." This
// module is that check.
//
// "Lighter than lucy's literal quote match" is read literally: unlike
// lucy, this validator does NOT require a proposed value to appear
// verbatim inside its supporting quote — "the water pill" legitimately
// grounds a mapped value like "furosemide" even though neither string
// contains the other. What IS required, matching design.md's "checked
// against the specific conversation turn it came from": the quote itself
// must be real — a literal (normalized) substring of something the
// clinician actually said, never fabricated. That's the same tradeoff
// lucy itself ships with for the majority of its own fields (stored
// verbatim, no value-in-quote check at all); this is not a step back
// from lucy's actual practice, only from importing lucy's *narrower*
// free-text-field behavior somewhere design.md never asked for it.
//
// Consequence worth naming, not silently accepted: a badly-behaved
// extractor could still cite a real but topically-unrelated quote to
// justify a fabricated value — quote-existence alone can't verify a
// value's *semantic* relationship to its quote, only that the quote is
// real. Deterministic string matching cannot do better without also
// rejecting every legitimate referential mapping design.md asks for; the
// same limitation lucy accepts for its own mapped-value fields (see
// docs/specs/03-extractor-validator.md — enum-mapping correctness there
// has no runtime check, only offline eval scoring). The charter's own
// stance is consistent with this: the clinician's review before
// submission, not this validator, is the load-bearing safety control.
//
// Scoped to `text`/`date` fields only, per the 2026-08-22 design
// conversation: `enum`/`checkbox` fields never reach this path at all —
// wilson has far more fixed-choice fields than lucy's record, so where
// lucy accepts "no runtime check on mapped-value correctness" as a
// tradeoff, wilson instead sidesteps it: the wizard shows the clinician
// the actual choices for an enum/checkbox field directly, no
// interpretation, nothing for a validator to check.
//
// This module ships only the check, not the model call that produces
// what gets checked — same deferral pattern as the Talker orchestrator
// (Issue #11). `accepted` is already in src/lib/talk.ts's ProposedAction
// shape; a real ExtractFn implementation would call a model to produce
// ExtractionCandidate[], then wrap this validator's synchronous result
// to satisfy ExtractFn's async, message-driven signature — this module
// is that inner check, not a drop-in ExtractFn itself.
import type { FormFieldSpec } from "./form-3500-fields";
import type { ProposedAction, TalkTurn } from "./talk";
import type { RepeatGroup } from "./topics";

export interface Quote {
  turnIndex: number;
  text: string;
}

// One quote per candidate, not several: a candidate citing multiple
// quotes for one value invites checking "does the value appear in ANY of
// these," which lets an unrelated-but-real quote justify a value that
// has nothing to do with it. Requiring the extractor to name the single
// quote that actually grounds its claim keeps the correspondence
// unambiguous — multiple pieces of supporting context become multiple
// candidates, not one candidate with a bag of evidence.
export type ExtractionCandidate =
  | { fieldId: string; kind: "value"; value: string; quote: Quote }
  | { fieldId: string; kind: "unknown"; quote: Quote }
  | { fieldId: string; kind: "declined"; quote: Quote };

export type RejectionReason =
  | "unknown_field"
  | "not_extractable_field_type"
  | "quote_not_found"
  | "value_not_grounded";

export interface RejectedCandidate {
  candidate: ExtractionCandidate;
  reason: RejectionReason;
}

export interface ValidationResult {
  accepted: ProposedAction[];
  rejected: RejectedCandidate[];
}

function isExtractableFieldType(type: FormFieldSpec["type"]): boolean {
  switch (type) {
    case "text":
    case "date":
      return true;
    case "checkbox":
    case "enum":
      return false;
    default: {
      const exhaustive: never = type;
      throw new Error(`unhandled field type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// Unicode NFKC, case-fold, whitespace-collapse, strip common sentence
// punctuation (including curly/smart quotes, which speech-to-text and
// model output disagree on far more often than straight quotes) —
// deliberately not fuzzy or stemmed. Loosening this further would let a
// proposal pass on something close to, but not actually, what the
// clinician said.
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,!?;:'"’‘“”—–…-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clinicianTurnText(transcript: TalkTurn[], turnIndex: number): string | null {
  const turn = transcript[turnIndex];
  return turn && turn.role === "clinician" ? normalize(turn.text) : null;
}

// Shared by validateCandidates() and validateRepeatCandidate(): a quote is
// grounded only if it's a real (normalized) substring of the clinician
// turn it cites. An empty normalized quote (e.g. punctuation-only source
// text like "...") would otherwise satisfy `includes("")` against any
// turn — vacuously "found" regardless of content — so it's rejected
// explicitly rather than left to String.prototype.includes's empty-string
// identity to silently defeat the whole check.
function quoteIsGrounded(turnText: string | null, quote: Quote): boolean {
  const normalizedQuote = normalize(quote.text);
  return normalizedQuote.length > 0 && turnText !== null && turnText.includes(normalizedQuote);
}

function toProposedAction(candidate: ExtractionCandidate): ProposedAction {
  switch (candidate.kind) {
    case "value":
      return { fieldId: candidate.fieldId, type: "answer", value: candidate.value };
    case "unknown":
      return { fieldId: candidate.fieldId, type: "mark_unknown" };
    case "declined":
      return { fieldId: candidate.fieldId, type: "decline" };
  }
}

// A repeat-group "is there another one?" decision, grounded the same way
// a field-value candidate is: the quote must be real. Unlike
// ExtractionCandidate, there's no field type or field id to check —
// `count` isn't validated here (topics.ts's setRepeatCount() already
// throws on an out-of-range count; processTurn applies it the same way
// it already applies applyAction(), so an invalid count fails the whole
// turn instead of writing a bad count, matching how an invalid field
// action already behaves).
export interface RepeatCandidate {
  repeatGroup: RepeatGroup;
  count: number;
  quote: Quote;
}

export type RepeatRejectionReason = "wrong_repeat_group" | "quote_not_found";

export interface RepeatValidationResult {
  accepted: boolean;
  reason?: RepeatRejectionReason;
}

// `expectedGroup` is the repeat-decision step actually open right now
// (topics.ts's NextStep, kind "repeat-decision"). This is checked here,
// not left to the caller, so a candidate proposed against the wrong step
// — e.g. a model mis-fire during an ordinary field-answering turn — is
// rejected the same deterministic way a mis-scoped field candidate
// already is in validateCandidates() ("unknown_field" /
// "not_extractable_field_type"), rather than trusted on quote-grounding
// alone.
export function validateRepeatCandidate(
  transcript: TalkTurn[],
  candidate: RepeatCandidate,
  expectedGroup: RepeatGroup,
): RepeatValidationResult {
  if (candidate.repeatGroup !== expectedGroup) {
    return { accepted: false, reason: "wrong_repeat_group" };
  }
  const turnText = clinicianTurnText(transcript, candidate.quote.turnIndex);
  if (!quoteIsGrounded(turnText, candidate.quote)) {
    return { accepted: false, reason: "quote_not_found" };
  }
  return { accepted: true };
}

export function validateCandidates(
  transcript: TalkTurn[],
  candidates: ExtractionCandidate[],
  fields: FormFieldSpec[],
): ValidationResult {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  // Memoized per call: a single clinician turn commonly grounds several
  // field extractions in one batch, and re-running NFKC/lowercase/strip
  // on the same turn text for each of them would be pure waste.
  const normalizedTurns = new Map<number, string | null>();
  const memoizedTurnText = (turnIndex: number): string | null => {
    if (!normalizedTurns.has(turnIndex)) {
      normalizedTurns.set(turnIndex, clinicianTurnText(transcript, turnIndex));
    }
    return normalizedTurns.get(turnIndex) ?? null;
  };

  const accepted: ProposedAction[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const candidate of candidates) {
    const field = fieldsById.get(candidate.fieldId);
    if (!field) {
      rejected.push({ candidate, reason: "unknown_field" });
      continue;
    }
    if (!isExtractableFieldType(field.type)) {
      rejected.push({ candidate, reason: "not_extractable_field_type" });
      continue;
    }
    if (!quoteIsGrounded(memoizedTurnText(candidate.quote.turnIndex), candidate.quote)) {
      rejected.push({ candidate, reason: "quote_not_found" });
      continue;
    }
    if (candidate.kind === "value" && normalize(candidate.value).length === 0) {
      rejected.push({ candidate, reason: "value_not_grounded" });
      continue;
    }
    accepted.push(toProposedAction(candidate));
  }

  return { accepted, rejected };
}
