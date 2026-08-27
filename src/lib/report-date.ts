// docs/ask-copy.md rule 4's one auto field: `ReportDate` is "stamped with
// the current date at export, shown and editable at Review, never asked".
//
// Stamped at EXPORT rather than written into the record when the session
// starts, deliberately: a draft a clinician returns to tomorrow should
// carry tomorrow's date, not the date they happened to open the tab. The
// record stays the clinician's; this is wilson's own contribution, added
// on the way out.
//
// Whatever the clinician answered wins. Nothing here overwrites an
// existing value, so a reopened-and-restated report date survives export.
import { applyAction, type AgendaRecord } from "./agenda";

export const REPORT_DATE_FIELD_ID = "Page1.SecA_Patient.ReportDate";

// ISO yyyy-mm-dd, from a Date the caller supplies — never `new Date()`
// read inside a pure function, so a test can pin the output and the
// stamp cannot vary by when the suite happens to run.
export function formatReportDate(today: Date): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

// The record as it should leave for the PDF: the clinician's own, plus
// today's date in the one field they are never asked for.
export function stampReportDate(record: AgendaRecord, today: Date): AgendaRecord {
  // A RETAINED value counts as the clinician's, not just an answered one:
  // a reopened report date keeps its prior value with state `unasked`
  // ("reopen never wipes"), and stamping over it made Review show
  // "you said: 2026-08-01" while the export carried today (reviewer pass,
  // PR #107, F6).
  if (record[REPORT_DATE_FIELD_ID]?.value !== undefined) return record;
  return applyAction(record, REPORT_DATE_FIELD_ID, { type: "answer" }, formatReportDate(today));
}
