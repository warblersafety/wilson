// The persistent frame around the intake and follow-ups surfaces (Issue
// #67, design.md "The report chrome"): "every mockup screen renders the
// six surfaces inside one persistent frame." Each surface (StartSurface,
// ReadBack, Wizard) mounts this itself around its own existing content,
// computing record/repeatCounts/currentTopicId from state it already
// owns — this component adds no state of its own and never changes the
// ask loop, extraction, or any write path, only what wraps them.
//
// Reference screens 01 (Start), 04 (Follow-ups), 05 (Review — chrome
// only; the center content at that fully-resolved moment is still
// whatever Wizard's own pre-#45 "done" branch renders, not the Review
// surface itself, which is Issue #45's scope). Enumerated deviations
// from the mockups live in this unit's PR description and manual-check
// note, per design.md's fidelity rule.
import type { ReactNode } from "react";
import type { AgendaRecord } from "@/lib/agenda";
import { patientIdentifier, recordFieldCounts, reportRailRows } from "@/lib/report-chrome";
import type { RepeatCounts } from "@/lib/topics";
import { Facsimile } from "./Facsimile";

interface ReportChromeProps {
  record: AgendaRecord;
  repeatCounts: RepeatCounts;
  // The topic currently being asked about, or null when nothing is (the
  // Start surface, before Read-back — no topic-by-topic loop has begun
  // yet — and once every topic is resolved). Callers already compute or
  // have this: Wizard.tsx's own currentTopicProgress() call, reused
  // as-is, or the same call seeded with a blank record for Read-back.
  currentTopicId: string | null;
  children: ReactNode;
}

export function ReportChrome({ record, repeatCounts, currentTopicId, children }: ReportChromeProps) {
  const rows = reportRailRows(record, repeatCounts, currentTopicId);
  const counts = recordFieldCounts(record);
  const identifier = patientIdentifier(record);
  const nothingWritten = counts.written === 0 && counts.unknown === 0;

  return (
    <div className="report-chrome">
      <nav className="report-rail" aria-label="Report progress">
        <div className="report-banner">
          <span className="report-banner__form">Form FDA 3500</span>
          <span className="report-banner__status">draft</span>
          {identifier && <span className="report-banner__patient">Patient {identifier}</span>}
        </div>
        <ol className="report-rail__rows">
          {rows.map(({ row, state }) => (
            <li key={row.id} className={`report-rail__row report-rail__row--${state}`}>
              <span className="report-rail__row-section" aria-hidden="true">
                {row.section}
              </span>
              <span className="report-rail__row-label">{row.label}</span>
              {state === "done" && (
                <span className="report-rail__row-mark" aria-label="done">
                  ✓
                </span>
              )}
              {state === "current" && (
                <span className="report-rail__row-mark report-rail__row-mark--current">now</span>
              )}
              {state === "unknown" && (
                <span className="report-rail__row-mark report-rail__row-mark--unknown">unknown</span>
              )}
            </li>
          ))}
        </ol>
        <div className="report-footer">
          {nothingWritten ? (
            <>
              <p className="report-footer__headline">Nothing written yet</p>
              <p className="report-footer__note">
                wilson asks one topic at a time — skip anything you don&rsquo;t have.
              </p>
            </>
          ) : (
            <>
              <p className="report-footer__headline">
                {counts.written} field{counts.written === 1 ? "" : "s"} written
                {counts.unknown > 0 ? ` · ${counts.unknown} unknown` : ""}
              </p>
              <p className="report-footer__note">A partial report is a valid report.</p>
            </>
          )}
        </div>
      </nav>
      <div className="report-chrome__content">{children}</div>
      <Facsimile record={record} counts={counts} />
    </div>
  );
}
