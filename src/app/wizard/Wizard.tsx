"use client";

// The step-wizard UI (Issue #32) — replaces the placeholder homepage,
// driven entirely by the real nextStep()/TOPICS, not hardcoded per-topic.
import { useEffect, useState } from "react";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { askDeterministic } from "@/lib/ask";
import { clearIntakeState, loadSession, saveSession } from "@/lib/session-storage";
import { initTalkSession, startTalk, type TalkSession, type TalkStep } from "@/lib/talk";
import { currentTopicProgress } from "@/lib/topics";
import { AskForm } from "./AskForm";
import { stepForSession } from "./direct-step";
import { RepeatDecision } from "./RepeatDecision";
import { Transcript } from "./Transcript";
import { visibleTranscriptTurns } from "./transcript-view";

// No model call — askDeterministic never touches the network, so this is
// safe to run on both the initial mount and every reload.
async function freshStep(): Promise<TalkStep> {
  return startTalk(initTalkSession(), { ask: askDeterministic });
}

interface WizardProps {
  // Hands the finished session to IntakeFlow, which routes it to Review
  // (Issue #45). Required, not optional: the "done" branch this replaces
  // used to render the review/export step itself, and a missing hand-off
  // would strand a clinician on a surface with nothing left to ask.
  onDone: (session: TalkSession) => void;
}

export function Wizard({ onDone }: WizardProps) {
  const [current, setCurrent] = useState<TalkStep | null>(null);
  // Disables AskForm/RepeatDecision's chip affordances while a submission
  // is in flight: both write from their own session snapshot, so a chip
  // tap that resolves after a slower Server Action response would
  // otherwise get silently clobbered when the stale response lands.
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const stored = loadSession(window.localStorage);
      let step: TalkStep;
      try {
        // stepForSession's default (no appendReply): re-deriving the
        // CURRENT step from a stored session must never append it as a
        // new talker turn, or every reload would duplicate the last
        // question (direct-step.ts's file header).
        step = stored ? await stepForSession(stored) : await freshStep();
      } catch {
        // A stored session that no longer matches the current field
        // manifest/topic map (nextStep()'s documented "missing field id"
        // throw) would otherwise leave the wizard stuck on "Loading…"
        // forever — fail forward into a fresh session instead.
        //
        // clearIntakeState, not clearSession: this is the "stored state is
        // unusable, start clean" path, and clearing only the session left
        // any pre-confirmation draft standing. IntakeFlow's own resume
        // then falls through to that draft on the next reload and throws
        // the clinician back to a Read-back they already confirmed, with
        // their follow-up answers gone (reviewer pass, PR #80, finding 4 —
        // this is the exact case clearIntakeState exists to prevent).
        clearIntakeState(window.localStorage);
        step = await freshStep();
      }
      if (!cancelled) setCurrent(step);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Hands off to Review the moment nothing is left to ask (Issue #45).
  // Keyed on the derived step rather than fired from handleStep(), so it
  // covers BOTH paths that reach "done": a live answer that resolves the
  // last topic, and mount-time hydration of a stored session that was
  // already finished (a reload on Review or Ready lands here, since only
  // the session persists, never which surface was showing). Both converge
  // on the same `current` state, so one effect covers both.
  useEffect(() => {
    if (current?.nextStep.kind === "done") onDone(current.session);
  }, [current, onDone]);

  function handleStep(next: TalkStep) {
    setCurrent(next);
    saveSession(window.localStorage, next.session);
  }

  if (!current) {
    // Deliberately unwrapped: `current` is null only during the async
    // hydration gap before a stored session's real record is known
    // (reviewer pass, PR #75, finding F10) — chrome around this branch
    // would assert "nothing written yet" over a session that may have
    // most of the form filled in, a false claim for however briefly it
    // shows.
    return (
      <main className="wizard">
        <p>Loading…</p>
      </main>
    );
  }

  const { session, nextStep: step } = current;
  // The Follow-ups surface's topic-progress line (Issue #44 AC-1): the
  // real, currently-open topic's position among the flat topic walk — the
  // report chrome's curated nine-row rollup (design.md) is #67's own
  // scope, not reproduced here. null once nextStep() reaches "done" (the
  // done-state render below has nothing to show a progress line for) —
  // the same null the chrome's own currentTopicId prop wants at that
  // point, so it's reused rather than a second lookup.
  const progress = currentTopicProgress(session.record, session.repeatCounts);

  return (
    <ReportChrome record={session.record} repeatCounts={session.repeatCounts} currentTopicId={progress?.topic.id ?? null}>
      <main className="wizard">
        {/* visibleTranscriptTurns, not session.transcript (Issue #89):
            talk.ts appends every composed reply to the session, so the
            ask below would otherwise render here too — the same
            paragraph back-to-back in gray and teal on every turn. The
            session keeps the turn; only this view drops it. */}
        <Transcript turns={visibleTranscriptTurns(current)} progress={progress} />
        {step.kind === "topic" && (
          <AskForm current={current} onSubmitted={handleStep} onPendingChange={setIsSubmitting} />
        )}
        {step.kind === "repeat-decision" && (
          <RepeatDecision
            session={session}
            repeatGroup={step.repeatGroup}
            afterInstance={step.afterInstance}
            reply={current.reply}
            onChange={handleStep}
            disabled={isSubmitting}
          />
        )}
        {/* "done" renders nothing: the effect above is already handing
            this session to Review, one tick away. Showing the previous
            step's ask for that tick would be worse than a blank — it
            reads as a question the clinician still has to answer. */}
      </main>
    </ReportChrome>
  );
}
