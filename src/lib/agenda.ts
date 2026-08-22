import { type FieldAction, type FieldState, transition } from "./field-state";
import { FORM_3500_FIELDS, type FormFieldSpec, type FormSection } from "./form-3500-fields";

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
  const entry = record[fieldId];
  if (!entry) {
    throw new Error(`unknown field id: ${fieldId}`);
  }
  const state = transition(entry.state, action);
  const nextValue = action.type === "answer" ? value : undefined;
  return { ...record, [fieldId]: { state, value: nextValue } };
}

// Fields are asked about in real form order: section A through G, then
// manifest order within a section — not FORM_3500_FIELDS's raw array order,
// which isn't guaranteed to already be grouped by section.
const SECTION_ORDER: FormSection[] = ["A", "B", "C", "D", "E", "F", "G"];

export function nextField(record: AgendaRecord): FormFieldSpec | null {
  for (const section of SECTION_ORDER) {
    for (const field of FORM_3500_FIELDS) {
      if (field.section === section && record[field.id]?.state === "unasked") {
        return field;
      }
    }
  }
  return null;
}
