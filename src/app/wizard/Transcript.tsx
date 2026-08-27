"use client";

// Renders the conversation history (Issue #44 AC: "the conversation
// transcript ... renders above the current ask"). wilson already
// accumulates every turn in TalkSession.transcript; v1 never rendered it.
// A chip-driven turn (source: "widget") gets a visually distinct
// treatment rather than plain prose — lucy's own Transcript does the
// same, so a tapped answer never reads as invented clinician speech.
// `progress` (Issue #44 AC-1: "a topic-progress line from real agenda
// state") is computed by the caller (Wizard.tsx, via
// topics.ts's currentTopicProgress()) rather than here, since it needs
// the session's record/repeatCounts this component doesn't otherwise
// touch.
import { useEffect, useRef } from "react";
import type { TalkTurn } from "@/lib/talk";
import type { TopicProgress } from "@/lib/topics";

interface TranscriptProps {
  turns: TalkTurn[];
  progress?: TopicProgress | null;
}

export function Transcript({ turns, progress }: TranscriptProps) {
  const listRef = useRef<HTMLOListElement>(null);

  // .transcript is a fixed-height (280px), scrolling box (globals.css) —
  // it used to rest showing the OLDEST turns rather than the latest ones,
  // so a long conversation hid the very question the clinician was about
  // to answer behind a scrollbar (reviewer pass on PR #64). A direct
  // scrollTop assignment, not scrollIntoView({ behavior: "smooth" }): an
  // instant jump satisfies prefers-reduced-motion by construction (there
  // is no animation here to disable), rather than needing a matchMedia
  // branch to turn one off.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [turns.length]);

  if (turns.length === 0 && !progress) return null;
  return (
    <div className="transcript-panel">
      {progress && (
        <p className="transcript-panel__progress">
          {progress.topic.label} · topic {progress.index + 1} of {progress.total}
        </p>
      )}
      {turns.length > 0 && (
        <ol className="transcript" aria-label="Conversation so far" ref={listRef}>
          {turns.map((turn, i) => (
            <li
              key={i}
              className={`transcript__turn transcript__turn--${turn.role}${
                turn.source === "widget" ? " transcript__turn--widget" : ""
              }`}
            >
              <p>{turn.text}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
