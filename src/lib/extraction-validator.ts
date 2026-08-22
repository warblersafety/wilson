// Per docs/design.md's Extractor row: a proposal is "checked against the
// specific conversation turn it came from before being treated as
// accepted." This module is that check — a pure, synchronous, no-model
// grounding validator, adopted from murmurpv/lucy's provenance-validator
// ("no quote, no write").
//
// Scoped to `text`/`date` fields only, per the 2026-08-22 design
// conversation: `enum`/`checkbox` fields never reach this path at all —
// lucy's own docs flag that its validator only checks a proposed value is
// *grounded*, never that a value mapped to one of a fixed set of choices
// is the *correct* one, and wilson has far more fixed-choice fields than
// lucy's record. Rather than inherit that gap, wilson's wizard shows the
// clinician the actual choices for an enum/checkbox field directly — no
// interpretation, so nothing for this validator to check.
//
// This module ships only the check, not the model call that produces
// what gets checked — same deferral pattern as the Talker orchestrator
// (Issue #11). `accepted` is already in src/lib/talk.ts's ProposedAction
// shape, so it plugs directly into processTurn's `extract` port once a
// real model-backed implementation exists.
import type { FormFieldSpec } from "./form-3500-fields";
import type { ProposedAction, TalkTurn } from "./talk";

export interface Quote {
  turnIndex: number;
  text: string;
}

export type ExtractionCandidate =
  | { fieldId: string; kind: "value"; value: string; quotes: Quote[] }
  | { fieldId: string; kind: "unknown"; quotes: Quote[] }
  | { fieldId: string; kind: "declined"; quotes: Quote[] };

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

const EXTRACTABLE_TYPES = new Set<FormFieldSpec["type"]>(["text", "date"]);

// Unicode NFKC, case-fold, whitespace-collapse, strip common sentence
// punctuation — deliberately not fuzzy or stemmed. Matches lucy's
// normalization exactly: loosening this further would let a proposal
// pass on something the clinician didn't actually say.
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,!?;:'"—–…]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function quoteIsGrounded(transcript: TalkTurn[], quote: Quote): boolean {
  const turn = transcript[quote.turnIndex];
  if (!turn || turn.role !== "clinician") return false;
  return normalize(turn.text).includes(normalize(quote.text));
}

function valueIsGroundedInQuotes(value: string, quotes: Quote[]): boolean {
  const normalizedValue = normalize(value);
  return quotes.some((quote) => normalize(quote.text).includes(normalizedValue));
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

export function validateCandidates(
  transcript: TalkTurn[],
  candidates: ExtractionCandidate[],
  fields: FormFieldSpec[],
): ValidationResult {
  const fieldsById = new Map(fields.map((field) => [field.id, field]));
  const accepted: ProposedAction[] = [];
  const rejected: RejectedCandidate[] = [];

  for (const candidate of candidates) {
    const field = fieldsById.get(candidate.fieldId);
    if (!field) {
      rejected.push({ candidate, reason: "unknown_field" });
      continue;
    }
    if (!EXTRACTABLE_TYPES.has(field.type)) {
      rejected.push({ candidate, reason: "not_extractable_field_type" });
      continue;
    }
    if (
      candidate.quotes.length === 0 ||
      !candidate.quotes.every((quote) => quoteIsGrounded(transcript, quote))
    ) {
      rejected.push({ candidate, reason: "quote_not_found" });
      continue;
    }
    if (candidate.kind === "value" && !valueIsGroundedInQuotes(candidate.value, candidate.quotes)) {
      rejected.push({ candidate, reason: "value_not_grounded" });
      continue;
    }
    accepted.push(toProposedAction(candidate));
  }

  return { accepted, rejected };
}
