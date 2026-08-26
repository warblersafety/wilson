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
import { friendlyFailureMessage, applyActionToFields, widgetTurnText } from "@/lib/chip-grammar";
import type { TalkSession, TalkStep } from "@/lib/talk";
import { stepForSession } from "./direct-step";

interface AskFormProps {
  current: TalkStep;
  onSubmitted: (next: TalkStep) => void;
  // Reports pending state upward so the parent can disable TopicFields'
  // checkbox/enum widgets while a submission is in flight — otherwise a
  // checkbox edit resolving mid-request gets silently clobbered when this
  // form's (now-stale) response lands.
  onPendingChange?: (pending: boolean) => void;
}

export function AskForm({ current, onSubmitted, onPendingChange }: AskFormProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isDismissing, setIsDismissing] = useState(false);

  const fieldIds = current.nextStep.kind === "topic" ? current.nextStep.fieldIds : [];
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
  // stepForSession), same as TopicFields' chip writes, not a submission
  // that needs the real Extractor to interpret.
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
          { role: "clinician", text: widgetTurnText(current.reply, answerLabel), source: "widget" },
        ],
      };
      onSubmitted(await stepForSession(nextSession));
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
      <textarea
        className="ask-form__composer"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={busy}
        placeholder="Type or dictate your answer…"
        aria-label="Your answer"
        rows={3}
      />
      <div className="ask-form__actions">
        <button type="submit" disabled={busy || message.trim().length === 0}>
          {isPending ? "Sending…" : "Send"}
        </button>
        <Chip
          label="I don't have that"
          disabled={busy}
          onClick={() => void handleDismiss("mark_unknown", "I don't have that")}
        />
        <Chip
          label="Rather not say"
          disabled={busy}
          onClick={() => void handleDismiss("decline", "Rather not say")}
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
