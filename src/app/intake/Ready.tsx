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
import { PDF_COPY } from "@/lib/review";
import type { TalkSession } from "@/lib/talk";
import { usePdfExport } from "./use-pdf-export";
import { stampReportDate } from "@/lib/report-date";
import { SessionDownloads } from "./SessionDownloads";

interface ReadyProps {
  session: TalkSession;
  onStartOver: () => void;
}

export function Ready({ session, onStartOver }: ReadyProps) {
  const [confirmingStartOver, setConfirmingStartOver] = useState(false);
  const pdf = usePdfExport(session.record);
  // Counted from the record the PDF actually carries, stamp included:
  // this line sits beside a download offering that PDF, and describing
  // one fewer written field than it contains is the same inconsistency
  // the facsimile's header had (reviewer pass, PR #107, nit a).
  const counts = readyCounts(stampReportDate(session.record, new Date()));

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
            {PDF_COPY.generating}
          </p>
        )}
        {pdf.status === "error" && (
          <div className="ready__pdf-status ready__pdf-status--error">
            <p role="alert">{pdf.error}</p>
            <button type="button" onClick={pdf.retry}>
              {PDF_COPY.retryCta}
            </button>
          </div>
        )}

        {/* AC-1's other two downloads. Above the storage line on
            purpose: that line is the reason all three exist ("wilson
            stores nothing on its own servers — this download is your
            copy"), so it reads as the caption to the whole offering
            rather than to the PDF alone. */}
        <SessionDownloads session={session} />

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
