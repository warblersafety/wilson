// Renders the conversation history (Issue #44 AC: "the conversation
// transcript ... renders above the current ask"). wilson already
// accumulates every turn in TalkSession.transcript; v1 never rendered it.
// A chip-driven turn (source: "widget") gets a visually distinct
// treatment rather than plain prose — lucy's own Transcript does the
// same, so a tapped answer never reads as invented clinician speech.
import type { TalkTurn } from "@/lib/talk";

interface TranscriptProps {
  turns: TalkTurn[];
}

export function Transcript({ turns }: TranscriptProps) {
  if (turns.length === 0) return null;
  return (
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
  );
}
