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
// section structure alone. Three things aren't named anywhere but that
// source's row list, so they're recorded here rather than left silent
// (design.md's own fidelity rule: reasoned deviations are first-class;
// reviewer pass, PR #75, finding F13 — this comment previously recorded
// only two of the three):
//   - "What happened" absorbs event-additional-comments (both section-B
//     narrative content about the event, not a fact the mockup's four
//     B-rows have room to break out further).
//   - "Reporter" absorbs both reporter-contact-info and
//     reporter-about-you (the mockup's single "Reporter" row covers all
//     of section G, which the topic map splits into two topics).
//   - Section E (device) has no row at all, matching the mockups exactly
//     — device topics stay reachable through the follow-up loop and
//     count toward the footer's record-wide totals, just not rolled up
//     individually here.
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

function fieldIdsForRow(row: CuratedRow, topicsById: Map<string, Topic>): string[] {
  return row.topicIds.flatMap((id) => topicsById.get(id)?.fieldIds ?? []);
}

// done/unknown/untouched are all defined over a row's FULL field set
// (never a positional walk): done means at least one constituent field
// carries a real value (proven progress, even mid-row or ahead of the
// sequential cursor — the AC's own "narrative-filled topic past the
// cursor renders done" case); untouched means none of them have been
// reached at all; unknown means every touched field came back with
// nothing to write and none is untouched-only either.
//
// "Nothing to write" groups FieldState's `unknown` AND `declined` into
// this one bucket, not three-way. That's a real divergence from the
// mockups' own rail component (ReportRail.dc.html defines five row
// looks, with `declined` as its own muted "—" badge distinct from
// `unknown`'s amber one — reviewer pass, PR #75, finding F5) — recorded
// here rather than left silent, per design.md's own fidelity rule. It
// is not a build shortcut: design.md's chrome paragraph and this unit's
// own frozen AC both name exactly four row states — `done`, `current`,
// `unknown`, `untouched` — with no fifth value in either, the same
// closed enumeration RowState's type carries above. Adding one would be
// new scope past what was frozen before code, not a fix; grouping
// `declined` with `unknown` here also matches recordFieldCounts()'s
// identical choice for the footer below, which design.md's own quoted
// example ("18 fields written · 2 unknown") independently supports —
// one consistent two-bucket model for "real value" vs. "not", not two
// different collapses in two places.
function stateFromFieldStates(states: Array<AgendaRecord[string]["state"]>): "done" | "untouched" | "unknown" {
  if (states.every((s) => s === "unasked")) return "untouched";
  if (states.some((s) => s === "answered")) return "done";
  return "unknown";
}

// The AC's own worked example ("a narrative-filled topic past the
// cursor renders done") is a boundary case worth naming explicitly: this
// threshold is ANY answered field, not a completion ratio, so a row with
// 1 of ~40 fields answered reads identically to one fully resolved, and
// a row with 1 answered + 39 unknown shows no trace of the unknowns
// (reviewer pass, PR #75, finding F6 — no change requested, recorded for
// whoever next touches this). "Done" is the strongest word the rail
// shows; the per-field detail lives one click away, in the facsimile and
// the real Review surface (#45), not the rail itself.
export function curatedRowState(
  row: CuratedRow,
  record: AgendaRecord,
  currentTopicId: string | null,
  topics: Topic[] = TOPICS,
): RowState {
  if (currentTopicId !== null && row.topicIds.includes(currentTopicId)) return "current";
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  return stateFromFieldStates(fieldIdsForRow(row, topicsById).map((id) => record[id]?.state ?? "unasked"));
}

export function reportRailRows(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  currentTopicId: string | null,
  topics: Topic[] = TOPICS,
): CuratedRowStatus[] {
  // Builds topicsById once for the whole rail rather than once per row
  // (curatedRowState's own default builds one per call, fine for a
  // single lookup but wasteful called nine or ten times per render —
  // reviewer pass, PR #75, finding F12).
  const topicsById = new Map(topics.map((t) => [t.id, t]));
  return curatedRows(repeatCounts, topics).map((row) => {
    if (currentTopicId !== null && row.topicIds.includes(currentTopicId)) {
      return { row, state: "current" as const };
    }
    return { row, state: stateFromFieldStates(fieldIdsForRow(row, topicsById).map((id) => record[id]?.state ?? "unasked")) };
  });
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

// Shared by the footer and the facsimile header so the two on-screen
// counters can't silently drift in copy (reviewer pass, PR #75, finding
// F4: they used to pluralize and zero-suppress differently while
// agreeing on the numbers — "1 field written" in one place, "1 fields
// written · 0 unknown" in the other, for the same record).
export function formatFieldCounts(counts: RecordCounts): string {
  const written = `${counts.written} field${counts.written === 1 ? "" : "s"} written`;
  return counts.unknown > 0 ? `${written} · ${counts.unknown} unknown` : written;
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
