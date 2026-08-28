// The deterministic half of docs/ask-copy.md rule 3's derive rules: the
// companion writes that follow mechanically from what a clinician just
// answered, decided here rather than asked of the model.
//
// The division of labour the contract sets ("Consequences for the
// machinery", item 3): the extractor PROMPT carries the derives that need
// reading — a unit from "500 mg", an "Other" companion when the stated
// value matches no enum option, which one-hot member the words select.
// What is mechanical stays mechanical and lives here, where a test can
// pin it and no model call can vary it turn to turn.
//
// Three rules, and each has a negative that matters as much as the
// positive:
//
// 1. **Group completion.** Answering a checkbox group answers the whole
//    group: the members the clinician named are true, the rest false.
//    Rule 7's bound takes one form per group kind (amended 2026-08-28,
//    #126 — being on screen is not the same as being heard, and hearing
//    is not the only honest ground; entailment is the other):
//      - `voicesEveryMember` (deriveCompanionWrites' own loop, below):
//        "every one of them is voiced above, so no box is ever written
//        false unheard" — the group must belong to the ask that was just
//        on screen, so a checkbox volunteered out-of-ask completes
//        nothing (its group completes later, when its own ask voices
//        it).
//      - `exclusive` (completeExclusiveFactWrites, below): "none is ever
//        written false unentailed" — entailment carries on the
//        clinician's own words, not on a list being read, so completion
//        applies to any validator-grounded member write the record
//        accepts, regardless of which ask (if any) is on screen: the
//        ask's own turn, a rule-8 volunteered write, or a Read-back
//        confirmation of a narrative proposal.
//    A checkbox fact declaring NEITHER (PB-3's race/ethnicity, SP-6's
//    product type) never completes at all: PB-3 asks for "race or
//    ethnicity" without naming its seven boxes and they are not
//    alternatives, so answering "White" must not write EthnicLatino
//    false — race and Hispanic ethnicity are orthogonal on this form.
//    The negative, unchanged for both completing kinds: an `unknown` or
//    `declined` answer completes nothing. "I don't know if she was
//    hospitalized" is not an answer to the outcome question, and must
//    not write six boxes false. (An exclusive fact's own atomic write
//    DOES supersede a prior `unknown`/`declined` SIBLING state — see
//    completeExclusiveFactWrites' own comment — a different thing from a
//    trigger that is itself unknown/declined completing nothing.)
//
// 2. **The bare-age default.** Rule 3's one recorded exception to
//    stated-only units: "a bare age defaults to years (unqualified
//    clinical ages are years; infant ages are always qualified)".
//    The negative, also rule 3's, and the reason weight is NOT here: "A
//    bare weight gets NO default — lb/kg is genuinely ambiguous — the
//    value writes and the unit stays open."
//
// 3. **The text-ask negative (Issue #121).** Rule 7's other half — group
//    completion above is the checkbox half of the SAME rule. MH-1, LD-1,
//    and AC-1 are the only three asks it covers, decided once here
//    rather than per model run: a clear "none"/"nothing" answer to one
//    of them forces its OWN field to answered/"None", never
//    mark_unknown, regardless of what the extractor concluded —
//    because scripts/fill-3500.py's render_value() prints an unknown
//    text field as "Unknown", stating the opposite of what the
//    clinician said on an FDA-bound form. The gate's C2 case is the
//    proof this was a real defect, not a hypothetical one: "no relevant
//    history" and "nothing else to add" both landed as
//    `{state:"unknown"}` and exported "Unknown".
//    The negative: ignorance is not a negative. "I don't have that
//    information" / "I don't know" / "not sure" must still resolve
//    `unknown` — rule 7 treats the two as different statements, and
//    conflating them would make wilson assert an absence the clinician
//    never stated. The bound is conservative on purpose: full-string
//    match only, after the SAME normalization extraction-validator.ts's
//    own grounding check uses (NFKC, case-fold, punctuation-stripped) —
//    never a substring or a fuzzy match. "no relevant history of
//    cardiac issues" must NOT match; it carries real content the
//    literal word "None" would erase.
import type { AgendaRecord } from "./agenda";
import { AUTHORED_ASKS, exclusiveFactContaining, type AskFact } from "./ask-inventory";
import { normalize } from "./extraction-validator";
import { isResolved } from "./field-state";
import { fieldById } from "./form-3500-fields";
import type { ProposedAction } from "./talk";
import type { NextStep } from "./topics";

