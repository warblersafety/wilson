"use client";

// The Start surface (Issue #42) — design.md's "Interaction model and UI",
// surface 1: no separate landing page, this composer is the landing. The
// two pinned questions are framing above one composer, not two inputs —
// the clinician answers both in a single dictated or typed narrative.
import { useEffect, useState, useTransition, type FormEvent } from "react";
import { submitNarrative } from "@/app/actions";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { initAgenda } from "@/lib/agenda";
import { clearIntakeDraft, saveIntakeDraft } from "@/lib/session-storage";
import { START_COPY, resolveStartSubmit, validateNarrative, type ReadBackHandoff } from "@/lib/start-surface";
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
  // A draft recovered from a previous visit (Issue #72). Seeds the
  // composer's initial state only — IntakeFlow holds this surface back
  // until storage has been read, so there is no later change to react to,
  // and useState's initial value is enough.
  initialNarrative?: string;
  onLanded: (handoff: ReadBackHandoff) => void;
}

export function StartSurface({ initialNarrative = "", onLanded }: StartSurfaceProps) {
  const [narrative, setNarrative] = useState(initialNarrative);
  const [submitFailure, setSubmitFailure] = useState<{ reason: "invalid" | "failed"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  // Persisted as the clinician types, so a reload mid-dictation resumes
  // where they were instead of dropping them on a blank composer with no
  // warning (#56). Written on every change rather than debounced: this is
  // one string capped at MAX_NARRATIVE_LENGTH, and a debounce would trade
  // a real (if small) window of exactly the loss this closes for an
  // optimization localStorage does not need.
  //
  // An empty composer clears the key rather than storing an empty draft —
  // there is nothing to resume, and leaving the clinician's cleared text
  // behind as an empty record of itself is worse than leaving nothing.
  useEffect(() => {
    if (narrative === "") {
      clearIntakeDraft(window.localStorage);
      return;
    }
    saveIntakeDraft(window.localStorage, { kind: "start", narrative });
  }, [narrative]);

  const validation = validateNarrative(narrative);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitFailure(null);
    startTransition(async () => {
      const outcome = await resolveStartSubmit(narrative, initTalkSession(), submitNarrative);
      if (outcome.landed) {
        onLanded(outcome.handoff);
      } else {
        setSubmitFailure({ reason: outcome.reason, message: outcome.message });
      }
    });
  }

  return (
    <ReportChrome record={EMPTY_RECORD} repeatCounts={EMPTY_REPEAT_COUNTS} currentTopicId={null}>
      <main className="start-surface">
        <h1 className="start-surface__heading">{START_COPY.heading}</h1>
        <div className="start-surface__questions">
          <p>{START_COPY.firstQuestion}</p>
          <p>{START_COPY.secondQuestion}</p>
        </div>
        <form onSubmit={handleSubmit} className="start-surface__form">
          <textarea
            className="start-surface__composer"
            value={narrative}
            onChange={(e) => setNarrative(e.target.value)}
            disabled={isPending}
            placeholder={START_COPY.composerPlaceholder}
            aria-label={START_COPY.composerLabel}
            rows={10}
          />
          {!validation.ok && validation.reason === "too-long" && (
            <p className="start-surface__hint" role="alert">
              {validation.message}
            </p>
          )}
          <button type="submit" disabled={isPending || !validation.ok}>
            {isPending ? START_COPY.submitPending : START_COPY.submitCta}
          </button>
          {submitFailure && (
            <div className="start-surface__error" role="alert">
              <p className="start-surface__error-message">{submitFailure.message}</p>
              {/* Retry only where retrying means something: an over-length
                  narrative needs an edit first, and a "Try again" beside
                  copy that says "shorten this" would invite the clinician
                  to press it and fail identically (src/lib/start-surface.ts's
                  `reason`). */}
              {submitFailure.reason === "failed" && (
                <button type="button" onClick={handleSubmit} disabled={isPending}>
                  {START_COPY.retryCta}
                </button>
              )}
            </div>
          )}
        </form>
        {/* The whole data path, in order: voice, draft, submitted text,
            and what wilson does at the end. The draft sentence is new with
            Issue #72, which is what makes a reload survivable — design.md's
            privacy-copy rule is that copy claims exactly what the
            machinery delivers, so machinery that now keeps a draft has to
            say so — and says "until you start over", not "until you
            submit": submitting REPLACES the draft with the read-back one
            and confirming moves the narrative into the persisted session
            transcript, so local retention doesn't end at submit, it gets
            longer-lived (reviewer pass, PR #80, finding 2). The closing sentence replaced "Nothing is filed until
            you sign off", which implied wilson files the report once you
            do; it never does, and a clinician who believed it could sign
            off and never send the report at all. */}
        <p className="start-surface__privacy">{START_COPY.privacy}</p>
      </main>
    </ReportChrome>
  );
}
