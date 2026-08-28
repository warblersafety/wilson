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
import { REPEAT_GROUP_LABELS } from "./ask";
import { displayNameFor, joinNames } from "./display-names";
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

// A field this turn proposed more than one candidate for. Carries the
// values, not just the id: ask-copy.md rule 8's collision line quotes
// both, and the build used to ask "which one did you mean?" with neither
// value on screen — asking the clinician to disambiguate from memory on
// exactly the turn the record is already known to be ambiguous (#109).
export interface FieldCollision {
  fieldId: string;
  // Every candidate's value, in the order the extractor returned them,
  // described the same way a correction offer describes one (so a
  // `mark_unknown` collides as "unknown", not as a missing slot).
  values: string[];
  // The candidate behind each entry in `values`, same order/length — what
  // choosing that value actually writes (Issue #124: one tap per
  // colliding value, mirroring CorrectionOffer's own `action`). Kept
  // alongside `values` rather than folded into one combined shape:
  // `values` is what rule 8's narrated sentence quotes and is pinned by
  // this module's own tests; this is what a chip's one-tap accept passes
  // to applyProposedActions(), the same write path every other answer
  // takes.
  actions: ProposedAction[];
}

export interface FollowUpSweepResult {
  // Every field this turn actually writes — apply via
  // talk.ts's applyProposedActions(). A subset of the accepted candidates
  // handed in: correction-offer and collision fields are deliberately
  // excluded, never silently written.
  writes: ProposedAction[];
  // The subset of `writes` outside the fields this turn's own ask named —
  // design.md: "every out-of-ask write is named in that turn's visible
  // reply". Always a subset of `writes`, never a separate write list.
  outOfAskWrites: ProposedAction[];
  correctionOffers: CorrectionOffer[];
  // Fields with 2+ candidates this turn — a collision, not a sequence
  // (design.md, #52's rule): written nowhere, named in the reply instead.
  collisions: FieldCollision[];
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
//   1. Does the field belong to a repeat group's instance 2+, AND is it
//      NOT one of the fields the ask currently on screen (`askFieldIds`)
//      is itself asking about? -> a volunteered-later-instance mention:
//      no write, group recorded. A later-instance field the CURRENT ask
//      owns is that ask's own answer, not a volunteer — design.md's
//      carve-out: "that instance's fields are filled by its own
//      authored ask (suspect products) or the group's authored
//      later-instance ask (concomitant medications — CM-2), never
//      attributed by the sweep." Checked as part of the same test that
//      finds the group, not after: reaching notLaterInstance is what
//      lets it fall through to steps 2-3 below like any other in-ask
//      answer (#122).
//   2. Among what's left, does the SAME field appear more than once? ->
//      a collision: no write, field id AND every colliding value
//      recorded (rule 8's reply quotes them).
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
    if (group !== null && !askFieldIds.includes(action.fieldId)) {
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
  const collisions: FieldCollision[] = [];
  const singular: ProposedAction[] = [];
  for (const [fieldId, group] of byField) {
    if (group.length > 1) {
      collisions.push({ fieldId, values: group.map(describeActionValue), actions: group });
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

  return { writes, outOfAskWrites, correctionOffers, collisions, volunteeredRepeatGroups };
}

// The clinician-facing name for a field in an acknowledgment or a
// correction offer (ask-copy.md rule 6): the authored display name, never
// the manifest label the old fieldPhrase() derived one from.
function fieldOrId(fieldId: string, fields: FormFieldSpec[]): string {
  return fields.some((f) => f.id === fieldId) ? displayNameFor(fieldId) : fieldId;
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

// ask-copy.md rule 8: `I heard two values for {name}: {a} and {b} — which
// should I write?`. The count is derived rather than asserted, following
// open-fields.ts's openFieldsHeading() ("derived from the count, never
// hardcoded"): nothing in validateCandidates() caps or dedupes a turn's
// candidates per field, so three proposals for one field is reachable and
// "two" would then be a false statement on an FDA report. Rule 8 authors
// the two-value sentence only — the numeral beyond it is this build's
// answer to a case the contract does not cover, and the gap is filed
// (warblersafety/wilson#113) rather than settled here.
//
// Exported (Issue #124) so a collision-choice chip's tap can quote the
// SAME sentence into its own transcript turn — reusing rule 8's one
// authored line rather than inventing a second, shorter paraphrase the
// way the correction-offer chip's "Replace {name}?" does. Rule 8 doesn't
// author a short form for this, so this build doesn't either.
export function collisionSentence(collision: FieldCollision, fields: FormFieldSpec[]): string {
  const count = collision.values.length === 2 ? "two" : `${collision.values.length}`;
  const name = fieldOrId(collision.fieldId, fields);
  return `I heard ${count} values for ${name}: ${joinNames(collision.values)} — which should I write?`;
}

// ask-copy.md rule 8's dismiss-tap acknowledgment (#110). Takes the
// FACTS the tap resolved, never their fields — chip-grammar.ts's
// dismissAcknowledgment() is the caller that works them out, from rule
// 9's own fact names. One tap on DV-1 writes ten fields and
// names one fact; naming the ten would be the recite-the-field-list
// failure rule 9 exists to remove, in a new sentence.
//
// Rendered as a prefix on the next question (direct-step.ts's
// replyPrefix), not as a talker turn of its own: the sweep's own
// acknowledgments compose that way (talk.ts's respond()), and a second
// bubble per tap is the double-bubble class unit #89 removed.
export function describeDismissal(names: string[], action: "mark_unknown" | "decline"): string {
  if (names.length === 0) {
    throw new Error("describeDismissal: a dismissal must name at least one resolved fact");
  }
  return `Marked ${joinNames(names)} as ${action === "mark_unknown" ? "not on hand" : "declined"}.`;
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
      (action) => `${fieldOrId(action.fieldId, fields)}: ${describeActionValue(action)}`,
    );
    sentences.push(`Also noted — ${fragments.join("; ")}.`);
  }

  for (const offer of result.correctionOffers) {
    sentences.push(correctionOfferSentence(offer, fields));
  }

  for (const collision of result.collisions) {
    sentences.push(collisionSentence(collision, fields));
  }

  for (const group of result.volunteeredRepeatGroups) {
    sentences.push(`Noted — I'll ask about that once we get to additional ${REPEAT_GROUP_LABELS[group]}.`);
  }

  return sentences.join(" ");
}
