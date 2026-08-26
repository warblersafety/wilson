"use client";

// Repeat-decision chips (Issue #44) — design.md Follow-ups: yes/no only,
// never an uncertainty chip (warblersafety/wilson#47 is the separate,
// non-blocking machinery gap for representing genuine uncertainty). A
// multi-slot group's "yes" reveals a deterministic "how many in total?"
// count follow-through rather than writing a lossy guess. Writes
// setRepeatCount directly — no free-text detour — and, like every other
// chip write in this unit, appends a "question — answer" transcript turn
// so the visible history has no gaps. stepForSession's appendReply: true
// then also appends the recomputed NEXT question as its own talker turn
// (direct-step.ts's file header) — otherwise a typed answer to that next
// question would show up with nothing above it in the transcript.
import { useState } from "react";
import { Chip } from "@/components/Chip";
import { friendlyFailureMessage, repeatDecisionOptions, widgetTurnText } from "@/lib/chip-grammar";
import { setRepeatCount, type RepeatGroup } from "@/lib/topics";
import type { TalkSession, TalkStep } from "@/lib/talk";
import { stepForSession } from "./direct-step";

interface RepeatDecisionProps {
  session: TalkSession;
  repeatGroup: RepeatGroup;
  afterInstance: number;
  reply: string;
  onChange: (next: TalkStep) => void;
  disabled?: boolean;
}

export function RepeatDecision({
  session,
  repeatGroup,
  afterInstance,
  reply,
  onChange,
  disabled = false,
}: RepeatDecisionProps) {
  const [awaitingCount, setAwaitingCount] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = repeatDecisionOptions(afterInstance, repeatGroup);

  async function commit(count: number, answerLabel: string) {
    try {
      const nextSession: TalkSession = {
        ...session,
        repeatCounts: setRepeatCount(session.repeatCounts, repeatGroup, count),
        transcript: [
          ...session.transcript,
          { role: "clinician", text: widgetTurnText(reply, answerLabel), source: "widget" },
        ],
      };
      setError(null);
      onChange(await stepForSession(nextSession, { appendReply: true }));
    } catch (err) {
      setError(friendlyFailureMessage(err instanceof Error ? err.message : "unknown"));
    }
  }

  function handleYes() {
    if (options.needsCountFollowThrough) {
      setAwaitingCount(true);
      return;
    }
    void commit(afterInstance + 1, "Yes");
  }

  return (
    <div className="repeat-decision">
      <p className="repeat-decision__reply">{reply}</p>
      {!awaitingCount ? (
        <div className="repeat-decision__chips">
          <Chip label="Yes" onClick={handleYes} disabled={disabled} />
          <Chip label="No" onClick={() => void commit(afterInstance, "No")} disabled={disabled} />
        </div>
      ) : (
        <div className="repeat-decision__chips">
          <p className="repeat-decision__prompt">How many in total?</p>
          {options.countChoices.map((count) => (
            <Chip
              key={count}
              label={String(count)}
              onClick={() => void commit(count, `Yes, ${count} in total`)}
              disabled={disabled}
            />
          ))}
        </div>
      )}
      {error && (
        <p className="repeat-decision__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
