import { type FieldAction, type FieldState, transition } from "./field-state";
import { FORM_3500_FIELDS } from "./form-3500-fields";

export interface AgendaEntry {
  state: FieldState;
  value?: string;
}

export type AgendaRecord = Record<string, AgendaEntry>;

export function initAgenda(): AgendaRecord {
  const record: AgendaRecord = {};
  for (const field of FORM_3500_FIELDS) {
    record[field.id] = { state: "unasked" };
  }
  return record;
}

export function applyAction(
  record: AgendaRecord,
  fieldId: string,
  action: FieldAction,
  value?: string,
): AgendaRecord {
  // Object.hasOwn, not a truthy check on record[fieldId]: plain bracket
  // access on a plain object resolves inherited Object.prototype members
  // (e.g. fieldId "constructor"), which would otherwise slip past this
  // guard as if it were a real field.
  if (!Object.hasOwn(record, fieldId)) {
    throw new Error(`unknown field id: ${fieldId}`);
  }
  if (action.type === "answer" && !value) {
    throw new Error(`answer action for ${fieldId} requires a non-empty value`);
  }
  const entry = record[fieldId];
  const state = transition(entry.state, action);
  // "reopen" retains whatever value was already recorded (Issue #44,
  // design.md's reopen semantics: "reopened fields retain their prior
  // values until a replacement is written — reopen never wipes"). The
  // review-stage re-ask path sends a field back to `unasked` so it flows
  // through the normal ask/extract turn again, but a clinician who
  // reopens a topic and doesn't immediately re-answer every one of its
  // fields must still see what they said before, not a blanked field
  // that reads as never-answered. Every other transition keeps clearing
  // the value on non-"answer" actions: `mark_unknown`/`decline` have no
  // value of their own to carry, and always overwriting on those two
  // (rather than conditionally retaining like reopen does) keeps a
  // stale prior value from resurfacing if a field is later reopened
  // again after being marked unknown/declined in between.
  const nextValue = action.type === "answer" ? value : action.type === "reopen" ? entry.value : undefined;
  return { ...record, [fieldId]: { state, value: nextValue } };
}
