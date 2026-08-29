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
import { anchorOf, exclusiveCompanionGroupContaining, isListableGap, standaloneFactNamesFor } from "./ask-inventory";
import { isTopicGatedOff } from "./gates";
import { displayName, productInstancePrefix } from "./display-names";

export type OpenFieldReasonKind = "unknown" | "not-asked";

export interface OpenFieldEntry {
  // ask-copy.md rule 8's open-fields unit (#127): "the fact, not the
  // field." One entry is one askable fact, or one rule-3 exclusive
  // companion group — so this is every member STILL open, never the
  // group's full field set. A plain field with no fact/group of its own
  // carries exactly one id here, same as before the unit. Carrying the
  // real ids (not just a count) is what lets a caller reopen the right
  // Review row (rowForField below) and lets a test reconcile this
  // surface's headline against the record's own per-field states.
  fieldIds: string[];
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
//
// "Item", not "field" — ask-copy.md rule 8's open-fields unit (added
// 2026-08-29, #127): the count this heading renders is now askable
// FACTS, and a row is a fact, which "field" no longer describes truthfully
// (a dismissed OC-1 is one item, not seven). "Item" over "question" too:
// one ask can carry several facts (PB-1 asks identifier, age and sex), so
// "question" would overcount asks.
export function openFieldsHeading(count: number): string {
  return count === 1 ? "1 item is still open." : `${count} items are still open.`;
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

// Rule 3's exclusive companion groups (age unit, weight unit) collapse to
// one row too (rule 8, #127), but unlike an AskFact they carry no
// authored name of their own — so the row's label is authored here,
// keyed by the group's shared anchor (every member of a group anchors on
// the same field, per ask-inventory.ts's COMPANION_ANCHORS). Only the
// weight group is reachable today: the age group's bare-number default
// (rule 3 — "a bare age defaults to years") means an unstated unit
// always resolves (derive.ts's bareAgeDefaultWrites) before it can
// become a second, simultaneously-open sibling, so a standing age
// clarification would be dead, untested copy. A future companion group
// with no entry here is a build error rather than invented copy — the
// same convention displayName() and asksForTopic() already hold for a
// missing authored string.
const COMPANION_GROUP_LABELS: Record<string, string> = {
  // Rule 9's own authored clarification (PB-2), reused as the row label:
  // "two rows for the one authored clarification 'Was that pounds or
  // kilograms?' ... One question, one row."
  "Page1.SecA_Patient.WeightValue": "Was that pounds or kilograms?",
};

function companionGroupLabel(anchorId: string): string {
  const label = COMPANION_GROUP_LABELS[anchorId];
  if (label === undefined) {
    throw new Error(`open-fields: no authored open-fields label for the companion group anchored on: ${anchorId}`);
  }
  return label;
}

// suspectProduct(2) reuses instance 1's authored fact names byte for
// byte ("therapy status" is instance 1's string, verbatim) — the same
// referent problem #125 fixed for display names, not yet fixed for fact
// names. Qualifies exactly the way displayName() already does for every
// instance-2 field: the same prefix, from the same table (rule 8, #127).
function qualifyForInstance(topic: Topic, name: string): string {
  if (topic.repeatGroup !== "suspect-product" || topic.repeatInstance === null) return name;
  return `${productInstancePrefix(topic.repeatInstance)}${name}`;
}

// A multi-field AskFact or a rule-3 exclusive companion group — the two
// shapes rule 8 (#127) collapses to one row. `undefined` for a field
// that is its own fact: every field named by neither grouping, which
// already reads as a noun phrase under its own displayName.
//
// Keying on `ask.facts` alone would miss the companion groups entirely
// — they are not AskFacts (rule 8's own warning) — so this checks every
// ask's facts first, falling through to the companion-group lookup.
interface FieldGroup {
  // The group's FULL member set — never what a row is named from (see
  // `label` below), only what open membership is tested against.
  fieldIds: string[];
  // The row's name, computed from the STILL-OPEN subset only — passing
  // the full set is the referent bug #125 removed: a half-held RC-1
  // would read "your contact details" instead of "the rest of your
  // contact details" (standaloneFactNamesFor's own record-following
  // logic decides between the two).
  label(stillOpenFieldIds: string[]): string;
}

function groupContaining(topic: Topic, fieldId: string): FieldGroup | undefined {
  for (const ask of topic.asks) {
    for (const fact of ask.facts ?? []) {
      if (!fact.fieldIds.includes(fieldId)) continue;
      return {
        fieldIds: fact.fieldIds,
        label: (open) => qualifyForInstance(topic, standaloneFactNamesFor(ask, open)[0]),
      };
    }
  }
  const companionGroup = exclusiveCompanionGroupContaining(fieldId);
  if (companionGroup !== undefined) {
    // Every member of a rule-3 exclusive companion group anchors on the
    // same field (age/weight unit checkboxes all anchor on their shared
    // value field), so any member's own anchor names the group.
    const anchor = anchorOf(fieldId)!;
    return { fieldIds: companionGroup, label: () => companionGroupLabel(anchor) };
  }
  return undefined;
}

// Every field's fact — its own multi-field AskFact, its rule-3 exclusive
// companion group, or (for a field named by neither) itself alone —
// walked once across the given topics. Exported so a surface that needs
// to reason about facts rather than fields (the chrome footer, Ready)
// reuses the SAME grouping this dialog collapses rows with, rather than
// a second copy that could disagree about which fields belong together
// (rule 8's #127 amendment, added with the build: "two surfaces deciding
// it differently is how a footer ends up saying 'items' while still
// counting fields"). Structural only — no record, no `unasked`/gating
// filtering — because a group whose every member is untouched or
// unreachable already counts nowhere in either caller's own bucketing,
// the same way an individual `unasked` field always has.
export function factGroups(topics: Topic[] = TOPICS): string[][] {
  const groups: string[][] = [];
  const handled = new Set<string>();
  for (const topic of topics) {
    for (const fieldId of topic.fieldIds) {
      if (handled.has(fieldId)) continue;
      const group = groupContaining(topic, fieldId);
      const fieldIds = group?.fieldIds ?? [fieldId];
      for (const id of fieldIds) handled.add(id);
      groups.push(fieldIds);
    }
  }
  return groups;
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
    // Rule 5: a gated-off topic is excluded from this dialog and from the
    // counts it drives. "Not part of this report" is not a gap.
    if (isTopicGatedOff(topic.id, record)) continue;
    // One row can cover several of this topic's fieldIds (a multi-field
    // fact, a companion group) — once the group's row is pushed, its
    // later members must not walk into their own single-field branch
    // below and duplicate it.
    const handled = new Set<string>();
    for (const fieldId of topic.fieldIds) {
      const field = fieldsById.get(fieldId);
      if (!field) {
        throw new Error(`openFieldEntries: no such field in the given fields list: ${fieldId}`);
      }
      if (!Object.hasOwn(record, fieldId)) {
        throw new Error(`openFieldEntries: record missing field id: ${fieldId}`);
      }
      if (handled.has(fieldId)) continue;

      // ask-copy.md's dispositions decide what counts as a gap at all
      // (ask-inventory.ts's isListableGap): an auto field, a lab
      // write-target row, and an ask whose condition does not hold are
      // never gaps, and a derive companion becomes one only once the fact
      // it hangs off is answered — a stated bare weight makes lb/kg a
      // live question, an age nobody gave does not. This is the SAME
      // per-field predicate whether the field ends up its own row or
      // folded into a group's — the unit change alters presentation, not
      // which fields are open, which is exactly what keeps a
      // factResolvesFromOne fact's untouched remainder listed rather
      // than silently dropped (see the group branch below).
      const group = groupContaining(topic, fieldId);
      if (group === undefined) {
        if (!isListableGap(fieldId, record)) continue;
        const reasonKind = reasonKindFor(record[fieldId].state);
        if (reasonKind === null) continue;
        entries.push({ fieldIds: [fieldId], label: displayName(fieldId), reasonKind, reason: REASON_TEXT[reasonKind] });
        continue;
      }

      for (const id of group.fieldIds) handled.add(id);
      // Walked in topic.fieldIds' own (form) order, not group.fieldIds'
      // — an AskFact's own order follows its ASK's spoken sequence
      // (OC-1's copy names "...death, another serious medical event"
      // near the end; the manifest's own Death checkbox sits first),
      // and the dialog's stated convention is form order throughout, the
      // same order every other derivation in this codebase walks in.
      const groupMembers = new Set(group.fieldIds);
      const stillOpen = topic.fieldIds.filter(
        (id) => groupMembers.has(id) && isListableGap(id, record) && reasonKindFor(record[id].state) !== null,
      );
      // Nothing of the group is open: either rule 7 completed it (every
      // member answered — an exclusive/voicesEveryMember fact's own
      // atomic write) or every member is otherwise resolved/inapplicable.
      // Contributes no row, same as a single completed field would.
      if (stillOpen.length === 0) continue;
      // A group's members are written by the SAME turn — a completing
      // write answers every member together, a dismiss marks every
      // askFieldId unknown together (dismissableFieldIds is the step's
      // own unresolved set), and a factResolvesFromOne fact's untouched
      // remainder is uniformly `unasked` — so the still-open subset
      // shares one state by construction, so the first member's state
      // speaks for the row.
      const reasonKind = reasonKindFor(record[stillOpen[0]].state)!;
      entries.push({
        fieldIds: stillOpen,
        label: group.label(stillOpen),
        reasonKind,
        reason: REASON_TEXT[reasonKind],
      });
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
