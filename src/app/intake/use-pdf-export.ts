"use client";

// The PDF generate/download mechanics both closing surfaces need (Issue
// #45): Review offers the rendered Form 3500 "one click away rather than
// leading the layout" (design.md), and Ready offers it as the download.
// Factored out of PdfReview.tsx — the pre-amendment component design.md's
// 2026-08-25 amendment supersedes — rather than reimplemented, so the
// mechanics that were already proven in production keep working:
//
//   - regeneration on every record change (a new object every write, per
//     applyAction()/reopenTopic()'s immutability), so an edit never
//     leaves a stale preview on screen;
//   - an AbortController per request, so a superseded request gives
//     itself up rather than running the server-side fill to completion
//     with its result thrown away;
//   - object-URL revoke on replacement and on unmount, or they leak for
//     the page's lifetime;
//   - the WebKit download workaround: some Safari versions only honor a
//     click on an <a download> that is actually attached to the document.
//
// Genuinely new here: a retry affordance. Nothing in this codebase had
// one before (the deleted component's error state was terminal — an
// error meant reloading the page or editing something to re-fire the
// effect), and this unit's AC requires "(re)generation states show
// progress and failures with friendly copy and retry."
import { useCallback, useEffect, useState } from "react";
import type { AgendaRecord } from "@/lib/agenda";
import { fetchReportPdf } from "@/lib/pdf-export";

// The friendly-copy convention (chip-grammar.ts's friendlyFailureMessage,
// Issue #44's AC: "server/extraction failures surface as friendly copy
// with a retry, never err.message"), applied to this unit's own new
// surfaces. One honest message rather than a per-error-string guess:
// PdfExportError's own two messages ("Could not reach the PDF service",
// "PDF generation failed (status N)") name a transport failure and a
// server failure, and neither asks anything different of the clinician.
export const PDF_FAILURE_MESSAGE = "Something went wrong generating the PDF. Check your connection and try again.";

export type PdfExportStatus = "loading" | "ready" | "error";

export interface PdfExport {
  status: PdfExportStatus;
  pdfUrl: string | null;
  error: string | null;
  download: (filename?: string) => void;
  retry: () => void;
}

export function usePdfExport(record: AgendaRecord): PdfExport {
  const [status, setStatus] = useState<PdfExportStatus>("loading");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped by retry() to re-run the effect against the SAME record —
  // the effect's other dependency never changes on a retry, so without
  // this there is nothing for React to notice.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setStatus("loading");
    setError(null);
    fetchReportPdf(record, fetch, controller.signal)
      .then((bytes) => {
        if (cancelled) return;
        setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: "application/pdf" })));
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        // Never the caught error's own message: pdf-export.ts already
        // keeps field values out of what it throws, and this surface
        // shows the clinician one friendly line either way.
        setError(PDF_FAILURE_MESSAGE);
        setStatus("error");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [record, attempt]);

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  const download = useCallback(
    (filename = "form-3500.pdf") => {
      if (!pdfUrl) return;
      const link = document.createElement("a");
      link.href = pdfUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    },
    [pdfUrl],
  );

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, pdfUrl, error, download, retry };
}
