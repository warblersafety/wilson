// The Ready surface's pure logic and copy (Issue #45) — design.md's
// surface 6: "honest completion: the filled PDF to download,
// answered/unknown/declined counts, and the reminder that wilson stores
// nothing on its own servers, so the download is the clinician's copy...
// No submission claims: wilson fills and exports the form, like lucy;
// there is no MedWatch e-submission pipeline, so no 'filed with FDA'
// language and no confirmation numbers anywhere in the UI."
//
// The user-visible strings live here as exported constants, not inline in
// the component, for two reasons: the repo's logic-in-lib convention, and
// so ready.test.ts can assert the no-submission-claims rule mechanically
// over all of them at once (AC-3's "copy-level check" option) rather than
// leaving it to a manual note a future edit could quietly drift past.
import type { AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";

export interface ReadyCounts {
  answered: number;
  unknown: number;
  declined: number;
}

// The three-way split design.md's Ready section names — a sibling to
// report-chrome.ts's two-way recordFieldCounts(), never a replacement for
// it. The footer groups `declined` with `unknown` and design.md's own
// example quotes it that way ("18 fields written · 2 unknown"); Ready
// names all three. The two surfaces intentionally show different
// granularities, so both functions stay.
//
// `unasked` counts in no bucket: screen 07's own summary ("41 written · 3
// unknown · 0 declined") sums to 44 of the form's 227 fields, so the
// mockup's math already treats a never-reached field as nothing to
// report, not as a fourth number.
export function readyCounts(record: AgendaRecord, fields: FormFieldSpec[] = FORM_3500_FIELDS): ReadyCounts {
  const counts: ReadyCounts = { answered: 0, unknown: 0, declined: 0 };
  for (const field of fields) {
    // Degrades to "unasked" on a missing entry rather than throwing — a
    // stale/mismatched record must not take this surface down mid-render,
    // the same defensive convention form-3500-facsimile.ts records.
    const state = record[field.id]?.state ?? "unasked";
    if (state === "answered") counts.answered++;
    else if (state === "unknown") counts.unknown++;
    else if (state === "declined") counts.declined++;
  }
  return counts;
}

// Screen 07's Fields row, verbatim. Every bucket stays visible at zero —
// zero-suppressing "0 declined" would make an honest count read as an
// omission, and the mockup itself shows the zero.
export function formatReadyCounts(counts: ReadyCounts): string {
  return `${counts.answered} written · ${counts.unknown} unknown · ${counts.declined} declined`;
}

// Enumerated deviations from screen 07 (design.md's fidelity rule), all
// three following from the no-submission-claims rule or from what the
// manifest actually holds:
//   - "Report filed." → "Report ready."; the "went to MedWatch with your
//     sign-off on it" line is replaced outright. (The mockup's "Two
//     minutes, forty seconds from pressing the mic" boast goes with it —
//     wilson owns no microphone.)
//   - The Confirmation row ("MW-2026-08-0041") is dropped, not reworded:
//     there is no confirmation number to show and inventing a format
//     would be the exact claim the rule forbids.
//   - The "Signed by" row is omitted: no signature or timestamp capture
//     exists in the manifest or anywhere in this unit's scope, and adding
//     one would be new scope past the frozen AC.
export const READY_COPY = {
  heading: "Report ready.",
  subhead:
    "Form FDA 3500 is filled out as you signed off on it. wilson prepares the form — it never sends anything to FDA on your behalf.",
  formLabel: "Form",
  formValue: "FDA 3500 · voluntary report",
  fieldsLabel: "Fields",
  downloadCta: "Download the PDF",
  startOverCta: "Report another",
  // Near-verbatim from design.md, and deliberately scoped to wilson's own
  // storage: the privacy-copy rule forbids implying the model-provider
  // path is unretained while the DPA item is open, which the mockup's
  // broader "We keep nothing... the only copy that exists outside FDA"
  // would do.
  storage: "wilson stores nothing on its own servers — this download is your copy.",
} as const;

export const START_OVER_CONFIRM_COPY = {
  heading: "Start a new report?",
  body: "This clears everything in the current report from this browser. There is no copy to go back to — download the PDF first if you want one.",
  confirmCta: "Clear and start over",
  cancelCta: "Keep this report",
} as const;
