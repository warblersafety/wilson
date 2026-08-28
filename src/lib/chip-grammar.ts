// Pure logic behind Issue #44's chip-driven Follow-ups surface —
// design.md's "Interaction model and UI", surface 3. UI components stay
// thin wrappers around this and around agenda.ts/topics.ts's existing
// write functions (applyAction, setRepeatCount) — this module adds only
// what those don't already provide: the count-follow-through math for
// multi-slot repeat groups, and the "question — answer" transcript
// formatting a chip tap needs.
import { applyAction, type AgendaRecord } from "./agenda";
import { standaloneFactNamesFor } from "./ask-inventory";
import type { FieldAction } from "./field-state";
import { describeDismissal, type CorrectionOffer, type FieldCollision } from "./followup-sweep";
import { repeatGroupCapacity, TOPICS, type NextStep, type RepeatGroup, type Topic } from "./topics";

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

// The two dismiss chips' visible labels, and the action each writes.
// ONE home, because three things have to agree on these strings and two
// of them are not the component: AskForm renders them, the round-gate
// case fixtures tap them by visible text through a real browser, and
// gate-simulate.ts resolves them headlessly. They lived in all three,
// so renaming the chip left the whole suite green and broke 122 of the
// gate driver's 139 steps — silently, and only at gate time, which is
// exactly when the driver is most likely to have rotted (doc-review on
// #96). Keyed BY LABEL because the label is what a clinician taps and
// what the driver clicks.
export const DISMISS_CHIPS = {
  "I don't have that": "mark_unknown",
  "Rather not say": "decline",
} as const satisfies Record<string, "mark_unknown" | "decline">;

export type DismissChipLabel = keyof typeof DISMISS_CHIPS;

// Which of a step's fields AskForm's dismiss chips are allowed to write: exactly the facts the visible question
// named, and nothing else. Under the label-template walk this needed a
// cap — nextStep() returned every unresolved field of a topic (19 for
// patient-basics) while the question phrased only the first three, so an
// uncapped dismiss silently wrote unknown/declined to 16 fields the
// clinician was never shown (reviewer pass on PR #64). Authored asks
// close that gap at the source: step.fieldIds IS the ask's own unresolved
// askFieldIds, so the visible question and the dismiss set are the same
// list by construction rather than by two modules agreeing to slice
// alike. ask-copy.md rule 2 keeps the other half of it — an ask's
// derive/auto companions are never in askFieldIds, so a dismiss can
// never reach them. A non-topic step (repeat-decision, done) has no
// ask-form fields to dismiss at all.
export function dismissableFieldIds(step: NextStep): string[] {
  return step.kind === "topic" ? step.fieldIds : [];
}

// What rule 8's dismiss acknowledgment says a tap just recorded (#110):
// the FACTS the visible question asked for, named through rule 9's own
// fact names, so the two sentences a clinician can see about one ask —
// its re-ask frame and its dismissal — name the same things. Fields would
// be the wrong unit: one tap on DV-1 writes ten of them and asks about
// one fact, and "Marked device brand name, common device name, procode,
// ... as not on hand." is the recite-the-field-list failure rule 9 exists
// to remove.
//
// Named from dismissableFieldIds() — the SAME list the tap writes, not a
// second set re-derived from the record — so the acknowledgment can never
// name a fact the tap left alone, or miss one it resolved.
//
// `undefined`, not a string, on a step with nothing to dismiss: a
// repeat-decision or `done` step has no ask-form fields at all. Guarded
// on the composed NAMES rather than on the field ids, because names is
// what describeDismissal() refuses to compose from nothing — a step
// whose fieldIds named nothing in its own ask would otherwise pass a
// field-count guard and throw inside AskForm, losing the tap's write
// behind a generic failure message (reviewer pass).
export function dismissAcknowledgment(step: NextStep, action: "mark_unknown" | "decline"): string | undefined {
  if (step.kind !== "topic") return undefined;
  const names = standaloneFactNamesFor(step.ask, dismissableFieldIds(step));
  return names.length === 0 ? undefined : describeDismissal(names, action);
}

// AskForm's "I don't have that"/"rather not say" chips dismiss a whole
// bundled topic ask in one tap — this applies the same FieldAction to
// every given field, the same direct write path every other chip in this
// app uses (RepeatDecision's chips, AskForm's own correction-offer
// accept — Issue #44). This function itself trusts whatever fieldIds
// it's handed — callers sourcing them from a topic step's own fieldIds
// MUST run them through dismissableFieldIds() above first, never pass
// step.fieldIds directly, or the mass-write bug documented there comes
// back.
export function applyActionToFields(record: AgendaRecord, fieldIds: string[], action: FieldAction): AgendaRecord {
  return fieldIds.reduce((rec, fieldId) => applyAction(rec, fieldId, action), record);
}

// AskForm's one-tap correction-offer accept (design.md: "one tap to
// accept... recorded in the transcript") must not silently discard the
// turn's OTHER correction offers. stepForSession() (src/app/wizard/
// direct-step.ts) returns a fresh TalkStep computed from nextStep(),
// which carries no correctionOffers of its own — TalkStep.correctionOffers
// is deliberately ephemeral, THIS turn's sweep output only (talk.ts) —
// so accepting offer A while offers B/C were also on screen used to make
// B/C simply vanish on the next render, even though neither was acted on
// (reviewer pass on PR #64). Filters the accepted offer out of the
// CURRENT turn's own offer list rather than clearing it, and returns
// undefined (not an empty array) once nothing remains, matching every
// other producer of TalkStep.correctionOffers (talk.ts's processTurn():
// `undefined` when there's nothing to show, never `[]`).
export function remainingCorrectionOffers(
  offers: CorrectionOffer[] | undefined,
  acceptedFieldId: string,
): CorrectionOffer[] | undefined {
  const rest = (offers ?? []).filter((offer) => offer.fieldId !== acceptedFieldId);
  return rest.length > 0 ? rest : undefined;
}

// AskForm's one-tap collision-choice accept (Issue #124), the exact same
// concern as remainingCorrectionOffers() just above and for the same
// reason: stepForSession()'s fresh TalkStep carries no collisions of its
// own, so resolving one field's collision must not silently drop another
// field's still-pending one if both happened to land in the same turn.
export function remainingCollisions(
  collisions: FieldCollision[] | undefined,
  resolvedFieldId: string,
): FieldCollision[] | undefined {
  const rest = (collisions ?? []).filter((collision) => collision.fieldId !== resolvedFieldId);
  return rest.length > 0 ? rest : undefined;
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
