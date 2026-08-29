"use client";

// Free-text turn (Issue #32) for topic asks — repeat-decision steps now
// go through RepeatDecision.tsx instead (Issue #44: chips, no free-text
// detour). Real answers still flow through the Server Action
// (src/app/actions.ts), which runs the real Extractor server-side, since
// interpreting free text is exactly the job extraction exists for. The
// composer is multi-line (Issue #44 AC: "keep the dictation-friendly
// composer"), and "I don't have that"/"rather not say" are one-tap chips
// that bypass extraction entirely — dismissing a whole bundled topic ask
// is a deterministic, direct write, not something that needs
// interpretation. Called as a plain function (not a <form action>
// binding) since it needs the full TalkSession alongside the typed
// message, not just FormData — per Next's Server Actions guide, invoked
// from a client-side transition.
import { useState, useTransition, type FormEvent } from "react";
import { submitTurn } from "@/app/actions";
import { Chip } from "@/components/Chip";
import { displayNameFor } from "@/lib/display-names";
import {
  applyActionToFields,
  collisionTapResult,
  DISMISS_CHIPS,
  dismissAcknowledgment,
  dismissableFieldIds,
  friendlyFailureMessage,
  remainingCollisions,
  remainingCorrectionOffers,
  widgetTurnText,
} from "@/lib/chip-grammar";
import type { CorrectionOffer, FieldCollision } from "@/lib/followup-sweep";
import { applyProposedActions, type TalkSession, type TalkStep } from "@/lib/talk";
import { stepForSession } from "./direct-step";


interface AskFormProps {
  current: TalkStep;
  onSubmitted: (next: TalkStep) => void;
  // Reports pending state upward so the parent can disable other chip
  // affordances while a submission is in flight — otherwise a chip tap
  // resolving mid-request gets silently clobbered when this form's (now-
  // stale) response lands.
  onPendingChange?: (pending: boolean) => void;
}

// Rendered from chip-grammar.ts's map rather than typed here: the gate
// driver clicks these by visible text, and a rename that only touched
// this file used to leave every check green (doc-review on #96).
const [UNKNOWN_LABEL, DECLINE_LABEL] = Object.keys(DISMISS_CHIPS) as ["I don't have that", "Rather not say"];

