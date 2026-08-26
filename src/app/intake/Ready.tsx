"use client";

// The Ready surface (Issue #45) — design.md's surface 6: "honest
// completion: the filled PDF to download, answered/unknown/declined
// counts, and the reminder that wilson stores nothing on its own
// servers, so the download is the clinician's copy... No submission
// claims."
//
// Reference screen 07, reframed: its "Report filed / went to MedWatch /
// confirmation number" content is replaced outright, and its "Signed by"
// row omitted. The copy itself lives in src/lib/ready.ts, where a
// copy-level test asserts the no-submission-claims rule over all of it at
// once rather than leaving it to review-by-reading.
import { useState } from "react";
import { Dialog } from "@/components/Dialog";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { formatReadyCounts, READY_COPY, readyCounts, START_OVER_CONFIRM_COPY } from "@/lib/ready";
import type { TalkSession } from "@/lib/talk";
import { usePdfExport } from "./use-pdf-export";

interface ReadyProps {
  session: TalkSession;
  onStartOver: () => void;
}

export function Ready({ session, onStartOver }: ReadyProps) {
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const pdf = usePdfExport(session.record);
  const counts = readyCounts(session.record);

  return (
    <ReportChrome record={session.record} repeatCounts={session.repeatCounts} currentTopicId={null}>
      <main className="ready">
        <span className="ready__mark" aria-hidden="true">
          ✓
        </span>
        <h1 className="ready__heading">{READY_COPY.heading}</h1>
        <p className="ready__subhead">{READY_COPY.subhead}</p>

        {/* Screen 07's summary strip, two rows rather than four: the
            Confirmation row is dropped (there is no confirmation number,
            and inventing a format would be the exact claim design.md's
            no-submission-claims rule forbids) and "Signed by" omitted (no
            signature or timestamp capture exists in the manifest or in
            this unit's scope). */}
        <dl className="ready__summary">
          <div className="ready__summary-row">
            <dt className="ready__summary-label">{READY_COPY.formLabel}</dt>
            <dd className="ready__summary-value">{READY_COPY.formValue}</dd>
          </div>
          <div className="ready__summary-row">
            <dt className="ready__summary-label">{READY_COPY.fieldsLabel}</dt>
            <dd className="ready__summary-value">{formatReadyCounts(counts)}</dd>
          </div>
        </dl>

        <div className="ready__actions">
          <button
            type="button"
            className="ready__download"
            onClick={() => pdf.download()}
            disabled={pdf.status !== "ready"}
          >
            {READY_COPY.downloadCta}
          </button>
          <button type="button" className="ready__start-over" onClick={() => setConfirmingStartOver(true)}>
            {READY_COPY.startOverCta}
          </button>
        </div>

        {pdf.status === "loading" && (
          <p className="ready__pdf-status" role="status">
            Generating the PDF…
          </p>
        )}
        {pdf.status === "error" && (
          <div className="ready__pdf-status ready__pdf-status--error">
            <p role="alert">{pdf.error}</p>
            <button type="button" onClick={pdf.retry}>
              Try again
            </button>
          </div>
        )}

        <p className="ready__storage">{READY_COPY.storage}</p>

        {/* "Start over" asks first (AC-4). This is the only Start-over
            affordance in the rebuilt flow — Review deliberately has none,
            matching screen 05, and a wipe with no confirmation is exactly
            the thing there is no copy to go back from. */}
        {confirmingStartOver && (
          <Dialog labelledBy="start-over-heading" onDismiss={() => setConfirmingStartOver(false)}>
            <h2 id="start-over-heading" className="dialog__heading">
              {START_OVER_CONFIRM_COPY.heading}
            </h2>
            <p className="dialog__body">{START_OVER_CONFIRM_COPY.body}</p>
            <div className="dialog__actions">
              <button type="button" className="dialog__primary" onClick={() => setConfirmingStartOver(false)}>
                {START_OVER_CONFIRM_COPY.cancelCta}
              </button>
              <button type="button" className="dialog__secondary dialog__danger" onClick={onStartOver}>
                {START_OVER_CONFIRM_COPY.confirmCta}
              </button>
            </div>
          </Dialog>
        )}
      </main>
    </ReportChrome>
  );
}