const AGE_VALUE = "Page1.SecA_Patient.AgeValue";
const AGE_YEARS = "Page1.SecA_Patient.AgeYears";
const AGE_UNITS = [
  AGE_YEARS,
  "Page1.SecA_Patient.AgeMonths",
  "Page1.SecA_Patient.AgeWeeks",
  "Page1.SecA_Patient.AgeDays",
];

function answeredIn(writes: ProposedAction[], fieldId: string): boolean {
  return writes.some((write) => write.fieldId === fieldId && write.type === "answer");
}

function alreadySettled(record: AgendaRecord, writes: ProposedAction[], fieldId: string): boolean {
  return isResolved(record[fieldId]?.state ?? "unasked") || writes.some((w) => w.fieldId === fieldId);
}

// Every field of the fact is a checkbox — the only shape group completion
// makes sense for. RC-1's nine text fields are one fact too, and
// completing THOSE would invent addresses.
function isCheckboxGroup(fieldIds: string[]): boolean {
  return fieldIds.length > 0 && fieldIds.every((id) => fieldById(id)?.type === "checkbox");
}

// The companion writes to append to a turn's own writes. Pure: takes the
// step that was on screen, the record as it stood before the turn, and
// what the turn wrote; returns only the additions.
export function deriveCompanionWrites(
  step: NextStep,
  record: AgendaRecord,
  writes: ProposedAction[],
): ProposedAction[] {
  const derived: ProposedAction[] = [];

  // 1. voicesEveryMember group completion, scoped to the ask that was
  // actually voiced — UNCHANGED by #126 (ask-copy.md rule 7's own
  // bound-by-group-kind split): hearing the list is what makes the
  // unnamed members' "false" honest, so a member arriving any other way
  // completes nothing here. `exclusive` facts no longer run through this
  // loop at all — completeExclusiveFactWrites() below is path-agnostic
  // and handles them, folded into this function's own return so
  // extract.ts's one call site keeps covering both kinds.
  if (step.kind === "topic") {
    for (const fact of step.ask.facts ?? []) {
      if (!isCheckboxGroup(fact.fieldIds)) continue;
      if (fact.voicesEveryMember !== true) continue;
      if (!fact.fieldIds.some((id) => answeredIn(writes, id))) continue;
      for (const fieldId of fact.fieldIds) {
        if (alreadySettled(record, writes, fieldId)) continue;
        derived.push({ fieldId, type: "answer", value: "false" });
      }
    }
  }

  return [...derived, ...completeExclusiveFactWrites(record, writes), ...bareAgeDefaultWrites(record, writes)];
}

// Rule 7's exclusive-fact amendment (#126): "a write to an exclusive
// group is a write of the whole FACT, atomic — the named member true,
// every sibling false, one operation derived from one grounded quote."
// Deliberately NOT scoped to a `step` the way the voicesEveryMember loop
// above is — the amendment's whole point is that entailment "carries on
// the clinician's own words, not on a list being read," so this runs the
// same way for the ask's own turn, a rule-8 volunteered write anywhere in
// the walk (extract.ts folds this into deriveCompanionWrites' own
// return, so both paths are covered by one call), and a Read-back
// confirmation (narrative-extract.ts's applyNarrativeProposals calls
// this directly, since a narrative has no `step` at all).
//
// classifyFollowUpActions (followup-sweep.ts) is what keeps a write
// CONFLICTING with an already-`answered` exclusive fact from ever
// reaching `writes` here in the first place — that is item 4's
// fact-granularity correction offer, a decision this function never has
// to make: it only ever sees a member entitled to write straight
// through.
//
// Supersession: an `unknown`/`declined` sibling is overwritten `false`
// the same as an `unasked` one — those record an absence of value, not a
// stated one, so the sweep's "never silently overwrite a resolved
// field" invariant (which protects STATED values) does not reach them.
// The naive port of alreadySettled()'s own isResolved() check would get
// this backwards (unknown/declined count as "resolved," so it would
// SKIP them) — which is exactly the shape of this unit's own root-cause
// bug, just relocated rather than fixed, so this function uses its own,
// narrower settlement check instead.
function exclusiveSiblingAlreadySettled(record: AgendaRecord, writes: ProposedAction[], fieldId: string): boolean {
  return record[fieldId]?.state === "answered" || writes.some((w) => w.fieldId === fieldId);
}