export function AskForm({ current, onSubmitted, onPendingChange }: AskFormProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDismissing, setIsDismissing] = useState(false);

  // Capped to what this turn's ask actually phrased (chip-grammar.ts's
  // dismissableFieldIds) — passing current.nextStep's own raw fieldIds
  // here used to let one dismiss tap silently write every unresolved
  // field in a bundled topic, not just the ones asked about (reviewer
  // pass on PR #64).
  const fieldIds = dismissableFieldIds(current.nextStep);
  const busy = isPending || isDismissing;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (text.length === 0) return;
    setError(null);
    onPendingChange?.(true);
    startTransition(async () => {
      const result = await submitTurn(current.session, text);
      onPendingChange?.(false);
      if (result.ok) {
        setMessage("");
        onSubmitted(result.step);
      } else {
        setError(friendlyFailureMessage(result.message));
      }
    });
  }

  // "I don't have that" / "rather not say" dismiss the whole bundled
  // topic ask in one tap — a deterministic direct write (applyAction via
  // stepForSession), same as RepeatDecision's chip writes, not a
  // submission that needs the real Extractor to interpret. appendReply:
  // true so the recomputed follow-up question enters the transcript as
  // its own talker turn, not just current.reply — otherwise a typed
  // answer to THAT question (submitTurn only ever appends the
  // clinician's own message) would land with no question visible above
  // it (direct-step.ts's file header; reviewer pass on PR #64).
  async function handleDismiss(action: "mark_unknown" | "decline", answerLabel: string) {
    if (fieldIds.length === 0) return;
    setError(null);
    setIsDismissing(true);
    onPendingChange?.(true);
    try {
      const nextSession: TalkSession = {
        ...current.session,
        record: applyActionToFields(current.session.record, fieldIds, { type: action }),
        transcript: [
          ...current.session.transcript,
          // Just the chip's own words (Issue #123) — the question it
          // answers is already on screen as the preceding talker turn, so
          // quoting it again here would make the clinician's turn a
          // recitation rather than an answer.
          { role: "clinician", text: widgetTurnText(answerLabel), source: "widget" },
        ],
      };
      const nextStepResult = await stepForSession(nextSession, {
        appendReply: true,
        // ask-copy.md rule 8 (#110). Named from the same step the
        // `fieldIds` above came from, so the sentence names exactly the
        // facts this tap resolved.
        replyPrefix: dismissAcknowledgment(current.nextStep, action),
      });
      onSubmitted({
        ...nextStepResult,
        // Reviewer pass on PR #142, finding 2: stepForSession()'s fresh
        // TalkStep carries neither pending-offer channel of its own — a
        // dismiss tap writes only the CURRENT ask's own fieldIds, never
        // a correctionOffer's or collision's field (those always name
        // OTHER fields this turn's sweep found extra evidence for), so
        // both channels are exactly as pending after the tap as they
        // were before it and must be carried forward untouched, the same
        // way handleAcceptCorrection/handleAcceptCollision below carry
        // forward whichever channel they did NOT just resolve.
        correctionOffers: current.correctionOffers,
        collisions: current.collisions,
      });
    } catch (err) {
      setError(friendlyFailureMessage(err instanceof Error ? err.message : "unknown"));
    } finally {
      setIsDismissing(false);
      onPendingChange?.(false);
    }
  }

  // One-tap correction accept (Issue #44, design.md: "one tap to accept
  // (a deterministic write through the normal path, recorded in the
  // transcript)"). The turn's reply already states the offer in full
  // ("you said X for <field> — it's recorded as Y; replace it?") — the
  // chip itself just needs to name which field it applies to, for a
  // clinician juggling more than one offer at once. Sets isDismissing
  // the same as handleDismiss above (not just onPendingChange, which
  // only reaches the PARENT's chip affordances) so THIS form's own
  // composer/chips — including any other correction-offer chip — are
  // disabled for the duration too; without it, a second offer tapped
  // mid-flight could resolve out of order against a stale current.session
  // (reviewer pass on PR #64). remainingCorrectionOffers() carries the
  // turn's other, still-unactioned offers forward — stepForSession()'s
  // fresh step has none of its own, so without this an accept used to
  // silently drop every offer but the one just accepted.
  async function handleAcceptCorrection(offer: CorrectionOffer) {
    setError(null);
    setIsDismissing(true);
    onPendingChange?.(true);
    try {
      const nextSession: TalkSession = {
        ...current.session,
        // ask-copy.md rule 7's amendment (#126): an exclusive-fact offer
        // carries the FULL atomic rewrite in `exclusiveFact.writes` (the
        // new member true, every sibling false, one operation) — never
        // `[offer.action]` alone, which would write only the named
        // member and leave the group's prior "true" sibling standing,
        // exactly the both-boxes-checked defect this offer shape exists
        // to prevent. An ordinary field-level offer carries no
        // `exclusiveFact` and applies `offer.action` alone, unchanged.
        record: applyProposedActions(current.session.record, offer.exclusiveFact?.writes ?? [offer.action]),
        transcript: [
          ...current.session.transcript,
          // Issue #123: no synthetic "Replace <field>? —" question
          // prefix — the chip's own label already names the field
          // (JSX below), and the offer itself is stated in full by the
          // preceding talker turn (current.reply).
          { role: "clinician", text: widgetTurnText("Yes, replace it"), source: "widget" },
        ],
      };
      const nextStepResult = await stepForSession(nextSession, { appendReply: true });
      onSubmitted({
        ...nextStepResult,
        correctionOffers: remainingCorrectionOffers(current.correctionOffers, offer.fieldId),
        // Reviewer pass on PR #142, finding 2: a same-turn collision
        // names a DIFFERENT field than the offer just accepted
        // (classifyFollowUpActions() puts each field in at most one of
        // the two channels), so it is untouched by this accept and must
        // be carried forward as-is — without this, accepting a
        // correction offer used to silently drop every pending collision
        // chip, even though none of them was acted on.
        collisions: current.collisions,
      });
    } catch (err) {
      setError(friendlyFailureMessage(err instanceof Error ? err.message : "unknown"));
    } finally {
      setIsDismissing(false);
      onPendingChange?.(false);
    }
  }

  // One-tap collision resolution (Issue #124 AC-1/AC-2), the same shape as
  // handleAcceptCorrection above: a deterministic write through the
  // normal path, recorded in the transcript, one tap. `index` selects
  // which of `collision.values`/`collision.actions` was tapped — chip
  // labels ARE the values themselves (mirroring Read-back's own
  // collision radios and the correction-offer chip's field label), so
  // the tap already tells us which one without asking the clinician to
  // disambiguate a second time. remainingCollisions() carries the turn's
  // other, still-unresolved collisions forward, mirroring
  // remainingCorrectionOffers() just above and for the same reason
  // (reviewer pass on PR #64): stepForSession()'s fresh step has none of
  // its own.
  //
  // Issue #154: "the normal path" is chip-grammar.ts's
  // collisionTapResult() — not a raw applyProposedActions() of the
  // tapped action alone — a tap on a one-hot (`exclusive`) member used to
  // bypass classifyFollowUpActions() entirely and so never got that
  // member's atomic-write/conflict-check treatment, which is how a tap
  // could leave both sex boxes checked on an FDA-bound form. The record
  // it returns may therefore be UNCHANGED with an appended correction
  // offer instead of a write, and a replyPrefix stating that offer's
  // sentence (stepForSession() never calls describeFollowUpSweep()
  // itself, so without the prefix a "Replace {fact}" chip would appear
  // with nothing on screen explaining it). Reviewer pass on PR #167
  // (SHOULD-FIX): this composition — the append, the prefix — used to
  // live inline here, where this repo's lack of a component test
  // harness meant neither was pinned; both are chip-grammar.test.ts's
  // collisionTapResult() tests now, mutation-verified.
  async function handleAcceptCollision(collision: FieldCollision, index: number) {
    setError(null);
    setIsDismissing(true);
    onPendingChange?.(true);
    try {
      const { record, correctionOffers, replyPrefix } = collisionTapResult(
        current.session.record,
        current.correctionOffers,
        collision,
        index,
      );
      const nextSession: TalkSession = {
        ...current.session,
        record,
        transcript: [
          ...current.session.transcript,
          // Issue #123 (dev merged in after this handler was first
          // written, during the reviewer-pass follow-up on PR #142): no
          // collisionSentence() prefix — rule 8's own line is already on
          // screen as part of current.reply (describeFollowUpSweep()
          // puts every pending collision's sentence there), so quoting
          // it again into the clinician's own tap would be the same
          // recitation #123 removed from handleDismiss/
          // handleAcceptCorrection above. The tapped value is the whole
          // answer whether it writes straight through or — #154 — comes
          // back as a conflict instead: either way it's what the
          // clinician tapped, so the turn quotes it the same.
          { role: "clinician", text: widgetTurnText(collision.values[index]), source: "widget" },
        ],
      };
      const nextStepResult = await stepForSession(nextSession, { appendReply: true, replyPrefix });
      onSubmitted({
        ...nextStepResult,
        collisions: remainingCollisions(current.collisions, collision.fieldId),
        // Reviewer pass on PR #142, finding 2 (SHOULD-FIX, the worst-case
        // direction): without this, accepting a collision chip silently
        // dropped every pending correction-offer chip too — e.g. the
        // "Replace date of event" chip vanishing while EventDate stayed
        // `answered` at the wrong value, which the walk then never
        // re-asks about (it isn't `unasked`). A same-turn correction
        // offer names a different field than the collision just
        // resolved, so it carries forward untouched — collisionTapResult()
        // above already does the append-or-carry-forward decision, so
        // this is simply what it returned.
        correctionOffers,
      });
    } catch (err) {
      setError(friendlyFailureMessage(err instanceof Error ? err.message : "unknown"));
    } finally {
      setIsDismissing(false);
      onPendingChange?.(false);
    }
  }

  return (
    <form className="ask-form" onSubmit={handleSubmit}>
      <p className="ask-form__reply">{current.reply}</p>
      {current.correctionOffers && current.correctionOffers.length > 0 && (
        <div className="ask-form__corrections" role="group" aria-label="Correction offers">
          {current.correctionOffers.map((offer) => {
            // ask-copy.md rule 7's amendment (#126): an exclusive-fact
            // offer is named by the FACT ("Replace sex"), never the
            // member ("Replace sex: female") — member-level naming is
            // exactly the shape item 3 abolishes for one-hot members.
            const label = offer.exclusiveFact?.name ?? displayNameFor(offer.fieldId);
            return (
              <Chip
                key={offer.fieldId}
                label={`Replace ${label}`}
                disabled={busy}
                onClick={() => void handleAcceptCorrection(offer)}
              />
            );
          })}
        </div>
      )}
      {current.collisions && current.collisions.length > 0 && (
        <div className="ask-form__collisions">
          {current.collisions.map((collision) => (
            <div
              key={collision.fieldId}
              className="ask-form__collision-group"
              role="group"
              aria-label={`Choose a value for ${displayNameFor(collision.fieldId)}`}
            >
              {collision.values.map((value, index) => (
                <Chip
                  key={index}
                  label={value}
                  disabled={busy}
                  onClick={() => void handleAcceptCollision(collision, index)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
      <textarea
        className="ask-form__composer"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={busy}
        placeholder="Type or dictate your answer…"
        aria-label="Your answer"
        rows={3}
      />
      <p className="ask-form__hint">
        Answer more than one topic at once if it&rsquo;s easier — I&rsquo;ll sort out where everything goes.
      </p>
      <div className="ask-form__actions">
        <button type="submit" disabled={busy || message.trim().length === 0}>
          {isPending ? "Sending…" : "Send"}
        </button>
        <Chip
          label={UNKNOWN_LABEL}
          disabled={busy}
          onClick={() => void handleDismiss("mark_unknown", UNKNOWN_LABEL)}
        />
        <Chip
          label={DECLINE_LABEL}
          disabled={busy}
          onClick={() => void handleDismiss("decline", DECLINE_LABEL)}
        />
      </div>
      {error && (
        <p className="ask-form__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
