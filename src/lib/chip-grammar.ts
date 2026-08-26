// Pure logic behind Issue #44's chip-driven Follow-ups surface —
// design.md's "Interaction model and UI", surface 3. UI components stay
// thin wrappers around this and around agenda.ts/topics.ts's existing
// write functions (applyAction, setRepeatCount) — this module adds only
// what those don't already provide: the count-follow-through math for
// multi-slot repeat groups, and the "question — answer" transcript
// formatting a chip tap needs.
import { applyAction, type AgendaRecord } from "./agenda";
import { MAX_FIELDS_PER_ASK } from "./ask";
import type { FieldAction } from "./field-state";
import type { CorrectionOffer } from "./followup-sweep";
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

// Which of a step's fields AskForm's "I don't have that"/"rather not
// say" chips are allowed to write. A "topic" step's fieldIds is NOT
// itself capped by nextStep() (most real topics have more than
// MAX_FIELDS_PER_ASK unresolved fields — patient-basics has 19 at once),
// but askDeterministic() only ever phrases the first MAX_FIELDS_PER_ASK
// of them into the visible question (src/lib/ask.ts). Passing the
// UNCAPPED step.fieldIds to applyActionToFields() below would silently
// write declined/unknown to every one of a topic's unresolved fields,
// including the 16 the clinician was never shown a question about and so
// never had a chance to decline (reviewer pass on PR #64 — this used to
// be AskForm.tsx's own `current.nextStep.fieldIds`, uncapped). A
// non-topic step (repeat-decision, done) has no ask-form fields to
// dismiss at all.
export function dismissableFieldIds(step: NextStep): string[] {
  return step.kind === "topic" ? step.fieldIds.slice(0, MAX_FIELDS_PER_ASK) : [];
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
