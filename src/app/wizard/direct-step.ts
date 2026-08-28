// A direct (non-conversational) session write: recompute nextStep() and
// its reply against an already-updated session — shared by Wizard's
// review-stage topic reopen (Issue #34) and mount-time reload hydration,
// RepeatDecision's chip writes (Issue #44), and AskForm's dismiss/
// correction-offer-accept chips (Issue #44; the original 4th caller,
// TopicFields.tsx's checkbox/enum widget writes, was deleted along with
// that file — checkbox/enum fields are ordinary conversational asks now,
// not a widget). All bypass talk.ts's processTurn()/respond() (which
// always appends a talker turn) for the same reason: none is a
// conversational exchange. Generalized from a record-only update (Issue
// #32/#34 never needed to change repeatCounts) to accept the whole next
// session, since Issue #44's repeat-decision writes change repeatCounts,
// not record.
//
// Two modes, chosen by the caller via `options.appendReply` (default
// false — no talker turn appended):
//
// - false (default): Wizard's reload-hydration (recomputing the CURRENT
//   step from a stored session on mount) and the review-stage reopen
//   both re-derive a step that's already either the visible "current
//   ask" a prior real turn already recorded, or a topic just sent back
//   to `unasked` (not a new answer) — appending here too would duplicate
//   that question on every reload/reopen, not just show it once.
// - true: appends the recomputed reply as its own talker turn to the
//   session this returns. A chip write (RepeatDecision's commit,
//   AskForm's dismiss/correction-offer-accept) already appends its OWN
//   clinician-side, answer-only turn (widgetTurnText, chip-grammar.ts) to
//   the session it passes in — but that turn answers the PREVIOUS
//   question, not the new one this call's nextStep() produces. Without
//   also appending the new question, it exists only in the returned
//   TalkStep.reply (shown in the widget above the composer), never in
//   session.transcript — so if the clinician's next action is a typed
//   answer (submitTurn appends only the clinician's own message, never
//   the question it answers), the transcript shows that answer with no
//   question above it (reviewer pass on PR #64). Before Issue #123, this
//   also had an accepted tradeoff — a SAME question instead answered by
//   another chip tap appeared twice, once bare (this turn's talker
//   turn) and once folded into that tap's own "question — answer" line;
//   #123 removed the question from a chip tap's own turn entirely, so
//   that tradeoff no longer applies — there is nothing left for the two
//   turns to duplicate.
import { askDeterministic } from "@/lib/ask";
import { nextStep } from "@/lib/topics";
import type { TalkSession, TalkStep } from "@/lib/talk";

export interface StepForSessionOptions {
  // See the file header above. Default false: no talker turn appended.
  appendReply?: boolean;
  // What the write this call follows just recorded — ask-copy.md rule 8's
  // dismiss acknowledgment (#110), composed by chip-grammar.ts's
  // dismissAcknowledgment(). Prepended to the recomputed question exactly
  // as talk.ts's respond() prepends the conversational path's sweep
  // prefix, so one tap produces one talker turn carrying both. The
  // alternative — a talker turn of its own — is the double-bubble class
  // unit #89 removed, and it would also make the tap's write and its
  // acknowledgment two separately-droppable things.
  replyPrefix?: string;
}

export async function stepForSession(
  session: TalkSession,
  options: StepForSessionOptions = {},
): Promise<TalkStep> {
  const step = nextStep(session.record, session.repeatCounts);
  const question = await askDeterministic(step, session);
  // Composed for every step kind, `done` included: the prefix is about a
  // write that already happened, so the last dismiss of a session must
  // not be the one nobody is told about. `question` is returned alongside
  // it — see TalkStep.question for why a chip tap needs the unprefixed
  // form.
  const reply = options.replyPrefix ? `${options.replyPrefix} ${question}` : question;
  const resultSession: TalkSession = options.appendReply
    ? { ...session, transcript: [...session.transcript, { role: "talker", text: reply }] }
    : session;
  return { session: resultSession, reply, question, nextStep: step };
}
