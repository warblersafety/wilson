// The report chrome's (Issue #67) half of design.md's "one mapping
// truth" for the Form 3500 facsimile: scripts/fill-3500.py's
// render_value() decides what the PDF exporter writes for a (field,
// entry) pair; this decides what the HTML facsimile shows for the same
// pair. Ported rule-for-rule from render_value() (see that function's own
// comments for the reasoning behind each branch) but against the shared
// FORM_3500_FIELDS/legalEnumOptions() manifest already imported
// TS-side, and proven to agree via the SAME checked-in expectations
// (scripts/fixtures/report-chrome-reference-case.expected.json) both
// form-3500-facsimile.test.ts and
// scripts/tests/test_report_chrome_reference_case.py pin themselves
// against — there is no runtime bridge between vitest and pytest for a
// direct call to cross-check against instead.
//
// Deliberately non-throwing, unlike render_value(): that function guards
// an export gate (a malformed record must never reach the PDF), while
// this one renders a live preview during active data entry — a
// transient/invalid state degrades to blank here rather than taking the
// whole surface down, the same defensive convention every other
// AgendaRecord reader here uses for a stale/mismatched record (ready.ts's
// readyCounts(), review.ts's fieldDisplay()).
import type { AgendaEntry, AgendaRecord } from "./agenda";
import { fieldById, legalEnumOptions, type FormFieldSpec } from "./form-3500-fields";

export const UNKNOWN_SENTINEL = "Unknown";
export const DECLINED_SENTINEL = "Declined to answer";

// A checkbox's rendered value is always a boolean (or null); every other
// field type's is always a string (or null) — the sentinels included.
export function facsimileValue(field: FormFieldSpec, entry: AgendaEntry | undefined): string | boolean | null {
  const state = entry?.state ?? "unasked";
  const isCheckbox = field.type === "checkbox";

  if (state === "answered") {
    const value = entry?.value;
    if (typeof value !== "string" || !value.trim()) return null;
    if (field.type === "enum") {
      return legalEnumOptions(field).includes(value) ? value : null;
    }
    if (isCheckbox) {
      if (value !== "true" && value !== "false") return null;
      return value === "true";
    }
    return value;
  }

  if (state === "unknown") return isCheckbox ? null : UNKNOWN_SENTINEL;
  if (state === "declined") return isCheckbox ? null : DECLINED_SENTINEL;
  return null; // unasked
}

// --- composed facsimile values --------------------------------------------
//
// Some of the form's own boxes are one visual cell split across two or
// more manifest fields (a value plus a separate checkbox-per-unit group;
// a product's name/strength/unit/manufacturer). facsimileValue() above
// answers "what does ONE field show" — these answer "what does one
// FACSIMILE ROW show", composing several fields' facsimileValue() calls
// into the single string the row's label promises. Added after reviewer
// pass, PR #75, finding F1: the facsimile used to bind one row to one
// field, silently dropping the unit half of every such pair — rendering
// a bare "42" that reads as years even when the record's actual answered
// unit is AgeMonths. The exported PDF was never affected (each unit has
// its own widget); only this preview was silently misleading.

export interface RenderedFacsimileValue {
  text: string | null;
  muted: boolean;
}

// muted mirrors the underlying STATE (unknown/declined), never the
// string content — a clinician dictating the literal word "unknown"
// into a text field must not pick up the sentinel's own styling.
export function displayFor(record: AgendaRecord, fieldId: string): RenderedFacsimileValue {
  const field = fieldById(fieldId);
  if (!field) return { text: null, muted: false };
  const entry = record[fieldId];
  const value = facsimileValue(field, entry);
  if (value === null) return { text: null, muted: false };
  if (typeof value === "boolean") return { text: value ? "Yes" : null, muted: false };
  const state = entry?.state ?? "unasked";
  return { text: value, muted: state === "unknown" || state === "declined" };
}

function answeredValue(entry: AgendaEntry | undefined): string | null {
  return entry?.state === "answered" && entry.value ? entry.value : null;
}

function joinNonEmpty(parts: Array<string | null>, sep = " "): string | null {
  const present = parts.filter((p): p is string => !!p);
  return present.length > 0 ? present.join(sep) : null;
}

// A value field paired with a separate checkbox-per-unit group (Age:
// AgeYears/Months/Weeks/Days; Weight: WeightKG/WeightLB) — the two
// halves of one form box living in two manifest fields. Composes the
// checked unit's label onto the value; a sentinel/blank value is
// returned as-is (never "Unknown yr"), and a value with no unit answered
// yet renders bare rather than inventing one.
export function valueWithCheckedUnit(
  record: AgendaRecord,
  valueFieldId: string,
  unitLabels: ReadonlyArray<readonly [string, string]>,
): RenderedFacsimileValue {
  const value = displayFor(record, valueFieldId);
  if (value.text === null || value.muted) return value;
  const unit = unitLabels.find(([fieldId]) => answeredValue(record[fieldId]) === "true");
  return { text: unit ? `${value.text} ${unit[1]}` : value.text, muted: false };
}

export const AGE_UNIT_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["Page1.SecA_Patient.AgeYears", "yr"],
  ["Page1.SecA_Patient.AgeMonths", "mo"],
  ["Page1.SecA_Patient.AgeWeeks", "wk"],
  ["Page1.SecA_Patient.AgeDays", "day"],
];

export const WEIGHT_UNIT_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["Page1.SecA_Patient.WeightKG", "kg"],
  ["Page1.SecA_Patient.WeightLB", "lb"],
];

// Suspect product #1's dose box: Dose + DoseUnit + Freq, three manifest
// fields for one form cell ("875 mg BID").
export function doseWithUnitAndFrequency(record: AgendaRecord): RenderedFacsimileValue {
  const dose = displayFor(record, "Page4.Prod1.Prod1Dose");
  if (dose.text === null || dose.muted) return dose;
  const unit = answeredValue(record["Page4.Prod1.Prod1DoseUnit"]);
  const freq = answeredValue(record["Page4.Prod1.Prod1Freq"]);
  return { text: joinNonEmpty([joinNonEmpty([dose.text, unit]), freq]), muted: false };
}

// Suspect product #1's identity box: Name + Strength + StrengthUnit +
// Manufacturer/Compounder, four manifest fields for one form cell
// ("Amoxicillin 875 mg — Aurobindo Pharma"). The row's own label is the
// form's group caption, not "just the product name" — showing the name
// alone under that label previously implied strength/manufacturer
// weren't captured when both were in the record.
export function productIdentity(record: AgendaRecord): RenderedFacsimileValue {
  const name = displayFor(record, "Page4.Prod1.Prod1Name");
  if (name.text === null || name.muted) return name;
  const strength = answeredValue(record["Page4.Prod1.Prod1Strength"]);
  const unit = answeredValue(record["Page4.Prod1.Prod1StrengthUnit"]);
  const manufacturer = answeredValue(record["Page4.Prod1.Prod1ManuComp"]);
  const strengthPart = joinNonEmpty([strength, unit]);
  const withStrength = joinNonEmpty([name.text, strengthPart]);
  return { text: joinNonEmpty([withStrength, manufacturer ? `— ${manufacturer}` : null]), muted: false };
}
