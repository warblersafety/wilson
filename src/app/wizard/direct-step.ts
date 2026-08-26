// A direct (non-conversational) session write: recompute nextStep() and
// its reply against an already-updated session, with no talker turn
// appended by this function itself — shared by Wizard's review-stage
// topic reopen (Issue #34), RepeatDecision's chip writes (Issue #44),
// and AskForm's dismiss/correction-offer-accept chips (Issue #44; the
// original 4th caller, TopicFields.tsx's checkbox/enum widget writes,
// was deleted along with that file — checkbox/enum fields are ordinary
// conversational asks now, not a widget). All bypass talk.ts's
// processTurn()/respond() (which always appends a talker turn) for the
// same reason: none is a conversational exchange. Generalized from a
// record-only update (Issue #32/#34 never needed to change repeatCounts)
// to accept the whole next session, since Issue #44's repeat-decision
// writes change repeatCounts, not record. A caller that wants its own
// write recorded in the visible transcript (Issue #44: chip taps append
// a "question — answer" turn) builds that into the session it passes in
// — this function's own contract of "no turn appended" is unchanged,
// just broadened to whichever fields the caller updated.
import { askDeterministic } from "@/lib/ask";
import { nextStep } from "@/lib/topics";
import type { TalkSession, TalkStep } from "@/lib/talk";

export async function stepForSession(session: TalkSession): Promise<TalkStep> {
  const step = nextStep(session.record, session.repeatCounts);
  const reply = await askDeterministic(step, session);
  return { session, reply, nextStep: step };
}
