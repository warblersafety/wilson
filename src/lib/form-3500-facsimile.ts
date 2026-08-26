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
// whole surface down, the same defensive convention PdfReview.tsx's
// displayValue() already uses for a stale/mismatched record.
import type { AgendaEntry } from "./agenda";
import { legalEnumOptions, type FormFieldSpec } from "./form-3500-fields";

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
