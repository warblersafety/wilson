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
  DISMISS_CHIPS,
  dismissAcknowledgment,
  dismissableFieldIds,
  friendlyFailureMessage,
  remainingCorrectionOffers,
  widgetTurnText,
} from "@/lib/chip-grammar";
import type { CorrectionOffer } from "@/lib/followup-sweep";
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
      onSubmitted(
        await stepForSession(nextSession, {
          appendReply: true,
          // ask-copy.md rule 8 (#110). Named from the same step the
          // `fieldIds` above came from, so the sentence names exactly the
          // facts this tap resolved.
          replyPrefix: dismissAcknowledgment(current.nextStep, action),
        }),
      );
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
        record: applyProposedActions(current.session.record, [offer.action]),
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
            const label = displayNameFor(offer.fieldId);
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
