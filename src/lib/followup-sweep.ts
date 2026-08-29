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
import { exclusiveFactContaining, type AskFact } from "./ask-inventory";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import type { FieldState } from "./field-state";
import { REPEAT_GROUP_LABELS } from "./ask";
import { displayNameFor, exclusiveMemberValue, joinNames } from "./display-names";
import type { ProposedAction } from "./talk";
import { repeatGroupOfLaterInstanceField, TOPICS, type RepeatGroup, type Topic } from "./topics";

// A resolved field the sweep found new evidence for, but did not write —
// see talk.ts's re-export of this type for the full design-basis comment.
export interface CorrectionOffer {
  fieldId: string;
  action: ProposedAction;
  currentState: FieldState;
  currentValue?: string;
  // Present only for a conflict against an already-answered `exclusive`
  // fact (ask-copy.md rule 7's amendment, #126, item 3): a per-field
  // offer is exactly wrong here — accepted against SexF while SexM
  // stands answered, it is how a report ends with both sex boxes checked
  // on an FDA-bound form. `writes` is the FULL atomic rewrite (the new
  // member true, every OTHER member false, in the fact's own field
  // order) to apply on accept — never `[action]` alone. `currentFieldId`
  // is the sibling currently holding the fact's "true" value, carried so
  // the sentence builder can name what it's being replaced with. Absent
  // means the ordinary field-level offer below applies.
  exclusiveFact?: { name: string; writes: ProposedAction[]; currentFieldId: string };
}

// The full atomic rewrite for one exclusive fact's conflict, in the
// fact's own field order — the named member's own action stands where it
// falls, every other member becomes an explicit "false" write. Mirrors
// derive.ts's completeExclusiveFactWrites in spirit (same fact, same
// all-other-members-false shape) but is not the same function: that one
// derives ADDITIONS to a batch that already contains the triggering
// write and skips already-settled siblings (a fresh completion); this is
// a full, unconditional REPLACEMENT of every member's value, because a
// conflict-against-answered means every sibling is already resolved one
// way and the whole group is being rewritten, not completed.
export function exclusiveFactRewrite(fact: AskFact, action: ProposedAction): ProposedAction[] {
  return fact.fieldIds.map((fieldId) => (fieldId === action.fieldId ? action : { fieldId, type: "answer", value: "false" }));
}

// The sibling currently holding this exclusive fact's "true" value when
// it is a DIFFERENT member than `fieldId` — i.e. a real conflict.
// undefined when there is no conflict (no fact, nothing answered true, or
// the same member re-confirming itself).
//
// Shared by classifyFollowUpActions below (a grounded action from the
// extract path's own turn) and chip-grammar.ts's resolveCollisionTap (a
// tapped collision chip, #154) — the exact same function, one mechanism,
// not two, so a tap faces the identical conflict check every other
// grounded "true" write faces rather than a second, hand-rolled copy of
// it that could drift from this one.
export function conflictingExclusiveSibling(
  record: AgendaRecord,
  fieldId: string,
): { fact: AskFact; currentFieldId: string } | undefined {
  const fact = exclusiveFactContaining(fieldId);
  if (fact === undefined) return undefined;
  const currentTrueFieldId = fact.fieldIds.find(
    (id) => record[id]?.state === "answered" && record[id]?.value === "true",
  );
  if (currentTrueFieldId === undefined || currentTrueFieldId === fieldId) return undefined;
  return { fact, currentFieldId: currentTrueFieldId };
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

    // Rule 7's amendment, item 3 (#126): a "true" write naming a member
    // of an `exclusive` fact is judged against the FACT's own resolution,
    // not the field's — never the ordinary per-field unasked/resolved
    // check below. Scoped to `type === "answer" && value === "true"`
    // deliberately: that is the only shape the amendment's language
    // covers ("the named member true"), and it is also the only shape
    // the extractor prompts ever produce for a one-hot member (propose
    // true for the box selected) — a stray "false" is left to the
    // ordinary field-level path, unchanged.
    if (action.type === "answer" && action.value === "true") {
      const exclusiveFact = exclusiveFactContaining(action.fieldId);
      if (exclusiveFact !== undefined) {
        // A DIFFERENT member already holds the fact's "true" value: a
        // real conflict, offered at fact granularity — never as a
        // member-level offer, which is exactly the shape that lets a
        // report end up with two boxes checked. Re-confirming the SAME
        // member that is already true, or nothing yet true at all, is
        // not a conflict — conflictingExclusiveSibling() returns
        // undefined for both — and falls through to the write below
        // like any other case where the fact isn't already answered
        // against this member. Shared with chip-grammar.ts's
        // resolveCollisionTap (#154): the exact same function, one
        // mechanism, not two.
        const conflict = conflictingExclusiveSibling(record, action.fieldId);
        if (conflict !== undefined) {
          correctionOffers.push({
            fieldId: action.fieldId,
            action,
            currentState: entry.state,
            currentValue: entry.value,
            exclusiveFact: {
              name: conflict.fact.name,
              currentFieldId: conflict.currentFieldId,
              writes: exclusiveFactRewrite(conflict.fact, action),
            },
          });
          continue;
        }
        // Not yet answered against this member — including a sibling
        // currently `unknown`/`declined`, which is exactly rule 7's
        // supersession case: those record an absence of value, not a
        // stated one, so this is a write, not an offer. Superseding the
        // SIBLING's unknown/declined state is derive.ts's
        // completeExclusiveFactWrites' job once this write lands in
        // `writes`, not this classifier's.
        writes.push(action);
        if (!askFieldIds.includes(action.fieldId)) {
          outOfAskWrites.push(action);
        }
        continue;
      }
    }

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

// Rule 7's amendment, item 3 (#126): the fact-granularity form the
// amendment quotes verbatim — "You said female for sex — it's recorded
// as male. Replace it?" — DIFFERENT from correctionOfferSentence()'s
// ordinary field-level shape below, which for a one-hot member would
// render the nonsense "You said true for sex: female — it's recorded as
// false. Replace it?". Both value halves are the bare stated value
// (display-names.ts's exclusiveMemberValue — "male", not "sex: male"),
// never the raw "true"/"false" internal representation.
function exclusiveFactCorrectionOfferSentence(offer: CorrectionOffer): string {
  const info = offer.exclusiveFact;
  if (info === undefined) {
    throw new Error("exclusiveFactCorrectionOfferSentence: offer carries no exclusiveFact");
  }
  const newValue = exclusiveMemberValue(offer.fieldId);
  const oldValue = exclusiveMemberValue(info.currentFieldId);
  return `You said ${newValue} for ${info.name} — it's recorded as ${oldValue}. Replace it?`;
}

// Exported (Issue #154) so a collision tap that resolves into a
// fact-granularity conflict (chip-grammar.ts's resolveCollisionTap) can
// quote the SAME sentence into stepForSession's replyPrefix — the same
// "quote the same authored line at tap time" reason #124 exported
// collisionSentence for, just below. Defaulted the same way
// describeFollowUpSweep() defaults its own `fields` param: every caller
// reachable from a tap always hits the exclusiveFact branch, which never
// reads `fields` at all, so forcing such a caller to import
// FORM_3500_FIELDS just to hand it back unused would be ceremony with no
// payoff.
export function correctionOfferSentence(offer: CorrectionOffer, fields: FormFieldSpec[] = FORM_3500_FIELDS): string {
  if (offer.exclusiveFact !== undefined) return exclusiveFactCorrectionOfferSentence(offer);
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
