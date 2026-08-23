"use client";

// Free-text turn (Issue #32): topic text/date fields and repeat-decision
// steps both flow through here, into the real Server Action
// (src/app/actions.ts), which runs the real Extractor server-side. Called
// as a plain function (not a <form action> binding) since it needs the
// full TalkSession alongside the typed message, not just FormData — per
// Next's Server Actions guide, invoked from a client-side transition.
import { useState, useTransition } from "react";
import { submitTurn } from "@/app/actions";
import type { TalkStep } from "@/lib/talk";

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

  function handleSubmit(e: React.FormEvent) {
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
        setError(result.message);
      }
    });
  }

  return (
    <form className="ask-form" onSubmit={handleSubmit}>
      <p className="ask-form__reply">{current.reply}</p>
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={isPending}
        placeholder="Type your answer…"
        aria-label="Your answer"
      />
      <button type="submit" disabled={isPending || message.trim().length === 0}>
        {isPending ? "Sending…" : "Send"}
      </button>
      {error && (
        <p className="ask-form__error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
