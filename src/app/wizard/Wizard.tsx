"use client";

// The step-wizard UI (Issue #32) — replaces the placeholder homepage,
// driven entirely by the real nextStep()/TOPICS, not hardcoded per-topic.
import { useEffect, useState } from "react";
import { ReportChrome } from "@/components/report-chrome/ReportChrome";
import { askDeterministic } from "@/lib/ask";
import { clearSession, loadSession, saveSession } from "@/lib/session-storage";
import { initTalkSession, startTalk, type TalkStep } from "@/lib/talk";
import { currentTopicProgress, reopenTopic, type Topic } from "@/lib/topics";
import { AskForm } from "./AskForm";
import { stepForSession } from "./direct-step";
import { PdfReview } from "./PdfReview";
import { RepeatDecision } from "./RepeatDecision";
import { Transcript } from "./Transcript";

// No model call — askDeterministic never touches the network, so this is
// safe to run on both the initial mount and every reload.
async function freshStep(): Promise<TalkStep> {
  return startTalk(initTalkSession(), { ask: askDeterministic });
}

export function Wizard() {
  const [current, setCurrent] = useState<TalkStep | null>(null);
  // Disables AskForm/RepeatDecision's chip affordances while a submission
  // is in flight: both write from their own session snapshot, so a chip
  // tap that resolves after a slower Server Action response would
  // otherwise get silently clobbered when the stale response lands.
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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
        clearSession(window.localStorage);
        step = await freshStep();
      }
      if (!cancelled) setCurrent(step);
    }
    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleStep(next: TalkStep) {
    setCurrent(next);
    saveSession(window.localStorage, next.session);
  }

  async function handleStartOver() {
    clearSession(window.localStorage);
    setCurrent(await freshStep());
  }

  // The review-stage edit path (Issue #34): reopenTopic() sends the
  // topic's resolved fields — every type, since Issue #44 deleted the
  // checkbox/enum widget panel that used to make those "directly editable
  // in place" — back to `unasked`, so nextStep()'s own serial walk picks
  // it back up as a normal "topic" step, the same AskForm/Extractor path
  // a first answer goes through, not a raw patch. Shares stepForSession()
  // with RepeatDecision's chip writes (no transcript turn appended here,
  // matching topic.ts's own "current" definition — a reopen isn't a new
  // answer) rather than routing through processTurn().
  async function handleEditTopic(topic: Topic) {
    if (!current) return;
    try {
      const record = reopenTopic(current.session.record, topic);
      const step = await stepForSession({ ...current.session, record });
      setEditError(null);
      handleStep(step);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Could not reopen that topic.");
    }
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
        <Transcript turns={session.transcript} progress={progress} />
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
        {step.kind === "done" && (
          <div className="wizard__done">
            <p>{current.reply}</p>
            {editError && (
              <p className="wizard__edit-error" role="alert">
                {editError}
              </p>
            )}
            <PdfReview
              record={session.record}
              onEditTopic={(topic) => void handleEditTopic(topic)}
              disabled={isSubmitting}
            />
            <button type="button" onClick={() => void handleStartOver()}>
              Start over
            </button>
          </div>
        )}
      </main>
    </ReportChrome>
  );
}
