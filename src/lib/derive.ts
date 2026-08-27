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
// Two rules, and both have a negative that matters as much as the
// positive:
//
// 1. **Group completion.** Answering a checkbox group answers the whole
//    group: the members the clinician named are true, the rest false.
//    Rule 7's own justification is what bounds this — "every one of them
//    is voiced above, so no box is ever written false unheard" — and the
//    bound has two halves, because being on screen is not the same as
//    being heard:
//      - the group must belong to the ask that was just on screen, so a
//        checkbox volunteered out-of-ask completes nothing (its group
//        completes later, when its own ask voices it); AND
//      - the fact must declare `exclusive` or `voicesEveryMember`
//        (ask-inventory.ts). PB-3 asks for "race or ethnicity" without
//        naming its seven boxes and they are not alternatives, so
//        answering "White" must not write EthnicLatino false — race and
//        Hispanic ethnicity are orthogonal on this form.
//    The negative: an `unknown` or `declined` answer completes nothing.
//    "I don't know if she was hospitalized" is not an answer to the
//    outcome question, and must not write six boxes false.
//
// 2. **The bare-age default.** Rule 3's one recorded exception to
//    stated-only units: "a bare age defaults to years (unqualified
//    clinical ages are years; infant ages are always qualified)".
//    The negative, also rule 3's, and the reason weight is NOT here: "A
//    bare weight gets NO default — lb/kg is genuinely ambiguous — the
//    value writes and the unit stays open."
import type { AgendaRecord } from "./agenda";
import { factCompletesFromOne } from "./ask-inventory";
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

  // 1. Group completion, scoped to the ask that was actually voiced.
  if (step.kind === "topic") {
    for (const fact of step.ask.facts ?? []) {
      if (!isCheckboxGroup(fact.fieldIds)) continue;
      // Rule 7's bound, declared per fact: complete only where naming one
      // member entails the rest (mutually exclusive) or the ask reads
      // every member out loud. PB-3's race/ethnicity and SP-6's product
      // type are neither, and completing them would assert an absence
      // the clinician never stated — on PB-3, wrongly, since Hispanic
      // ethnicity is orthogonal to race (reviewer pass, PR #106, F1).
      if (!factCompletesFromOne(fact)) continue;
      if (!fact.fieldIds.some((id) => answeredIn(writes, id))) continue;
      for (const fieldId of fact.fieldIds) {
        if (alreadySettled(record, writes, fieldId)) continue;
        derived.push({ fieldId, type: "answer", value: "false" });
      }
    }
  }

  return [...derived, ...bareAgeDefaultWrites(record, writes)];
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