export function completeExclusiveFactWrites(record: AgendaRecord, writes: ProposedAction[]): ProposedAction[] {
  const derived: ProposedAction[] = [];
  const handled = new Set<AskFact>();
  for (const write of writes) {
    if (write.type !== "answer" || write.value !== "true") continue;
    const fact = exclusiveFactContaining(write.fieldId);
    if (fact === undefined || handled.has(fact)) continue;
    handled.add(fact);
    for (const fieldId of fact.fieldIds) {
      if (fieldId === write.fieldId) continue;
      if (exclusiveSiblingAlreadySettled(record, writes, fieldId)) continue;
      derived.push({ fieldId, type: "answer", value: "false" });
    }
  }
  return derived;
}

// Rule 3's bare-age default, split out because it applies wherever an age
// is written and not only on a follow-up turn. The dictation path writes
// through applyNarrativeProposals(), which had no derives at all until
// the reviewer pass on PR #106 pointed out that the very age this app's
// own artifact seeds — "61-year-old" — therefore left four unit
// checkboxes open forever.
//
// Group completion deliberately does NOT travel with it: completion is
// bounded by what an ask voiced, and a dictated narrative voices nothing.
export function bareAgeDefaultWrites(record: AgendaRecord, writes: ProposedAction[]): ProposedAction[] {
  // Only when these writes are what set the age, and only when nothing —
  // model, record, or this same batch — has already said which unit.
  if (!answeredIn(writes, AGE_VALUE)) return [];
  if (AGE_UNITS.some((id) => alreadySettled(record, writes, id))) return [];
  return [
    { fieldId: AGE_YEARS, type: "answer", value: "true" },
    ...AGE_UNITS.filter((id) => id !== AGE_YEARS).map(
      (unit): ProposedAction => ({ fieldId: unit, type: "answer", value: "false" }),
    ),
  ];
}

// Rule 7's text-ask negative (see the header comment's rule 3 above):
// the three asks it covers, and nothing else — bounded and stated once,
// per Issue #121's AC-2, rather than re-decided per model run.
const TEXT_ASK_NEGATIVE_ASK_IDS: readonly string[] = ["MH-1", "LD-1", "AC-1"];

// Conservative on purpose (see the header comment): full-string members
// only. Ignorance ("I don't know", "not sure", "I don't have that/it")
// is deliberately absent — rule 7 says a mark_unknown on genuine
// ignorance must still resolve `unknown`, a different statement from
// "none".
const CLEAR_TEXT_NEGATIVES = new Set([
  "none",
  "no",
  "nothing",
  "no relevant history",
  "nothing else",
  "nothing else to add",
  "nothing to add",
]);

// Exported for direct testing of the boundary itself, and for any future
// caller (e.g. a narrative-path normalization) that needs the identical
// bound this turn-level check uses.
export function isClearTextAskNegative(text: string): boolean {
  return CLEAR_TEXT_NEGATIVES.has(normalize(text));
}

// `null` outside the three bounded asks, or when the ask's own field is
// somehow absent from the inventory (defensive; every ask here always
// has exactly one askFieldIds entry) — never thrown, since this runs on
// every turn regardless of which ask is on screen.
function textAskNegativeFieldId(askId: string): string | null {
  if (!TEXT_ASK_NEGATIVE_ASK_IDS.includes(askId)) return null;
  const ask = AUTHORED_ASKS.find((a) => a.id === askId);
  return ask?.askFieldIds[0] ?? null;
}

// The primary mechanism (AC-1): called with the RAW clinician message
// for the turn that was just on screen — never with what the extractor
// proposed from it, because "regardless of the kind the extractor
// proposed" includes "proposed nothing at all". extract.ts calls this
// itself, outside the extractor's own candidate flow, and its result
// (when non-null) OVERRIDES whatever that turn separately wrote for the
// same field — a wrong kind, a stray value, or nothing.
export function textAskNegativeWrite(step: NextStep, message: string): ProposedAction | null {
  if (step.kind !== "topic") return null;
  const fieldId = textAskNegativeFieldId(step.ask.id);
  if (!fieldId) return null;
  if (!isClearTextAskNegative(message)) return null;
  return { fieldId, type: "answer", value: "None" };
}
