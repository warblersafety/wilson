"use client";

// The Review surface (Issue #45) — design.md's surface 4: "field-led
// sectioned cards (form sections A–G), every topic editable; an edit
// reopens the topic as a normal question (the existing reopen path). The
// rendered Form 3500 PDF stays one click away rather than leading the
// layout — legible values and obvious gaps beat pen-sized paper for
// editing; the paper is there for trust."
//
// Reference screen 05, plus screen 06 for the Open-fields dialog this
// surface owns (design.md: it "is enumerated as a surface because it
// carries its own rules and state, not its own screen"). All derivation
// lives in src/lib/review.ts and src/lib/open-fields.ts; this component
// renders it and owns only which dialog is showing.
//
// Mounts the report chrome itself, as every other surface does — Wizard
// unmounts its own at hand-off, and design.md's "every mockup screen
// renders the six surfaces inside one persistent frame" applies here too.
// currentTopicId is null: nothing is being asked at Review, the same null
// Wizard's own done state produced.
import { useState } from "react";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { hasOpenFields } from "@/lib/open-fields";
import type { CuratedRow } from "@/lib/report-chrome";
import { reopenReviewRow, reviewFieldRows, reviewRows, SIGN_OFF_CTA } from "@/lib/review";
import type { TalkSession } from "@/lib/talk";
import { FORM_3500_SECTIONS } from "@/lib/form-3500-fields";
import { OpenFieldsDialog } from "./OpenFieldsDialog";
import { usePdfExport } from "./use-pdf-export";

interface ReviewProps {
  session: TalkSession;
  // Reopens a row and returns to Follow-ups for the re-ask. Review never
  // writes the record itself — it hands the reopened one up, and the
  // caller persists it before the surface flips (so a reload lands on the
  // reopened session, not the pre-edit one).
  onEdit: (session: TalkSession) => void;
  onReady: (session: TalkSession) => void;
}

export function Review({ session, onEdit, onReady }: ReviewProps) {
  const [showOpenFields, setShowOpenFields] = useState(false);
  const [showPaper, setShowPaper] = useState(false);
  const pdf = usePdfExport(session.record);

  const rows = reviewRows(session.repeatCounts);

  function handleEditRow(row: CuratedRow) {
    onEdit({ ...session, record: reopenReviewRow(session.record, row, session.repeatCounts) });
  }

  // The nudge, never a gate: with nothing open this goes straight
  // through, and with fields open it still only opens a dialog whose
  // "Finish as it stands" is always live (src/lib/open-fields.ts).
  function handleSignOff() {
    if (hasOpenFields(session.record, session.repeatCounts)) {
      setShowOpenFields(true);
      return;
    }
    onReady(session);
  }

  return (
    <ReportChrome record={session.record} repeatCounts={session.repeatCounts} currentTopicId={null}>
      <main className="review">
        <h1 className="review__heading">Review before you sign off.</h1>
        <p className="review__intro">
          Your signature is the safety boundary, not mine. Edit anything and I&rsquo;ll ask about it again.
        </p>

        <div className="review__cards">
          {rows.map((row) => (
            <section key={row.id} className="review__card" aria-labelledby={`review-card-${row.id}`}>
              <div className="review__card-header">
                <h2 id={`review-card-${row.id}`} className="review__card-title">
                  {row.section} · {row.label}
                </h2>
                <span className="review__card-section">{FORM_3500_SECTIONS[row.section]}</span>
                <button type="button" className="review__edit" onClick={() => handleEditRow(row)}>
                  Edit
                </button>
              </div>
              <dl className="review__fields">
                {reviewFieldRows(session.record, row, session.repeatCounts).map((field) => (
                  <div key={field.fieldId} className="review__field">
                    <dt className="review__field-label">{field.label}</dt>
                    <dd
                      className={
                        field.muted
                          ? "review__field-value review__field-value--muted"
                          : field.retained
                            ? "review__field-value review__field-value--retained"
                            : "review__field-value"
                      }
                    >
                      {/* A reopened field still carrying its prior value:
                          design.md's "reopen never wipes", finally
                          visible (PR #64, finding 7). */}
                      {field.retained ? `you said: ${field.text}` : (field.text ?? "—")}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <div className="review__actions">
          <button type="button" className="review__sign-off" onClick={handleSignOff}>
            {SIGN_OFF_CTA}
          </button>
          <button type="button" className="review__paper-toggle" onClick={() => setShowPaper((shown) => !shown)}>
            {showPaper ? "Hide the draft PDF" : "Show the draft PDF"}
          </button>
          <button type="button" onClick={() => pdf.download()} disabled={pdf.status !== "ready"}>
            Download the draft PDF
          </button>
        </div>

        {/* Outside the toggle on purpose: the download button above is
            disabled until the PDF is ready, and a clinician who never
            opens the paper still has to be told why — the AC's
            "(re)generation states show progress and failures with
            friendly copy and retry" is about the export, not the
            preview. */}
        {pdf.status === "loading" && (
          <p className="review__pdf-status" role="status">
            Generating the PDF…
          </p>
        )}
        {pdf.status === "error" && (
          <div className="review__pdf-status review__pdf-status--error">
            <p role="alert">{pdf.error}</p>
            <button type="button" onClick={pdf.retry}>
              Try again
            </button>
          </div>
        )}

        {/* One click away, never the layout's lead (design.md) — the
            paper is here for trust, and the legible cards above are what
            editing actually runs on. */}
        {showPaper && pdf.status === "ready" && pdf.pdfUrl && (
          <div className="review__paper">
            <embed src={pdf.pdfUrl} type="application/pdf" className="review__paper-frame" title="Form 3500 preview" />
          </div>
        )}

        {showOpenFields && (
          <OpenFieldsDialog
            record={session.record}
            repeatCounts={session.repeatCounts}
            rows={rows}
            onAnswer={(row) => {
              setShowOpenFields(false);
              handleEditRow(row);
            }}
            onFinishAsIs={() => {
              setShowOpenFields(false);
              onReady(session);
            }}
            onDismiss={() => setShowOpenFields(false)}
          />
        )}
      </main>
    </ReportChrome>
  );
}
