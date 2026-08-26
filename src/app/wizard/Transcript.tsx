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
import type { TalkTurn } from "@/lib/talk";
import type { TopicProgress } from "@/lib/topics";

interface TranscriptProps {
  turns: TalkTurn[];
  progress?: TopicProgress | null;
}

export function Transcript({ turns, progress }: TranscriptProps) {
  if (turns.length === 0 && !progress) return null;
  return (
    <div className="transcript-panel">
      {progress && (
        <p className="transcript-panel__progress">
          {progress.topic.label} · topic {progress.index + 1} of {progress.total}
        </p>
      )}
      {turns.length > 0 && (
        <ol className="transcript" aria-label="Conversation so far">
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
