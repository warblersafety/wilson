// The Ready surface's pure logic and copy (Issue #45) — design.md's
// surface 6: "honest completion: the filled PDF to download,
// answered/unknown/declined counts, and the reminder that wilson stores
// nothing on its own servers, so the download is the clinician's copy...
// No submission claims: wilson fills and exports the form, like lucy;
// there is no MedWatch e-submission pipeline, so no 'filed with FDA'
// language and no confirmation numbers anywhere in the UI."
//
// The user-visible strings live here as exported constants, not inline in
// the component, for two reasons: the repo's logic-in-lib convention, and
// so ready.test.ts can assert the no-submission-claims rule mechanically
// over all of them at once (AC-3's "copy-level check" option) rather than
// leaving it to a manual note a future edit could quietly drift past.
import type { AgendaRecord } from "./agenda";
import { dispositionOf } from "./ask-inventory";
import { factGroups } from "./open-fields";
import { TOPICS, type Topic } from "./topics";
import { PDF_COPY } from "./review";

export interface ReadyCounts {
  answered: number;
  unknown: number;
  declined: number;
}

// The three-way split design.md's Ready section names — a sibling to
// report-chrome.ts's two-way recordFieldCounts(), never a replacement for
// it. The footer groups `declined` with `unknown` and design.md's own
// example quotes it that way ("18 fields written · 2 unknown"); Ready
// names all three. The two surfaces intentionally show different
// granularities, so both functions stay.
//
// `unasked` counts in no bucket: screen 07's own summary ("41 written · 3
// unknown · 0 declined") sums to 44 of the form's 227 fields, so the
// mockup's math already treats a never-reached field as nothing to
// report, not as a fourth number.
//
// Counts FACTS, not fields — ask-copy.md rule 8's #127 amendment
// (definition added with the build, rev 3): "written" is any member
// answered; "unknown" is no member answered and at least one unknown;
// "declined" is no member answered and at least one declined — checked
// in that order, so a fact with no answered member but BOTH an unknown
// and a declined one (not reached by any of the five gate cases, and
// not obviously reachable at all given a dismiss chip applies one
// action to a whole still-open set at once) lands in `unknown`, the
// bucket this passage states first. A fact can therefore be `answered`
// AND still open on the dialog — a half-held RC-1 is both — which is
// why this count is no longer the arithmetic complement of
// openFieldEntries()'s own; see the amendment for the reasoning.
// Grouped via factGroups(), the same walk the dialog collapses rows
// with, so the two can never disagree about which fields are one fact.
//
// Rule 4's auto field (`ReportDate`) is excluded too, added 2026-08-29
// (#127) — the same fix report-chrome.ts's sibling recordFieldCounts()
// gets, for the same reason: this is called against the STAMPED record
// (Ready.tsx counts the record the download actually carries), so
// without the exclusion `answered` never reads zero even on a session
// the clinician answered nothing in. ReportDate is never part of a
// multi-field fact, so it is always its own singleton group — filtered
// per-group rather than assumed.
export function readyCounts(record: AgendaRecord, topics: Topic[] = TOPICS): ReadyCounts {
  const counts: ReadyCounts = { answered: 0, unknown: 0, declined: 0 };
  for (const group of factGroups(topics)) {
    const members = group.filter((id) => dispositionOf(id) !== "auto");
    if (members.length === 0) continue;
    // Degrades to "unasked" on a missing entry rather than throwing — a
    // stale/mismatched record must not take this surface down mid-render,
    // the same defensive convention form-3500-facsimile.ts records.
    const states = members.map((id) => record[id]?.state ?? "unasked");
    if (states.some((s) => s === "answered")) counts.answered++;
    else if (states.some((s) => s === "unknown")) counts.unknown++;
    else if (states.some((s) => s === "declined")) counts.declined++;
  }
  return counts;
}

// Screen 07's Fields row, verbatim. Every bucket stays visible at zero —
// zero-suppressing "0 declined" would make an honest count read as an
// omission, and the mockup itself shows the zero.
export function formatReadyCounts(counts: ReadyCounts): string {
  return `${counts.answered} written · ${counts.unknown} unknown · ${counts.declined} declined`;
}

