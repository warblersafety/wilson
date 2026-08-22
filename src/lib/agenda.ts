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
  const nextValue = action.type === "answer" ? value : undefined;
  return { ...record, [fieldId]: { state, value: nextValue } };
}
