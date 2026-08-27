// Which transcript turns the Follow-ups surface actually renders (Issue
// #89). Pure, display-only: it decides nothing about what the session
// stores.
//
// The bug it exists to fix: talk.ts's respond() appends every composed
// reply to session.transcript, so once a turn lands, the current ask is
// BOTH the transcript's trailing talker turn (rendered by Transcript.tsx)
// and TalkStep.reply (rendered again by AskForm/RepeatDecision as the
// accent current-ask bubble). Steve's 2026-08-26 staging screenshot shows
// the identical paragraph back-to-back in gray and teal on every turn;
// mockup screen-04 shows it exactly once.
//
// The fix is at the render layer on purpose. The appended turn has to
// stay in the session: the extractor's rendered context is built from the
// transcript, and reload hydration re-derives the current step from a
// stored session whose last talker turn IS that ask (direct-step.ts's
// no-append contract depends on it being there). So the session shape is
// untouched and only the view drops the duplicate — which also means the
// same rule covers hydration for free, since a hydrated session's
// trailing turn matches the recomputed reply exactly.
import type { NextStep } from "@/lib/topics";
import type { TalkStep, TalkTurn } from "@/lib/talk";

// The step kinds whose surface renders TalkStep.reply itself: "topic" →
// AskForm's .ask-form__reply, "repeat-decision" → RepeatDecision's
// .repeat-decision__reply. "done" is deliberately absent — Wizard renders
// no ask there at all, so the trailing turn is the only copy of that
// reply on screen and dropping it would blank the transcript's last line
// during the tick before Review takes over.
const KINDS_RENDERING_THE_ASK: NextStep["kind"][] = ["topic", "repeat-decision"];

// Returns the turns to render above the current ask. Same array
// reference when nothing is dropped, so an unchanged transcript stays
// referentially stable for Transcript's scroll effect.
export function visibleTranscriptTurns(step: TalkStep): TalkTurn[] {
  if (!KINDS_RENDERING_THE_ASK.includes(step.nextStep.kind)) return step.session.transcript;
  const turns = step.session.transcript;
  const last = turns[turns.length - 1];
  // Text equality, not an index or a flag on the turn: the duplicate is
  // whatever the surface is about to render, and a stored session carries
  // no marker saying which of its turns is "current" — the recomputed
  // reply matching the trailing talker turn is exactly what "this turn is
  // the current ask" means on both the live and the hydrated path.
  if (!last || last.role !== "talker" || last.text !== step.reply) return turns;
  return turns.slice(0, -1);
}
