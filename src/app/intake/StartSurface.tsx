"use client";

// The Start surface (Issue #42) — design.md's "Interaction model and UI",
// surface 1: no separate landing page, this composer is the landing. The
// two pinned questions are framing above one composer, not two inputs —
// the clinician answers both in a single dictated or typed narrative.
import { useState, useTransition, type FormEvent } from "react";
import { submitNarrative } from "@/app/actions";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { initAgenda } from "@/lib/agenda";
import { resolveStartSubmit, validateNarrative, type ReadBackHandoff } from "@/lib/start-surface";
import { initTalkSession } from "@/lib/talk";
import { initRepeatCounts } from "@/lib/topics";

// Module-level, not computed per render: AgendaRecord/RepeatCounts are
// treated immutably everywhere else in this codebase (applyAction/
// setRepeatCount always return a new object, never mutate), so one
// shared empty instance is safe to reuse across every render and mount —
// re-deriving it on every keystroke otherwise re-walks 227 fields and 34
// topics for an always-identical result (reviewer pass, PR #75, F11).
const EMPTY_RECORD = initAgenda();
const EMPTY_REPEAT_COUNTS = initRepeatCounts();

interface StartSurfaceProps {
  onLanded: (handoff: ReadBackHandoff) => void;
}

export function StartSurface({ onLanded }: StartSurfaceProps) {
  const [narrative, setNarrative] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const validation = validateNarrative(narrative);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    startTransition(async () => {
      const outcome = await resolveStartSubmit(narrative, initTalkSession(), submitNarrative);
      if (outcome.landed) {
        onLanded(outcome.handoff);
      } else {
        setSubmitError(outcome.message);
      }
    });
  }

  return (
    <ReportChrome record={EMPTY_RECORD} repeatCounts={EMPTY_REPEAT_COUNTS} currentTopicId={null}>
      <main className="start-surface">
        <h1 className="start-surface__heading">Report an adverse event</h1>
        <div className="start-surface__questions">
          <p>What&rsquo;s the suspect product, and what reaction did the patient have?</p>
          <p>When did it happen, and what was the outcome?</p>
        </div>
        <form onSubmit={handleSubmit} className="start-surface__form">
          <textarea
            className="start-surface__composer"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            disabled={isPending}
            placeholder="Dictate or type what happened…"
            aria-label="Adverse event narrative"
            rows={10}
          />
          {!validation.ok && validation.reason === "too-long" && (
            <p className="start-surface__hint" role="alert">
              {validation.message}
            </p>
          )}
          <button type="submit" disabled={isPending || !validation.ok}>
            {isPending ? "Reading through what you wrote…" : "Submit"}
          </button>
          {submitError && (
            <p className="start-surface__error" role="alert">
              {submitError}
            </p>
          )}
        </form>
        <p className="start-surface__privacy">
          wilson never hears your voice — dictation happens on your device, and only text you approve is
          sent. That text is processed by wilson&rsquo;s model provider to help fill out the report. Nothing
          is filed until you sign off.
        </p>
      </main>
    </ReportChrome>
  );
}
