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
  // A draft recovered from a previous visit (Issue #72). Seeds the
  // composer's initial state only — IntakeFlow holds this surface back
  // until storage has been read, so there is no later change to react to,
  // and useState's initial value is enough.
  initialNarrative?: string;
  onLanded: (handoff: ReadBackHandoff) => void;
}

export function StartSurface({ initialNarrative = "", onLanded }: StartSurfaceProps) {
  const [narrative, setNarrative] = useState(initialNarrative);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
        <p className="start-surface__privacy">
          wilson never hears your voice — dictation happens on your device, and only text you approve is
          sent. Your text stays in this browser, on this device, until you start over. Submitted text is
          processed by wilson&rsquo;s model provider to help fill out the report. wilson fills the form and
          hands it back to you — it never files anything with FDA on your behalf.
        </p>
      </main>
    </ReportChrome>
  );
}
