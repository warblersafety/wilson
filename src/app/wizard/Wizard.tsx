"use client";

// The step-wizard UI (Issue #32) — replaces the placeholder homepage,
// driven entirely by the real nextStep()/TOPICS, not hardcoded per-topic.
import { useEffect, useState } from "react";
import { askDeterministic } from "@/lib/ask";
import { clearSession, loadSession, saveSession } from "@/lib/session-storage";
import { initTalkSession, startTalk, type TalkStep } from "@/lib/talk";
import { nextStep } from "@/lib/topics";
import { AskForm } from "./AskForm";
import { Sidebar } from "./Sidebar";
import { TopicFields } from "./TopicFields";

// No model call — askDeterministic never touches the network, so this is
// safe to run on both the initial mount and every reload.
async function freshStep(): Promise<TalkStep> {
  return startTalk(initTalkSession(), { ask: askDeterministic });
}

export function Wizard() {
  const [current, setCurrent] = useState<TalkStep | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      const stored = loadSession(window.localStorage);
      let step: TalkStep;
      if (stored) {
        const next = nextStep(stored.record, stored.repeatCounts);
        step = { session: stored, nextStep: next, reply: await askDeterministic(next, stored) };
      } else {
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

  if (!current) {
    return (
      <main className="wizard">
        <p>Loading…</p>
      </main>
    );
  }

  const { session, nextStep: step } = current;

  return (
    <div className="wizard-layout">
      <Sidebar session={session} />
      <main className="wizard">
        {step.kind === "topic" && (
          <>
            <TopicFields topic={step.topic} current={current} onChange={handleStep} />
            <AskForm current={current} onSubmitted={handleStep} />
          </>
        )}
        {step.kind === "repeat-decision" && <AskForm current={current} onSubmitted={handleStep} />}
        {step.kind === "done" && (
          <div className="wizard__done">
            <p>{current.reply}</p>
            <button type="button" onClick={() => void handleStartOver()}>
              Start over
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
