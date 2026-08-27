// The widened per-turn follow-up sweep's write-policy classifier and
// reply-phrasing (Issue #44, design.md "Follow-up turns are mined for
// everything still open"). src/lib/extract.ts's real ExtractFn is the one
// production caller: it runs the model, hands validateCandidates()'
// ACCEPTED (grounded, turn-constrained, legal-option-checked) actions to
// classifyFollowUpActions() below, and folds describeFollowUpSweep()'s
// output into the turn's reply. Nothing in this module talks to a model
// or the network — it is pure, synchronous classification and string
// building over data extract.ts already validated, which is what makes
// every rule here directly, deterministically testable.
import type { AgendaRecord } from "./agenda";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import type { FieldState } from "./field-state";
import { fieldPhrase, REPEAT_GROUP_LABELS } from "./ask";
import type { ProposedAction } from "./talk";
import { repeatGroupOfLaterInstanceField, TOPICS, type RepeatGroup, type Topic } from "./topics";

// A resolved field the sweep found new evidence for, but did not write —
// see talk.ts's re-export of this type for the full design-basis comment.
export interface CorrectionOffer {
  fieldId: string;
  action: ProposedAction;
  currentState: FieldState;
  currentValue?: string;
}

export interface FollowUpSweepResult {
  // Every field this turn actually writes — apply via
  // talk.ts's applyProposedActions(). A subset of the accepted candidates
  // handed in: correction-offer and collision fieldIds are deliberately
  // excluded, never silently written.
  writes: ProposedAction[];
  // The subset of `writes` outside the fields this turn's own ask named —
  // design.md: "every out-of-ask write is named in that turn's visible
  // reply". Always a subset of `writes`, never a separate write list.
  outOfAskWrites: ProposedAction[];
  correctionOffers: CorrectionOffer[];
  // Fields with 2+ candidates this turn — a collision, not a sequence
  // (design.md, #52's rule): written nowhere, named in the reply instead.
  collisionFieldIds: string[];
  // Repeat groups a later-instance field was volunteered for this turn —
  // no field write, no count write (design.md: "never attributed by the
  // sweep"); surfaces later as a hint on that group's own repeat-decision
  // ask (see src/lib/ask.ts).
  volunteeredRepeatGroups: RepeatGroup[];
}

// Given the candidates validateCandidates() already accepted as grounded
// (against the FULL manifest, any field id, not just the currently-open
// set — a correction or a later-instance mention can legitimately target
// a field the open-fields prompt suffix never named), decides what
// actually happens to each one. Three independent classifications, in
// this order:
//
//   1. Does the field belong to a repeat group's instance 2+? -> a
//      volunteered-later-instance mention: no write, group recorded.
//   2. Among what's left, does the SAME field appear more than once? ->
//      a collision: no write, field id recorded.
//   3. For what's left after that, is the field currently `unasked`? ->
//      a write (in-ask or out-of-ask, by whether its id is in
//      `askFieldIds`); otherwise (answered/unknown/declined) -> a
//      correction offer, never a direct write.
export function classifyFollowUpActions(
  actions: ProposedAction[],
  record: AgendaRecord,
  askFieldIds: string[],
  topics: Topic[] = TOPICS,
): FollowUpSweepResult {
  const volunteeredRepeatGroups: RepeatGroup[] = [];
  const seenGroups = new Set<RepeatGroup>();
  const notLaterInstance: ProposedAction[] = [];
  for (const action of actions) {
    const group = repeatGroupOfLaterInstanceField(action.fieldId, topics);
    if (group !== null) {
      if (!seenGroups.has(group)) {
        seenGroups.add(group);
        volunteeredRepeatGroups.push(group);
      }
      continue;
    }
    notLaterInstance.push(action);
  }

  const byField = new Map<string, ProposedAction[]>();
  for (const action of notLaterInstance) {
    const group = byField.get(action.fieldId) ?? [];
    group.push(action);
    byField.set(action.fieldId, group);
  }
  const collisionFieldIds: string[] = [];
  const singular: ProposedAction[] = [];
  for (const [fieldId, group] of byField) {
    if (group.length > 1) {
      collisionFieldIds.push(fieldId);
    } else {
      singular.push(group[0]);
    }
  }

  const writes: ProposedAction[] = [];
  const outOfAskWrites: ProposedAction[] = [];
  const correctionOffers: CorrectionOffer[] = [];
  for (const action of singular) {
    if (!Object.hasOwn(record, action.fieldId)) {
      throw new Error(`classifyFollowUpActions: record missing field id: ${action.fieldId}`);
    }
    const entry = record[action.fieldId];
    if (entry.state === "unasked") {
      writes.push(action);
      if (!askFieldIds.includes(action.fieldId)) {
        outOfAskWrites.push(action);
      }
    } else {
      correctionOffers.push({
        fieldId: action.fieldId,
        action,
        currentState: entry.state,
        currentValue: entry.value,
      });
    }
  }

  return { writes, outOfAskWrites, correctionOffers, collisionFieldIds, volunteeredRepeatGroups };
}

