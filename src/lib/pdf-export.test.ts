import { describe, expect, it, vi } from "vitest";
import { applyAction, initAgenda } from "./agenda";
import { REPORT_DATE_FIELD_ID, stampReportDate } from "./report-date";
import { fetchReportPdf, PdfExportError, type PdfFetch } from "./pdf-export";

function okResponse(bytes: ArrayBuffer): ReturnType<PdfFetch> {
  return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) });
}

// The request body the fetch stub was handed. Typed here rather than cast
// at each call site, where vi.fn()'s inferred zero-arg tuple made
// `calls[0][1]` a type error.
function sentRecord(fetchImpl: { mock: { calls: unknown[][] } }): Record<string, { state: string; value?: string }> {
  return JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
}

describe("fetchReportPdf", () => {
  it("POSTs the record as JSON to /api/generate-pdf and returns the response bytes", async () => {
    const bytes = new TextEncoder().encode("FAKE-PDF").buffer;
    const fetchImpl = vi.fn(() => okResponse(bytes));
    const record = initAgenda();
    const today = new Date(2026, 7, 27);

    const result = await fetchReportPdf(record, fetchImpl, undefined, today);

    expect(fetchImpl).toHaveBeenCalledWith("/api/generate-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stampReportDate(record, today)),
    });
    expect(result).toBe(bytes);
  });

  // ask-copy.md rule 4: the one auto field, stamped on the way out.
  it("stamps today's report date into the exported record, never into the caller's", async () => {
    const fetchImpl = vi.fn(() => okResponse(new ArrayBuffer(0)));
    const record = initAgenda();
    const today = new Date(2026, 7, 27);

    await fetchReportPdf(record, fetchImpl, undefined, today);

    expect(sentRecord(fetchImpl)[REPORT_DATE_FIELD_ID]).toEqual({ state: "answered", value: "2026-08-27" });
    // The session's own record is untouched: the stamp belongs to the
    // export, so a draft resumed tomorrow carries tomorrow's date.
    expect(record[REPORT_DATE_FIELD_ID].state).toBe("unasked");
  });

  it("never overwrites a report date the clinician actually gave", async () => {
    const fetchImpl = vi.fn(() => okResponse(new ArrayBuffer(0)));
    const record = applyAction(initAgenda(), REPORT_DATE_FIELD_ID, { type: "answer" }, "2026-01-09");

    await fetchReportPdf(record, fetchImpl, undefined, new Date(2026, 7, 27));

    expect(sentRecord(fetchImpl)[REPORT_DATE_FIELD_ID].value).toBe("2026-01-09");
  });

  it("throws PdfExportError on a non-ok response, without leaking the body", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: false, status: 500, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
    );
    await expect(fetchReportPdf(initAgenda(), fetchImpl)).rejects.toThrow(PdfExportError);
    await expect(fetchReportPdf(initAgenda(), fetchImpl)).rejects.toThrow(/500/);
  });

  it("throws PdfExportError when the fetch call itself rejects", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new Error("network down, carrying field abc=xyz")));
    let caught: unknown;
    try {
      await fetchReportPdf(initAgenda(), fetchImpl);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(PdfExportError);
    expect((caught as Error).message).not.toMatch(/field abc=xyz/);
  });
});