// Enumerated deviations from screen 07 (design.md's fidelity rule), all
// three following from the no-submission-claims rule or from what the
// manifest actually holds:
//   - "Report filed." → "Report ready."; the "went to MedWatch with your
//     sign-off on it" line is replaced outright. (The mockup's "Two
//     minutes, forty seconds from pressing the mic" boast goes with it —
//     wilson owns no microphone.)
//   - The Confirmation row ("MW-2026-08-0041") is dropped, not reworded:
//     there is no confirmation number to show and inventing a format
//     would be the exact claim the rule forbids.
//   - The "Signed by" row is omitted: no signature or timestamp capture
//     exists in the manifest or anywhere in this unit's scope, and adding
//     one would be new scope past the frozen AC.
export const READY_COPY = {
  heading: "Report ready.",
  // Shown instead of `heading` while PDF generation has failed (Issue
  // #128, AC-1: the surface must not claim the report is ready — meaning
  // the PDF is in hand — while it demonstrably is not). Deliberately
  // parallel to `heading` rather than a new voice: "ready" (a claim about
  // the PDF) becomes "signed off" (a claim about the record, which stays
  // true regardless of what the export request did).
  failureHeading: "Report signed off.",
  subhead:
    "Form FDA 3500 is filled out as you signed off on it. wilson prepares the form — it never sends anything to FDA on your behalf.",
  formLabel: "Form",
  formValue: "FDA 3500 · voluntary report",
  // "Items", not "Fields" — ask-copy.md rule 8 (#127): the row beside
  // this label is a written/unknown/declined tally, and screen 07's own
  // noun stopped matching the open-fields dialog beside it the moment
  // that dialog started counting facts instead of fields.
  itemsLabel: "Items",
  downloadCta: "Download the PDF",
  startOverCta: "Report another",
  // Near-verbatim from design.md, and deliberately scoped to wilson's own
  // storage: the privacy-copy rule forbids implying the model-provider
  // path is unretained while the DPA item is open, which the mockup's
  // broader "We keep nothing... the only copy that exists outside FDA"
  // would do.
  storage: "wilson stores nothing on its own servers — this download is your copy.",
} as const;

// The Ready surface's PDF-generation status (Issue #128) — structurally
// identical to usePdfExport's own PdfExportStatus
// (src/app/intake/use-pdf-export.ts), declared locally rather than
// imported: src/lib is typechecked without the DOM lib
// (tsconfig.node.json), so this file cannot import anything under
// src/app, and a plain string-literal union needs no shared name to
// type-check against the hook's own `status` field at the call site.
export type PdfGenerationStatus = "loading" | "ready" | "error";

// The Ready surface's whole rendering decision for a given generation
// status, kept out of Ready.tsx so the one-state-at-a-time contract is
// provable under vitest's node environment (ready.test.ts) rather than
// only by reading the component. Ready.tsx is a thin switch over this —
// it calls readySurfaceView(pdf.status) once and reads nothing else off
// pdf.status directly — so what this function returns is what actually
// renders, not a parallel claim about it.
export interface ReadySurfaceView {
  state: "attempting" | "succeeded" | "failed";
  // The surface's H1. Never READY_COPY.heading while `state` is "failed"
  // — that is AC-1's whole rule, made structural rather than a convention
  // a future edit could quietly violate.
  heading: string;
  // The checkmark. Withheld on failure along with the heading it
  // decorates — a success glyph over a failure notice is the same
  // over-claim in a different form.
  showMark: boolean;
  // Whether the Download CTA renders AT ALL. False on failure: an earlier
  // version left it in place merely disabled, but a prominent CTA next to
  // "generation failed" reads as offered regardless of the attribute
  // (Issue #128, finding 1's second half) — failure gets the retry
  // button instead, not a greyed-out sibling of the one that didn't work.
  showDownload: boolean;
  // Whether the (rendered) Download CTA is clickable. Only true once
  // bytes are actually in hand.
  downloadEnabled: boolean;
  // The "Generating the PDF…" status line — attempting only.
  showGenerating: boolean;
  // PDF_COPY.failure while failed, null otherwise — the one place this
  // surface's failure copy is decided, so success can never render it as
  // a stale remnant of a prior attempt.
  failureMessage: string | null;
}

export function readySurfaceView(pdfStatus: PdfGenerationStatus): ReadySurfaceView {
  if (pdfStatus === "error") {
    return {
      state: "failed",
      heading: READY_COPY.failureHeading,
      showMark: false,
      showDownload: false,
      downloadEnabled: false,
      showGenerating: false,
      failureMessage: PDF_COPY.failure,
    };
  }
  const succeeded = pdfStatus === "ready";
  return {
    // "attempting" while loading, whether this is the first request or a
    // retry — usePdfExport re-runs the same effect either way (retry()
    // just bumps the `attempt` dependency), so there is only one loading
    // state to model, not a separate "retrying" one.
    state: succeeded ? "succeeded" : "attempting",
    // Truthful before generation succeeds, not only after (implementation
    // guidance for Issue #128): the record IS signed off from the moment
    // this surface is reached, whether or not the PDF bytes have arrived
    // — AC-1 scopes the no-ready-claim rule to the failed state only, so
    // the attempting and succeeded states are free to share this heading,
    // and do.
    heading: READY_COPY.heading,
    showMark: true,
    showDownload: true,
    downloadEnabled: succeeded,
    showGenerating: !succeeded,
    failureMessage: null,
  };
}

export const START_OVER_CONFIRM_COPY = {
  heading: "Start a new report?",
  body: "This clears everything in the current report from this browser. There is no copy to go back to — download the PDF first if you want one.",
  confirmCta: "Clear and start over",
  cancelCta: "Keep this report",
} as const;