function fieldOrId(fieldId: string, fields: FormFieldSpec[]): string {
  const field = fields.find((f) => f.id === fieldId);
  return field ? fieldPhrase(field) : fieldId;
}

function describeActionValue(action: ProposedAction): string {
  if (action.type === "answer") return action.value;
  if (action.type === "mark_unknown") return "unknown";
  return "declined"; // "decline"
}

// Mirrors design.md's own worked example almost verbatim: "you said 8/20
// for therapy stop date — it's recorded as 8/19; replace it?". `answer`
// offers quote a value on both sides where one exists; `mark_unknown`/
// `decline` offers describe the clinician's stated intent instead of
// inventing a value for a state that never carried one.
function describeOfferedChange(offer: CorrectionOffer): string {
  if (offer.action.type === "answer") return offer.action.value;
  if (offer.action.type === "mark_unknown") return "you don't have that";
  return "you'd rather not say";
}

function describeCurrentState(offer: CorrectionOffer): string {
  if (offer.currentState === "answered") return `recorded as ${offer.currentValue}`;
  if (offer.currentState === "unknown") return "marked unknown";
  return "marked declined";
}

function correctionOfferSentence(offer: CorrectionOffer, fields: FormFieldSpec[]): string {
  const phrase = fieldOrId(offer.fieldId, fields);
  return `You said ${describeOfferedChange(offer)} for ${phrase} — it's ${describeCurrentState(offer)}. Replace it?`;
}

// Turns one turn's FollowUpSweepResult into the acknowledgment/
// correction-offer/collision/suggestion text talk.ts's processTurn()
// prepends to the next question (design.md: "no widened write is ever
// invisible"). Empty string when there is nothing outside the ordinary
// in-ask answer to report — the common case, and the one where the reply
// should read exactly like it always has.
export function describeFollowUpSweep(
  result: FollowUpSweepResult,
  fields: FormFieldSpec[] = FORM_3500_FIELDS,
): string {
  const sentences: string[] = [];

  if (result.outOfAskWrites.length > 0) {
    const fragments = result.outOfAskWrites.map(
      (action) => `${fieldOrId(action.fieldId, fields)} — ${describeActionValue(action)}`,
    );
    sentences.push(`Also noted: ${fragments.join("; ")}.`);
  }

  for (const offer of result.correctionOffers) {
    sentences.push(correctionOfferSentence(offer, fields));
  }

  for (const fieldId of result.collisionFieldIds) {
    sentences.push(`You gave more than one answer for ${fieldOrId(fieldId, fields)} — which one did you mean?`);
  }

  for (const group of result.volunteeredRepeatGroups) {
    sentences.push(`Noted — I'll ask about that once we get to additional ${REPEAT_GROUP_LABELS[group]}.`);
  }

  return sentences.join(" ");
}
