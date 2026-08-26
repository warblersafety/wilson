// Pure logic behind Issue #44's chip-driven Follow-ups surface —
// design.md's "Interaction model and UI", surface 3. UI components stay
// thin wrappers around this and around agenda.ts/topics.ts's existing
// write functions (applyAction, setRepeatCount) — this module adds only
// what those don't already provide: the count-follow-through math for
// multi-slot repeat groups, and the "question — answer" transcript
// formatting a chip tap needs.
import { applyAction, type AgendaRecord } from "./agenda";
import type { FieldAction } from "./field-state";
import { repeatGroupCapacity, TOPICS, type RepeatGroup, type Topic } from "./topics";

export interface RepeatDecisionOptions {
  // Total repeat-group capacity per topics.ts's own real topic map.
  capacity: number;
  // false when there's only one possible "yes" outcome — afterInstance+1
  // equals capacity, so "yes" writes that count directly with no extra
  // tap (this is always true for suspect-product, capacity 2). true when
  // a group has more than one possible total (concomitant-medication,
  // capacity 10) and "yes" alone would be lossy (design.md, reviewer
  // pass on PR #46: a bare "yes" used to write 2 and silently drop
  // medications 3+).
  needsCountFollowThrough: boolean;
  // Valid totals to offer as count chips when needsCountFollowThrough is
  // true — every integer from afterInstance+1 through capacity, so the
  // chip grammar can carry every count v1's free text could (design.md:
  // "the rebuild is never allowed to be lossier than what it replaces").
  countChoices: number[];
}

export function repeatDecisionOptions(
  afterInstance: number,
  group: RepeatGroup,
  topics: Topic[] = TOPICS,
): RepeatDecisionOptions {
  const capacity = repeatGroupCapacity(group, topics);
  const remaining = capacity - afterInstance;
  if (remaining <= 1) {
    return { capacity, needsCountFollowThrough: false, countChoices: [] };
  }
  const countChoices: number[] = [];
  for (let count = afterInstance + 1; count <= capacity; count++) countChoices.push(count);
  return { capacity, needsCountFollowThrough: true, countChoices };
}

// The transcript entry a chip tap appends (Issue #44 AC: "chip-driven
// answers append a transcript entry too... so the visible history has no
// gaps"). Deliberately not a fabricated sentence — lucy's own Transcript
// renders tapped answers as question/answer pairs rather than invented
// speech, for the same reason: a machine-composed line must never read
// as something the clinician said.
export function widgetTurnText(question: string, answerLabel: string): string {
  return `${question} — ${answerLabel}`;
}

// AskForm's "I don't have that"/"rather not say" chips dismiss a whole
// bundled topic ask (up to MAX_FIELDS_PER_ASK fields) in one tap — this
// applies the same FieldAction to each, the same direct write path every
// other chip in this app uses (RepeatDecision's chips, AskForm's own
// correction-offer accept — Issue #44).
export function applyActionToFields(record: AgendaRecord, fieldIds: string[], action: FieldAction): AgendaRecord {
  return fieldIds.reduce((rec, fieldId) => applyAction(rec, fieldId, action), record);
}

// Issue #44 AC: "server/extraction failures surface as friendly copy with
// a retry, never err.message" — scoped to this unit's own new surface
// (see the amended AC and warblersafety/wilson#63 for #42/#43, which
// still show the raw message). One honest message for every failure
// rather than a per-error-string guess: this app's actual failure modes
// (a keyless dev machine, a rare model/parse error) don't need different
// clinician-facing copy, and a made-up taxonomy would just be a second,
// less accurate error message competing with the real one already logged
// server-side. Takes the raw message so the mapping is real (and
// testable) rather than a bare constant, leaving room to differentiate
// later without changing call sites.
export function friendlyFailureMessage(_rawMessage: string): string {
  return "Something went wrong sending that. Check your connection and try again.";
}
