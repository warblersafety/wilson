// The Review surface's pure logic (Issue #45) — design.md's surface 4:
// "field-led sectioned cards (form sections A–G), every topic editable;
// an edit reopens the topic as a normal question (the existing reopen
// path). The rendered Form 3500 PDF stays one click away rather than
// leading the layout."
//
// Kept out of the component for the same reason start-surface.ts and
// read-back.ts are: provable under vitest's node environment, with the
// component a thin wrapper.
import { type AgendaRecord } from "./agenda";
import { fieldById, FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import {
  AGE_UNIT_LABELS,
  displayFor,
  doseWithUnitAndFrequency,
  productIdentity,
  valueWithCheckedUnit,
  WEIGHT_UNIT_LABELS,
  type RenderedFacsimileValue,
} from "./form-3500-facsimile";
import { curatedRows, type CuratedRow } from "./report-chrome";
import { reopenTopic, TOPICS, type RepeatCounts, type Topic } from "./topics";
import { displayNameFor } from "./display-names";
import { formatReportDate, REPORT_DATE_FIELD_ID } from "./report-date";
import { isTopicGatedOff } from "./gates";

export interface ReviewFieldDisplay {
  text: string | null;
  muted: boolean;
  // True when this is a REOPENED field still carrying the value it had
  // before the reopen — Review renders it as "you said: {text}" rather
  // than as a current answer, since the re-ask hasn't been answered yet.
  retained: boolean;
}

// Resolves a field for Review's cards, reusing displayFor() (the
// facsimile's half of design.md's "one mapping truth") for every normal
// state, and adding the one case displayFor() deliberately doesn't
// handle: it sits on the PDF/facsimile boundary, where an `unasked`
// field is blank regardless of any retained value, because that is what
// the exporter writes. Review is the one surface that must show it —
// agenda.ts retains `entry.value` through a reopen ("reopen never
// wipes"), and until now nothing user-facing read it back (PR #64,
// finding 7), so a clinician who reopened a topic saw a blanked field
// reading as never-answered.
export function fieldDisplay(record: AgendaRecord, fieldId: string, today: Date = new Date()): ReviewFieldDisplay {
  const entry = Object.hasOwn(record, fieldId) ? record[fieldId] : undefined;
  if (entry?.state === "unasked" && entry.value) {
    return { text: entry.value, muted: false, retained: true };
  }
  // Rule 4's auto field: Review shows the date the export will stamp,
  // rather than a blank that reads as a gap in a field nobody is ever
  // asked. Not written to the record here — the stamp belongs at export,
  // so a draft resumed tomorrow carries tomorrow's date.
  if (fieldId === REPORT_DATE_FIELD_ID && entry?.value === undefined) {
    return { text: formatReportDate(today), muted: false, retained: false };
  }
  // An ANSWERED-false checkbox reads "No" here, where displayFor() —
  // which speaks for the PDF, and on the PDF an unchecked box is simply
  // unchecked — renders it blank, indistinguishable from never having
  // been asked (reviewer pass, PR #106, F2). Rule 7's group completion
  // writes those falses in bulk, six at a time on OC-1, so leaving them
  // invisible would put a machine-written negative on the record with
  // nothing on the surface the clinician signs off from to show it. The
  // facsimile keeps rendering the form's own way; only Review, whose job
  // is verification, says it out loud.
  if (entry?.state === "answered" && entry.value === "false" && fieldById(fieldId)?.type === "checkbox") {
    return { text: "No", muted: false, retained: false };
  }
  const rendered = displayFor(record, fieldId);
  return { text: rendered.text, muted: rendered.muted, retained: false };
}

// The section-E device rows the report chrome's rail deliberately omits
// (report-chrome.ts: device topics "stay reachable through the follow-up
// loop... not rolled up individually here"). Review IS that reachable
// place, and this unit's AC requires the full A–G walk — so the rail's
// curated rows are reused as-is and these three are spliced in rather
// than the rail's own row list being widened, which would change the
// chrome the mockups pin at nine rows.
const DEVICE_ROWS: CuratedRow[] = [
  { id: "device-identity", section: "E", label: "Device identity", topicIds: ["device-identity"] },
  { id: "device-usage", section: "E", label: "Device usage", topicIds: ["device-usage"] },
  { id: "device-history", section: "E", label: "Device history", topicIds: ["device-history"] },
];

const FIRST_F_ROW_ID = "concomitant-meds";

export function reviewRows(repeatCounts: RepeatCounts, topics: Topic[] = TOPICS): CuratedRow[] {
  const rows = curatedRows(repeatCounts, topics);
  // Anchored on the stable row id, never an array position: the number
  // of suspect-product rows ahead of it varies with the confirmed count.
  const index = rows.findIndex((row) => row.id === FIRST_F_ROW_ID);
  if (index === -1) {
    throw new Error(`reviewRows: no "${FIRST_F_ROW_ID}" row to splice the section-E rows before`);
  }
  return [...rows.slice(0, index), ...DEVICE_ROWS, ...rows.slice(index)];
}

// A row's topics, scoped to the same reachable set open-fields.ts uses —
// an undecided group counts as 1, matching nextStep()'s "instance 1 is
// always asked unconditionally". Without this, the concomitant-meds card
// would render thirty rows for a clinician who confirmed one medication,
// twenty-seven of them permanently blank slots that don't exist.
function reachableTopicsOfRow(
  row: CuratedRow,
  repeatCounts: RepeatCounts,
  topics: Topic[],
  record?: AgendaRecord,
): Topic[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  return row.topicIds
    .map((id) => byId.get(id))
    .filter((t): t is Topic => t !== undefined)
    .filter((t) => t.repeatGroup === null || t.repeatInstance === null || t.repeatInstance <= (repeatCounts[t.repeatGroup] ?? 1))
    // ask-copy.md rule 5, when a record is available to judge against: a
    // gated-off topic contributes no rows. Rendering its fields as a wall
    // of "—" is precisely the confirmed-absent reading rule 5 forbids,
    // and on the surface the clinician signs off from (reviewer pass,
    // PR #107, F4). It also removed a trap: an Edit on a gated section's
    // card reopened its fields, which cleared the very evidence the gate
    // reads, permanently foreclosing the section (F3).
    .filter((t) => record === undefined || !isTopicGatedOff(t.id, record));
}

export function fieldIdsForReviewRow(
  row: CuratedRow,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  record?: AgendaRecord,
): string[] {
  return reachableTopicsOfRow(row, repeatCounts, topics, record).flatMap((t) => t.fieldIds);
}

// Whether a Review card is out of the report entirely — every topic
// behind it gated off. Such a card renders its one-line state instead of
// its fields; rule 5's "add affordance" that would bring it back is
// warblersafety/wilson#99's open design question, so today it comes back
// by the clinician mentioning it, not by clicking.
export function isReviewRowGatedOff(
  row: CuratedRow,
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
): boolean {
  const reachable = reachableTopicsOfRow(row, repeatCounts, topics);
  return reachable.length > 0 && reachable.every((t) => isTopicGatedOff(t.id, record));
}

export const GATED_OFF_REVIEW_COPY = "Not part of this report.";

// Review's per-card Edit — "every topic's Edit reopening it through the
// existing reopen path", at card granularity. A thin reduce over the
// existing, unmodified reopenTopic(); no new state-machine logic lives
// here, and nextStep()'s own serial walk then picks the reopened topic
// back up as an ordinary "topic" step. Scoped to the row's reachable
// topics: reopening a confirmed-away slot would no-op (nothing in it is
// resolved), but keeping the walk honest matters more than relying on
// that.
export function reopenReviewRow(
  record: AgendaRecord,
  row: CuratedRow,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): AgendaRecord {
  return reachableTopicsOfRow(row, repeatCounts, topics, record).reduce(
    (rec, topic) => reopenTopic(rec, topic, fields),
    record,
  );
}

// design.md's no-submission-claims rule: the mockup's "Sign off and
// file" claims a filing wilson does not perform (it fills and exports
// the form; there is no MedWatch e-submission pipeline). The sign-off
// vocabulary is kept — the clinician's signature is still the safety
// boundary — and only the filing claim is dropped.
export const SIGN_OFF_CTA = "Sign off and continue";

// Every other clinician-facing string these surfaces render. Lifted out of
// the components (reviewer pass, PR #78, finding 3) so ready.test.ts's
// copy-level check actually covers what renders: AC-3's rule is "no
// 'filed'/'submitted to FDA' language or confirmation numbers ANYWHERE",
// and while the strings were inline a future edit of the sign-off CTA back
// to "Sign off and file" would have broken no test. The intro pair is the
// mockup's own copy, which carries no violation and is taken as-is.
export const REVIEW_COPY = {
  heading: "Review before you sign off.",
  intro: "Your signature is the safety boundary, not mine. Edit anything and I’ll ask about it again.",
  editCta: "Edit",
  showPaperCta: "Show the draft PDF",
  hidePaperCta: "Hide the draft PDF",
  downloadDraftCta: "Download the draft PDF",
  paperTitle: "Form 3500 preview",
  retainedPrefix: "you said: ",
  emptyValue: "—",
} as const;

// The PDF generate/download states, shared by Review and Ready. In lib
// rather than beside the hook because src/lib is typechecked without the
// DOM lib (tsconfig.node.json), so ready.test.ts cannot import the hook to
// assert these — and copy that no test can reach is the whole of finding 3.
// `failure` follows chip-grammar.ts's friendlyFailureMessage convention:
// one honest line, never the caught error's own message, since
// PdfExportError's two cases (transport, server) ask nothing different of
// the clinician.
export const PDF_COPY = {
  generating: "Generating the PDF…",
  retryCta: "Try again",
  failure: "Something went wrong generating the PDF. Check your connection and try again.",
} as const;

// --- the cards' rendered rows -------------------------------------------
//
// Flat: one label/value row per reachable manifest field, not a rebuild of
// the facsimile's hand-curated composed boxes — those cover ~20 fields and
// don't generalize to 227 without design work outside this unit's frozen
// scope. Enumerated deviation from screen 05, whose "Sex | Female" and
// "Therapy dates | 8/12/26 – 8/19/26" rows are exactly that hand-curated
// authoring; here Sex renders as its two manifest checkbox fields and the
// therapy dates as their two date fields.
//
// Flat rendering also fixes warblersafety/wilson#69 as a side effect: the
// component this unit deletes filtered its field list to text/date types,
// so a checkbox or enum answer never appeared on the review screen at all.
// facsimileValue() renders every type, so nothing is hidden now.
//
// The four EXISTING composed helpers are reused where they already apply,
// because not reusing them would reintroduce the bug PR #75's finding F1
// fixed: a bare "42" under an "Age" label reads as years even when the
// record's answered unit is months. No new composed authoring beyond
// these four.
interface ComposedRow {
  render: (record: AgendaRecord) => RenderedFacsimileValue;
  // The fields this composition already speaks for — suppressed as rows of
  // their own so the card doesn't show both "Age | 42 yr" and a bare
  // "Age: Year(s) | Yes" beneath it.
  absorbs: string[];
  // An authored caption for a composition that speaks for more than one
  // FACT, so the row's label names everything under it (reviewer pass,
  // PR #98, finding 2). Absent where the anchor's own display name
  // already covers the row: age and weight absorb only their unit
  // checkbox, which is part of the same fact. Present where it doesn't —
  // labelling "amoxicillin-clavulanate 875 MG — Teva" as "product name"
  // understates the row on the very surface where a clinician verifies
  // field mapping before signing off.
  label?: string;
}

const COMPOSED_ROWS = new Map<string, ComposedRow>([
  [
    "Page1.SecA_Patient.AgeValue",
    {
      render: (record) => valueWithCheckedUnit(record, "Page1.SecA_Patient.AgeValue", AGE_UNIT_LABELS),
      absorbs: AGE_UNIT_LABELS.map(([fieldId]) => fieldId),
    },
  ],
  [
    "Page1.SecA_Patient.WeightValue",
    {
      render: (record) => valueWithCheckedUnit(record, "Page1.SecA_Patient.WeightValue", WEIGHT_UNIT_LABELS),
      absorbs: WEIGHT_UNIT_LABELS.map(([fieldId]) => fieldId),
    },
  ],
  [
    "Page4.Prod1.Prod1Dose",
    {
      render: doseWithUnitAndFrequency,
      absorbs: ["Page4.Prod1.Prod1DoseUnit", "Page4.Prod1.Prod1Freq"],
      label: "dose and frequency",
    },
  ],
  [
    "Page4.Prod1.Prod1Name",
    {
      render: productIdentity,
      absorbs: ["Page4.Prod1.Prod1Strength", "Page4.Prod1.Prod1StrengthUnit", "Page4.Prod1.Prod1ManuComp"],
      label: "product name, strength, and manufacturer",
    },
  ],
]);

export interface ReviewFieldRow extends ReviewFieldDisplay {
  fieldId: string;
  label: string;
}

// A row's label is its field's authored display name (ask-copy.md rule
// 6). Two label-shaping helpers used to live here: one dropped a manifest
// label's leading segment when it repeated the card's own heading, the
// other dropped a composed row's last segment to leave the form's group
// caption. Both derived clinician-facing text from manifest labels, which
// is exactly what rule 6 removes: "Raw manifest labels and PDF ids never
// render." A composed row (dose + unit + frequency) takes its anchor
// field's name, since the anchor is the fact the caption speaks for.

export function reviewFieldRows(
  record: AgendaRecord,
  row: CuratedRow,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
): ReviewFieldRow[] {
  const fieldIds = fieldIdsForReviewRow(row, repeatCounts, topics, record);
  const present = new Set(fieldIds);

  // Absorption is decided per anchor, against the record — never from the
  // COMPOSED_ROWS table alone. The helpers bail out entirely on a muted or
  // blank anchor (form-3500-facsimile.ts: `if (dose.text === null ||
  // dose.muted) return dose;`) and fold in only `answered` values, so
  // absorbing unconditionally hid real data: with the dose declined and
  // the frequency answered "BID", the card rendered one row reading
  // "Declined to answer" and "BID" appeared nowhere on any card, while the
  // exporter still wrote it to the form. Answered data that reaches the
  // PDF but not the surface the clinician signs off from is exactly the
  // silent-drop class the charter weights heaviest (reviewer pass, PR #78,
  // finding 1). A field a composition does NOT speak for keeps its own
  // row, which also restores the "obvious gaps" design.md asks for: an
  // absorbed-but-`unknown` unit now shows as a gap on the card instead of
  // appearing only in the Open-fields dialog.
  const composedRows = new Map<string, ReviewFieldRow>();
  const absorbed = new Set<string>();
  for (const fieldId of fieldIds) {
    const composed = COMPOSED_ROWS.get(fieldId);
    if (!composed) continue;
    const anchor = fieldDisplay(record, fieldId);
    // The retained-value case wins over composition: a reopened field's
    // prior value is exactly what Review exists to keep visible (AC-1's
    // edit path), and the composed helpers are built on displayFor(),
    // which reads a reopened field as blank by design — composing first
    // would silently drop the reminder this unit adds.
    if (anchor.retained || anchor.muted || anchor.text === null) continue;
    const { text, muted } = composed.render(record);
    const label = composed.label ?? displayNameFor(fieldId);
    composedRows.set(fieldId, { fieldId, label, text, muted, retained: false });
    for (const absorbedId of composed.absorbs) {
      if (present.has(absorbedId) && record[absorbedId]?.state === "answered") absorbed.add(absorbedId);
    }
  }

  const rows: ReviewFieldRow[] = [];
  for (const fieldId of fieldIds) {
    if (absorbed.has(fieldId)) continue;
    const composedRow = composedRows.get(fieldId);
    if (composedRow) {
      rows.push(composedRow);
      continue;
    }
    const label = displayNameFor(fieldId);
    rows.push({ fieldId, label, ...fieldDisplay(record, fieldId) });
  }
  return rows;
}
