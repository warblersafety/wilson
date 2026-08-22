// Per docs/design.md's Architecture table: the Talker converses, guides
// one topic at a time, and never writes the record itself. src/lib/agenda.ts
// owns "write the record" (applyAction); src/lib/topics.ts's nextStep()
// owns "what's next" — this module is the caller that turns a
// clinician's message into Agenda writes and a reply, working topic by
// topic (bundled fields per turn) rather than field by field, per the
// 2026-08-22 design conversation (Issue #18).
//
// Extraction (turning raw text into proposed field actions) and phrasing
// (turning a NextStep into a plain-language message) are both injected as
// typed function parameters ("ports") rather than implemented here. Real
// implementations — a real Extractor, real model-backed phrasing — are
// later units' jobs; this module ships the control-flow loop and the
// contracts, tested against fakes. Both ports are async: design.md commits
// their eventual real implementations to server-side model calls, which
// are inherently async — typing them synchronous now would force a
// breaking signature change (and a rework of every caller) the moment
// either lands, for no benefit today.
import { type AgendaRecord, applyAction, initAgenda } from "./agenda";
import type { FieldAction } from "./field-state";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import {
  TOPICS,
  initRepeatCounts,
  nextStep,
  type NextStep,
  type RepeatCounts,
  type Topic,
} from "./topics";

export type TalkRole = "clinician" | "talker";

export interface TalkTurn {
  role: TalkRole;
  text: string;
}

export interface TalkSession {
  transcript: TalkTurn[];
  record: AgendaRecord;
  repeatCounts: RepeatCounts;
}

export function initTalkSession(): TalkSession {
  return { transcript: [], record: initAgenda(), repeatCounts: initRepeatCounts() };
}

// `value` is only meaningful — and only accepted — for "answer", mirroring
// applyAction()'s own contract, which silently discards a value passed
// alongside any other action. A discriminated union turns an extract
// implementation that tries to attach e.g. a decline reason to `value`
// into a compile error instead of a silent runtime drop. `type` sits at
// the top level (not nested under `action`) because TypeScript's
// control-flow narrowing doesn't reliably narrow a union discriminated by
// a nested property.
export type ProposedAction =
  | { fieldId: string; type: "answer"; value: string }
  | { fieldId: string; type: Exclude<FieldAction["type"], "answer"> };

export type ExtractFn = (session: TalkSession, message: string) => Promise<ProposedAction[]>;

// Receives the whole session (transcript + record + repeatCounts), not
// just the fields being asked about — matching ExtractFn's shape, and
// avoiding a second breaking signature change once a real, transcript-
// aware phraser lands (e.g. one that phrases a re-ask differently from a
// first ask). `step` carries what's actually being asked: a topic's still-
// unresolved fields, a repeat-group "is there another?" decision, or done.
export type AskFn = (step: NextStep, session: TalkSession) => Promise<string>;

export interface TalkStep {
  session: TalkSession;
  reply: string;
  nextStep: NextStep;
}

interface Deps {
  ask: AskFn;
  topics?: Topic[];
  fields?: FormFieldSpec[];
}

// The shared tail of both startTalk() and processTurn(): given the state
// as it stands *after* any writes this turn, decide what's next and ask
// about it. Taking only the post-write state (never the pre-turn
// session) is what makes "ask always sees this turn's writes" a
// structural guarantee, not just something the current code happens to
// get right — there is no stale record variable in scope here to reach
// for by mistake.
async function respond(
  next: { record: AgendaRecord; transcript: TalkTurn[]; repeatCounts: RepeatCounts },
  deps: Deps,
): Promise<TalkStep> {
  const step = nextStep(next.record, next.repeatCounts, deps.topics ?? TOPICS, deps.fields ?? FORM_3500_FIELDS);
  const reply = await deps.ask(step, next);
  return {
    session: { ...next, transcript: [...next.transcript, { role: "talker", text: reply }] },
    reply,
    nextStep: step,
  };
}

export async function startTalk(session: TalkSession, deps: Deps): Promise<TalkStep> {
  return respond(session, deps);
}

export async function processTurn(
  session: TalkSession,
  message: string,
  deps: Deps & { extract: ExtractFn },
): Promise<TalkStep> {
  const proposals = await deps.extract(session, message);
  // applyAction() is pure — it never mutates its input and throws before
  // returning anything on an invalid proposal — so a reduce that throws
  // partway through never lets a partially-applied record escape this
  // function. No separate atomicity handling needed.
  //
  // A proposal against an already-resolved field (e.g. a clinician
  // volunteering "actually, make that 45") is intentionally applied
  // directly via "answer" with no `reopen` step required — `reopen` is
  // specifically the review-stage re-entry path (see field-state.ts),
  // for a UI-driven edit after the clinician has already seen the
  // generated PDF, not for an in-conversation correction. Grounding
  // whether a proposal is actually correct is the Extractor's job
  // (design.md), not this orchestrator's — it trusts what `extract`
  // returns, same as it trusts `applyAction`'s existing validation.
  const record = proposals.reduce((rec, proposal) => {
    if (proposal.type === "answer") {
      return applyAction(rec, proposal.fieldId, { type: "answer" }, proposal.value);
    }
    return applyAction(rec, proposal.fieldId, { type: proposal.type });
  }, session.record);
  return respond(
    {
      record,
      transcript: [...session.transcript, { role: "clinician", text: message }],
      repeatCounts: session.repeatCounts,
    },
    deps,
  );
}
