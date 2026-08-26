// The report chrome's (Issue #67) rail-row model — design.md's "left
// topic rail: nine curated section/repeat-group rollup rows per the
// screens, not one row per topic... each row's state (done, current,
// unknown, untouched) computed from its constituent fields' actual
// states, never from topicStatuses()' positional walk, which cannot
// express `unknown` and mis-reports out-of-order fills under
// dictation-first."
//
// Row membership is curated, not derived: which topics collapse into
// which row is read from docs/mockups' own ReportRail.dc.html source,
// not reconstructed from the topic map (34 entries) or the form's
// section structure alone. Two folds aren't named anywhere but that
// source's row list, so they're recorded here rather than left silent
// (design.md's own fidelity rule: reasoned deviations are first-class):
// "What happened" absorbs event-additional-comments (both section-B
// narrative content about the event, not a fact the mockup's four B-rows
// have room to break out further), and section E (device) has no row at
// all, matching the mockups exactly — device topics stay reachable
// through the follow-up loop and count toward the footer's record-wide
// totals, just not rolled up individually here.
import type { AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS, type FormFieldSpec, type FormSection } from "./form-3500-fields";
import { TOPICS, type RepeatCounts, type Topic } from "./topics";

export type RowState = "done" | "current" | "unknown" | "untouched";

export interface CuratedRow {
  id: string;
  section: FormSection;
  label: string;
  topicIds: string[];
}

export interface CuratedRowStatus {
  row: CuratedRow;
  state: RowState;
}

const FIXED_ROWS_BEFORE_SUSPECT_PRODUCT: CuratedRow[] = [
  { id: "patient-basics", section: "A", label: "Patient basics", topicIds: ["patient-basics"] },
  {
    id: "what-happened",
    section: "B",
    label: "What happened",
    topicIds: ["event-what-happened", "event-additional-comments"],
  },
  { id: "outcome", section: "B", label: "Outcome", topicIds: ["event-outcome"] },
  { id: "medical-history", section: "B", label: "Medical history", topicIds: ["event-medical-history"] },
  { id: "lab-data", section: "B", label: "Lab data", topicIds: ["event-lab-data"] },
  { id: "product-availability", section: "C", label: "Product availability", topicIds: ["product-availability"] },
];

const CONCOMITANT_MEDICATION_TOPIC_IDS = Array.from(
  { length: 10 },
  (_, i) => `concomitant-medication-${i + 1}`,
);

const FIXED_ROWS_AFTER_SUSPECT_PRODUCT: CuratedRow[] = [
  { id: "concomitant-meds", section: "F", label: "Concomitant meds", topicIds: CONCOMITANT_MEDICATION_TOPIC_IDS },
  { id: "reporter", section: "G", label: "Reporter", topicIds: ["reporter-contact-info", "reporter-about-you"] },
];

// One row per CONFIRMED suspect-product instance, never a fixed count —
// the AC names this explicitly for instance 1 ("Suspect product #1's
// topics collapse to one row") and the same collapse applies to any
// later instance once it's confirmed to exist. Instance 1 always gets a
// row (topics.ts's nextStep(): "instance 1 is always asked
// unconditionally"); instance 2+ only once repeatCounts says so — the
// screens' own reference case has exactly one suspect product, hence the
// nine visible rows there, but the model generalizes past it.
function suspectProductRows(repeatCounts: RepeatCounts, topics: Topic[]): CuratedRow[] {
  const topicIdsByInstance = new Map<number, string[]>();
  for (const topic of topics) {
    if (topic.repeatGroup !== "suspect-product" || topic.repeatInstance === null) continue;
    const list = topicIdsByInstance.get(topic.repeatInstance) ?? [];
    list.push(topic.id);
    topicIdsByInstance.set(topic.repeatInstance, list);
  }
  const maxKnownInstance = Math.max(0, ...topicIdsByInstance.keys());
  const confirmed = repeatCounts["suspect-product"] ?? 1;
  const rowCount = Math.max(1, Math.min(confirmed, maxKnownInstance || 1));
  return Array.from({ length: rowCount }, (_, i) => {
    const instance = i + 1;
    return {
      id: `suspect-product-${instance}`,
      section: "D" as const,
      label: `Suspect product #${instance}`,
      topicIds: topicIdsByInstance.get(instance) ?? [],
    };
  });
}

export function curatedRows(repeatCounts: RepeatCounts, topics: Topic[] = TOPICS): CuratedRow[] {
  return [
    ...FIXED_ROWS_BEFORE_SUSPECT_PRODUCT,
    ...suspectProductRows(repeatCounts, topics),
    ...FIXED_ROWS_AFTER_SUSPECT_PRODUCT,
  ];
}

function fieldIdsForRow(row: CuratedRow, topics: Topic[]): string[] {
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  return row.topicIds.flatMap((id) => topicsById.get(id)?.fieldIds ?? []);
}

// current > untouched > done > unknown, in that precedence. "done" and
// "unknown" are both defined over a row's FULL field set (never a
// positional walk): done means at least one constituent field carries a
// real value (proven progress, even mid-row or ahead of the sequential
// cursor — the AC's own "narrative-filled topic past the cursor renders
// done" case); unknown means every touched field came back with nothing
// to write (unknown or declined — both mean "asked, no value"; neither
// counts toward done) and nothing else is untouched-only.
export function curatedRowState(
  row: CuratedRow,
  record: AgendaRecord,
  currentTopicId: string | null,
  topics: Topic[] = TOPICS,
): RowState {
  if (currentTopicId !== null && row.topicIds.includes(currentTopicId)) return "current";
  const states = fieldIdsForRow(row, topics).map((id) => record[id]?.state ?? "unasked");
  if (states.every((s) => s === "unasked")) return "untouched";
  if (states.some((s) => s === "answered")) return "done";
  return "unknown";
}

export function reportRailRows(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  currentTopicId: string | null,
  topics: Topic[] = TOPICS,
): CuratedRowStatus[] {
  return curatedRows(repeatCounts, topics).map((row) => ({
    row,
    state: curatedRowState(row, record, currentTopicId, topics),
  }));
}

export interface RecordCounts {
  written: number;
  unknown: number;
}

// Record-wide, not curated-rows-only: the footer's honesty (design.md,
// "honest about partial coverage") shouldn't hide progress on the three
// section-E device topics the rail itself doesn't roll up. "unknown"
// groups FieldState's unknown and declined — the same grouping
// curatedRowState uses above, and design.md's own footer example ("18
// fields written · 2 unknown") names only two buckets, not a third for
// declined.
export function recordFieldCounts(record: AgendaRecord, fields: FormFieldSpec[] = FORM_3500_FIELDS): RecordCounts {
  let written = 0;
  let unknown = 0;
  for (const field of fields) {
    const state = record[field.id]?.state ?? "unasked";
    if (state === "answered") written++;
    else if (state === "unknown" || state === "declined") unknown++;
  }
  return { written, unknown };
}

const PATIENT_IDENTIFIER_FIELD_ID = "Page1.SecA_Patient.PatientIdentifier";

// Null whenever there's nothing confirmed to show — unasked, unknown, or
// declined alike (the patient banner has no "unknown"/"declined" pill
// treatment of its own; the identifier pill appears only "once known",
// per the AC).
export function patientIdentifier(record: AgendaRecord): string | null {
  const entry = record[PATIENT_IDENTIFIER_FIELD_ID];
  if (entry?.state !== "answered" || !entry.value) return null;
  return entry.value;
}
