"use client";

// The review/edit/export step (Issue #34) — reached at `{kind: "done"}`.
// Renders the actual filled Form 3500 PDF inline for the clinician to
// review (2026-08-23 design decision: the charter's end condition names
// reviewing "a … PDF" specifically, not a summary of its data — lucy's
// download-only pattern doesn't satisfy that wording), lists every
// topic's text/date answers next to an Edit affordance, and offers the
// PDF as a download.
import { useEffect, useState } from "react";
import { type AgendaRecord } from "@/lib/agenda";
import { FORM_3500_FIELDS, type FormFieldSpec } from "@/lib/form-3500-fields";
import { fetchReportPdf, PdfExportError } from "@/lib/pdf-export";
import { TOPICS, type Topic } from "@/lib/topics";

const FIELDS_BY_ID = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));

// Mirrors scripts/fill-3500.py's UNKNOWN_SENTINEL/DECLINED_SENTINEL — the
// same words that land in the generated PDF, so the review list reads as
// the same report, not a second, differently-worded account of it.
function displayValue(record: AgendaRecord, fieldId: string): string {
  const entry = record[fieldId];
  if (entry.state === "answered") return entry.value ?? "";
  if (entry.state === "unknown") return "Unknown";
  if (entry.state === "declined") return "Declined to answer";
  return "";
}

function textDateFieldsOf(topic: Topic): FormFieldSpec[] {
  return topic.fieldIds
    .map((id) => FIELDS_BY_ID.get(id))
    .filter((f): f is FormFieldSpec => f !== undefined && (f.type === "text" || f.type === "date"));
}

interface PdfReviewProps {
  record: AgendaRecord;
  onEditTopic: (topic: Topic) => void;
  disabled?: boolean;
}

export function PdfReview({ record, onEditTopic, disabled = false }: PdfReviewProps) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Regenerates whenever the record changes (a new object every write, per
  // applyAction()/reopenTopic()'s immutability), so an edit never leaves a
  // stale preview on screen — AC #34.
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    fetchReportPdf(record, fetch)
      .then((bytes) => {
        if (cancelled) return;
        const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setPdfUrl(url);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof PdfExportError ? err.message : "Could not generate the PDF.");
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [record]);

  // Object URLs otherwise leak for the page's lifetime — revoke the
  // previous one every time a new one replaces it, and on unmount.
  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  function handleDownload() {
    if (!pdfUrl) return;
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.download = "form-3500.pdf";
    link.click();
  }

  const topicsWithTextDate = TOPICS.map((topic) => ({ topic, fields: textDateFieldsOf(topic) })).filter(
    ({ fields }) => fields.length > 0,
  );

  return (
    <section className="pdf-review" aria-label="Review the generated report">
      <h2>Review your report</h2>
      {status === "loading" && <p role="status">Generating the PDF…</p>}
      {status === "error" && (
        <p className="pdf-review__error" role="alert">
          {error}
        </p>
      )}
      {status === "ready" && pdfUrl && (
        <embed src={pdfUrl} type="application/pdf" className="pdf-review__frame" title="Form 3500 preview" />
      )}
      <button type="button" onClick={handleDownload} disabled={disabled || status !== "ready"}>
        Download PDF
      </button>

      <div className="pdf-review__topics">
        {topicsWithTextDate.map(({ topic, fields }) => (
          <div key={topic.id} className="pdf-review__topic">
            <h3>{topic.label}</h3>
            <dl>
              {fields.map((field) => (
                <div key={field.id} className="pdf-review__field">
                  <dt>{field.label}</dt>
                  <dd>{displayValue(record, field.id) || "—"}</dd>
                </div>
              ))}
            </dl>
            <button type="button" disabled={disabled} onClick={() => onEditTopic(topic)}>
              Edit {topic.label}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
