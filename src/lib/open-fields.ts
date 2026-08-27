// The Open-fields dialog's derivation (Issue #45) — design.md's surface
// 5: "what's still `unknown` or unasked, listed with its reason, each
// answerable from here; 'file as it stands' always available... A
// partial report is a valid report; this surface nudges, it never
// gates."
//
// Scope is the REACHABLE field set, never the whole 227-field manifest:
// every non-repeat topic, plus repeat instances at or below the count
// the clinician confirmed. At `done`, nextStep()'s own walk guarantees
// every reachable field is resolved, so the only `unasked` fields left
// anywhere in the record belong to slots the clinician confirmed do NOT
// exist — and design.md is explicit that a decided slot "is skipped and
// the question is never re-asked." Listing suspect product #2's ~40
// fields and concomitant slots 3–10 as "not asked yet" would put ~70
// entries in a dialog the screens show three in, each carrying a reason
// that is false: those slots WERE decided, they weren't skipped over.
//
// Enumerated deviation from screen 06 (design.md's fidelity rule): the
// mockup's third sample entry, "Concomitant medications — not asked
// yet", depicts a state the shipped machinery cannot produce at Review
// — a decided-"no" group is neither `unknown` nor reachable-`unasked`.
// The affordance it gestures at is revising a repeat count after its
// decision, which is real, out of this unit's frozen scope, and filed as
// warblersafety/wilson#77.
import type { AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import type { CuratedRow } from "./report-chrome";
import { TOPICS, type RepeatCounts, type Topic } from "./topics";
import { isListableGap } from "./ask-inventory";
import { displayName } from "./display-names";

export type OpenFieldReasonKind = "unknown" | "not-asked";

export interface OpenFieldEntry {
  fieldId: string;
  label: string;
  reasonKind: OpenFieldReasonKind;
  // The clinician-facing reason string, verbatim from screen 06.
  reason: string;
}

// ask-copy.md rule 8's open-fields row copy. "you didn't have it"
// replaces screen 06's own "you said unknown": where the canvas shows
// copy, the contract wins (design.md's narrowed canvas authority), and a
// clinician who tapped "I don't have that" is better told what they said
// than handed the machine's word for it.
const REASON_TEXT: Record<OpenFieldReasonKind, string> = {
  unknown: "you didn't have it",
  "not-asked": "not asked yet",
};

// The dialog's own strings, in lib for the same reason Ready's are
// (reviewer pass, PR #78, finding 3): ready.test.ts's copy-level check
// covers every string these surfaces render, not only the ones that
// happened to start out as constants. Body copy keeps the mockup's
// partial-report framing with design.md's recorded vocabulary swap
// ("file as it stands" → "finish as it stands").
export const OPEN_FIELDS_COPY = {
  body:
    "Form FDA 3500 accepts a partial report, and the FDA would rather have this one than nothing. " +
    "Fill any of them now, or finish as it stands.",
  answerCta: "Answer",
  backCta: "Back to review",
  finishCta: "Finish as it stands",
} as const;

// Derived from the count, never hardcoded — screen 06's own "Three fields
// are still open." is written for its three-entry sample.
export function openFieldsHeading(count: number): string {
  return count === 1 ? "1 field is still open." : `${count} fields are still open.`;
}

// Exported for the copy-level check, which has to be able to enumerate the
// reason strings the dialog renders alongside every other string.
export const OPEN_FIELD_REASONS = REASON_TEXT;

// A topic the clinician can still be asked about: any non-repeat topic,
// or a repeat instance at or below its group's decided count. An
// undecided group counts as 1, matching nextStep()'s own "instance 1 is
// always asked unconditionally" invariant — instance 2+ isn't reachable
// until a decision unblocks it.
function isReachable(topic: Topic, repeatCounts: RepeatCounts): boolean {
  if (topic.repeatGroup === null || topic.repeatInstance === null) return true;
  return topic.repeatInstance <= (repeatCounts[topic.repeatGroup] ?? 1);
}

// This is a THIRD copy of an "open" predicate, and deliberately not a
// reuse of either existing one. topics.ts's own recorded policy is to
// duplicate the predicate across boundaries "rather than hidden behind a
// shared helper a future edit could accidentally widen in both places at
// once" — and the scopes genuinely differ here. openFollowUpFields()
// scopes to instance 1 only, correct for the per-turn sweep's
// narrative-attribution safety, but wrong for this dialog: it would hide
// a CONFIRMED second suspect product's unknown lot number, a field the
// clinician was really asked about and really answered "unknown" to.
function reasonKindFor(state: AgendaRecord[string]["state"]): OpenFieldReasonKind | null {
  if (state === "unknown") return "unknown";
  if (state === "unasked") return "not-asked";
  // `answered` and `declined` are clinician-established states this
  // dialog respects and never nudges — the same principle the widened
  // sweep records for its own writes.
  return null;
}

export function openFieldEntries(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): OpenFieldEntry[] {
  const fieldsById = new Map(fields.map((f) => [f.id, f]));
  const entries: OpenFieldEntry[] = [];
  // Walked in the topic map's own order (already section-by-section, A
  // through G), so the dialog reads in form order rather than manifest
  // order — the same walk every other derivation in this codebase uses.
  for (const topic of topics) {
    if (!isReachable(topic, repeatCounts)) continue;
    for (const fieldId of topic.fieldIds) {
      const field = fieldsById.get(fieldId);
      if (!field) {
        throw new Error(`openFieldEntries: no such field in the given fields list: ${fieldId}`);
      }
      if (!Object.hasOwn(record, fieldId)) {
        throw new Error(`openFieldEntries: record missing field id: ${fieldId}`);
      }
      // ask-copy.md's dispositions: an auto field (ReportDate, stamped at
      // export), a lab write-target row, and an ask whose condition does
      // not hold (the date of death with no death recorded) are never
      // gaps — rule 5 is explicit that "an empty row 4 is never a phantom
      // gap in open-fields or the counts". A derive companion IS one:
      // rule 3 leaves a bare weight's lb/kg open on purpose, "visible at
      // Review".
      if (!isListableGap(fieldId, record)) continue;
      const reasonKind = reasonKindFor(record[fieldId].state);
      if (reasonKind === null) continue;
      entries.push({ fieldId, label: displayName(fieldId), reasonKind, reason: REASON_TEXT[reasonKind] });
    }
  }
  return entries;
}

export function hasOpenFields(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): boolean {
  return openFieldEntries(record, repeatCounts, topics, fields).length > 0;
}

export interface OpenFieldsSummary {
  entries: OpenFieldEntry[];
  // Always true, with no gating condition anywhere in its computation —
  // the AC's "filing is never blocked on completeness (asserted by test
  // on the gating logic)" made literal and mechanical. Slightly
  // tautological on purpose: it exists so that any future attempt to
  // gate finishing on completeness has to change this constant and break
  // its test, making the decision visible rather than quiet.
  canFinishAsIs: true;
}

export function summarizeOpenFields(
  record: AgendaRecord,
  repeatCounts: RepeatCounts,
  topics: Topic[] = TOPICS,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): OpenFieldsSummary {
  return { entries: openFieldEntries(record, repeatCounts, topics, fields), canFinishAsIs: true };
}

// The dialog's per-entry "Answer" reopens at the same row granularity
// Review's own Edit uses, so there is one reopen mechanism in this unit
// rather than two. Returns undefined for a field no given row covers —
// the caller decides what that means (Review passes reviewRows(), which
// covers every reachable field including section E).
export function rowForField(fieldId: string, rows: CuratedRow[], topics: Topic[] = TOPICS): CuratedRow | undefined {
  const topic = topics.find((t) => t.fieldIds.includes(fieldId));
  if (!topic) return undefined;
  return rows.find((row) => row.topicIds.includes(topic.id));
}
