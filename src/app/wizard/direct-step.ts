// A direct (non-conversational) record write: recompute nextStep() and its
// reply against a new record, with no transcript turn appended — shared by
// TopicFields' checkbox/enum writes (Issue #32) and Wizard's review-stage
// topic reopen (Issue #34). Both intentionally bypass talk.ts's
// processTurn()/respond() (which always appends a talker turn) for the
// same reason: neither is a conversational exchange.
import { askDeterministic } from "@/lib/ask";
import type { AgendaRecord } from "@/lib/agenda";
import { nextStep } from "@/lib/topics";
import type { TalkSession, TalkStep } from "@/lib/talk";

export async function stepForRecord(session: TalkSession, record: AgendaRecord): Promise<TalkStep> {
  const nextSession: TalkSession = { ...session, record };
  const step = nextStep(nextSession.record, nextSession.repeatCounts);
  const reply = await askDeterministic(step, nextSession);
  return { session: nextSession, reply, nextStep: step };
}
