// Calls api/generate-pdf.py (Issue #34) to fill the Form 3500 PDF from the
// session's current record, for the wizard's review step.
//
// `PdfFetch`, not the real DOM `fetch`/`Response` types: src/lib is
// typechecked under tsconfig.node.json, whose lib list has no "dom" (same
// reason session-storage.ts defines `StorageLike` instead of using the
// real Storage type). window.fetch already satisfies this interface
// structurally, so the wizard passes it straight through with no adapter.
import type { AgendaRecord } from "./agenda";
import { stampReportDate } from "./report-date";

export interface PdfFetchResponse {
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type PdfFetch = (
  url: string,
  init: { method: "POST"; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<PdfFetchResponse>;

export class PdfExportError extends Error {}

// Returns the filled PDF's raw bytes. Never returns partial/garbage bytes
// silently — a non-ok response or a transport failure both throw
// PdfExportError rather than handing back whatever arrived. `signal`
// lets a caller give up on a superseded request (usePdfExport regenerates
// on every record change) rather than let it run to completion unused.
export async function fetchReportPdf(
  record: AgendaRecord,
  fetchImpl: PdfFetch,
  signal?: AbortSignal,
  today: Date = new Date(),
): Promise<ArrayBuffer> {
  // ask-copy.md rule 4: the report date is stamped here, on the way out,
  // and never asked. Applied to the request rather than to the session's
  // record, so a draft resumed tomorrow exports with tomorrow's date
  // rather than the day the tab happened to be opened.
  const exported = stampReportDate(record, today);
  let response: PdfFetchResponse;
  try {
    response = await fetchImpl("/api/generate-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exported),
      signal,
    });
  } catch {
    // Never the caught error's own message: on this route that could be
    // anything a transport layer chose to say, and design.md's rule
    // against a field value ever reaching a log applies the same way it
    // does server-side.
    throw new PdfExportError("Could not reach the PDF service.");
  }
  if (!response.ok) {
    throw new PdfExportError(`PDF generation failed (status ${response.status}).`);
  }
  return response.arrayBuffer();
}
