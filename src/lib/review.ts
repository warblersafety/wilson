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
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
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
export function fieldDisplay(record: AgendaRecord, fieldId: string): ReviewFieldDisplay {
  const entry = Object.hasOwn(record, fieldId) ? record[fieldId] : undefined;
  if (entry?.state === "unasked" && entry.value) {
    return { text: entry.value, muted: false, retained: true };
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
function reachableTopicsOfRow(row: CuratedRow, repeatCounts: RepeatCounts, topics: Topic[]): Topic[] {
  const byId = new Map(topics.map((t) => [t.id, t]));
  return row.topicIds
    .map((id) => byId.get(id))
    .filter((t): t is Topic => t !== undefined)
    .filter((t) => t.repeatGroup === null || t.repeatInstance === null || t.repeatInstance <= (repeatCounts[t.repeatGroup] ?? 1));
}

export function fieldIdsForReviewRow(
  row: CuratedRow,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
): string[] {
  return reachableTopicsOfRow(row, repeatCounts, topics).flatMap((t) => t.fieldIds);
}

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
  return reachableTopicsOfRow(row, repeatCounts, topics).reduce(
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
    },
  ],
  [
    "Page4.Prod1.Prod1Name",
    {
      render: productIdentity,
      absorbs: ["Page4.Prod1.Prod1Strength", "Page4.Prod1.Prod1StrengthUnit", "Page4.Prod1.Prod1ManuComp"],
    },
  ],
]);

export interface ReviewFieldRow extends ReviewFieldDisplay {
  fieldId: string;
  label: string;
}

// The manifest's labels are hierarchical ("Suspect Product #1: Name,
// Strength, Manufacturer/Compounder: Lot #"). Inside a card already headed
// "Suspect product #1", that first segment is pure repetition — so exactly
// one leading segment is dropped, and only when it repeats the card's own
// label. Never more than one: dropping every segment but the last would
// collapse "Is therapy/usage still on-going?: Yes" and "Event Abated after
// use Stopped or Dose Reduced?: Yes" into two rows both labelled "Yes" in
// the same card. Every other section's labels are already short and are
// left exactly as the form words them.
export function shortFieldLabel(label: string, rowLabel: string): string {
  const separator = label.indexOf(": ");
  if (separator === -1) return label;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalize(label.slice(0, separator)) !== normalize(rowLabel)) return label;
  const rest = label.slice(separator + 2).trim();
  return rest.length > 0 ? rest : label;
}

// A composition's label is the form's own GROUP caption, not the anchor
// field's leaf name: the row shows several fields' values, so labelling it
// "…: Product Name" would name one of three. Mechanical — drop the last
// segment of the (already card-scoped) label — never hand-authored, and
// the same choice form-3500-facsimile.ts's productIdentity() records for
// the facsimile's own row.
function composedLabel(label: string): string {
  const lastSeparator = label.lastIndexOf(": ");
  if (lastSeparator === -1) return label;
  const caption = label.slice(0, lastSeparator).trim();
  return caption.length > 0 ? caption : label;
}

export function reviewFieldRows(
  record: AgendaRecord,
  row: CuratedRow,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): ReviewFieldRow[] {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const fieldIds = fieldIdsForReviewRow(row, repeatCounts, topics);
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
    const label = composedLabel(shortFieldLabel(fieldsById.get(fieldId)?.label ?? fieldId, row.label));
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
    const label = shortFieldLabel(fieldsById.get(fieldId)?.label ?? fieldId, row.label);
    rows.push({ fieldId, label, ...fieldDisplay(record, fieldId) });
  }
  return rows;
}
