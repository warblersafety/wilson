import { describe, expect, it, vi } from "vitest";
import { initAgenda } from "./agenda";
import { fetchReportPdf, PdfExportError, type PdfFetch } from "./pdf-export";

function okResponse(bytes: ArrayBuffer): ReturnType<PdfFetch> {
  return Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) });
}

describe("fetchReportPdf", () => {
  it("POSTs the record as JSON to /api/generate-pdf and returns the response bytes", async () => {
    const bytes = new TextEncoder().encode("FAKE-PDF").buffer;
    const fetchImpl = vi.fn(() => okResponse(bytes));
    const record = initAgenda();

    const result = await fetchReportPdf(record, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith("/api/generate-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    expect(result).toBe(bytes);
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
