"use client";

// The step-wizard UI (Issue #32) — replaces the placeholder homepage,
// driven entirely by the real nextStep()/TOPICS, not hardcoded per-topic.
import { useEffect, useState } from "react";
import { askDeterministic } from "@/lib/ask";
import { clearSession, loadSession, saveSession } from "@/lib/session-storage";
import { initTalkSession, startTalk, type TalkStep } from "@/lib/talk";
import { nextStep, reopenTopic, topicStatuses, type Topic } from "@/lib/topics";
import { AskForm } from "./AskForm";
import { PdfReview } from "./PdfReview";
import { Sidebar } from "./Sidebar";
import { TopicFields } from "./TopicFields";

// No model call — askDeterministic never touches the network, so this is
// safe to run on both the initial mount and every reload.
async function freshStep(): Promise<TalkStep> {
  return startTalk(initTalkSession(), { ask: askDeterministic });
}

export function Wizard() {
  const [current, setCurrent] = useState<TalkStep | null>(null);
  // Disables TopicFields' checkbox/enum widgets while an AskForm submission
  // is in flight: both write from their own session snapshot, so a checkbox
  // edit that resolves after a slower Server Action response would
  // otherwise get silently clobbered when the stale response lands.
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const stored = loadSession(window.localStorage);
      let step: TalkStep;
      try {
        if (stored) {
          const next = nextStep(stored.record, stored.repeatCounts);
          step = { session: stored, nextStep: next, reply: await askDeterministic(next, stored) };
        } else {
          step = await freshStep();
        }
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
  // topic's resolved text/date fields back to `unasked`, so nextStep()'s
  // own serial walk picks it back up as a normal "topic" step — the same
  // AskForm/Extractor path a first answer goes through, not a raw patch.
  // Mirrors TopicFields' writeField(): construct the new TalkStep
  // directly (no transcript turn appended, matching topic.ts's own
  // "current" definition) rather than routing through processTurn().
  async function handleEditTopic(topic: Topic) {
    if (!current) return;
    const { session } = current;
    const record = reopenTopic(session.record, topic);
    const nextSession = { ...session, record };
    const step = nextStep(nextSession.record, nextSession.repeatCounts);
    const reply = await askDeterministic(step, nextSession);
    handleStep({ session: nextSession, reply, nextStep: step });
  }

  if (!current) {
    return (
      <main className="wizard">
        <p>Loading…</p>
      </main>
    );
  }

  const { session, nextStep: step } = current;

  // Every topic nextStep() has already walked past ("done") gets its
  // checkbox/enum widgets shown here too — nextStep() itself skips any
  // topic with zero unresolved text/date fields in a single pass (a
  // checkbox/enum-only topic never becomes its own conversational "topic"
  // step), so restricting this to just the current step's topic would
  // leave those topics' fields permanently unreachable. The "current"
  // topic's fields are included only when the step kind is actually
  // "topic" — during a pending repeat-decision, topicStatuses() points at
  // the next instance's topic, which isn't confirmed to exist yet.
  const visibleTopics = topicStatuses(session.record, session.repeatCounts)
    .filter((entry) => entry.status === "done" || (entry.status === "current" && step.kind === "topic"))
    .map((entry) => entry.topic);

  return (
    <div className="wizard-layout">
      <Sidebar session={session} />
      <main className="wizard">
        {visibleTopics.map((topic) => (
          <TopicFields
            key={topic.id}
            topic={topic}
            current={current}
            onChange={handleStep}
            disabled={isSubmitting}
          />
        ))}
        {(step.kind === "topic" || step.kind === "repeat-decision") && (
          <AskForm current={current} onSubmitted={handleStep} onPendingChange={setIsSubmitting} />
        )}
        {step.kind === "done" && (
          <div className="wizard__done">
            <p>{current.reply}</p>
            <PdfReview record={session.record} onEditTopic={(topic) => void handleEditTopic(topic)} disabled={isSubmitting} />
            <button type="button" onClick={() => void handleStartOver()}>
              Start over
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
