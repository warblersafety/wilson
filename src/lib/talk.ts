// Per docs/design.md's Architecture table: the Talker converses, guides
// one topic at a time, and never writes the record itself. src/lib/agenda.ts
// already owns "what's next" (nextField) and "write the record"
// (applyAction) — this module is the caller that turns a clinician's
// message into Agenda writes and a reply.
//
// Extraction (turning raw text into proposed field actions) and phrasing
// (turning a field into a plain-language question) are both injected as
// typed function parameters ("ports") rather than implemented here. Real
// implementations — a real Extractor, real model-backed phrasing — are
// later units' jobs; this module ships the control-flow loop and the
// contracts, tested against fakes.
import { type AgendaRecord, applyAction, initAgenda, nextField } from "./agenda";
import type { FieldAction } from "./field-state";
import type { FormFieldSpec } from "./form-3500-fields";

export type TalkRole = "clinician" | "talker";

export interface TalkTurn {
  role: TalkRole;
  text: string;
}

export interface TalkSession {
  transcript: TalkTurn[];
  record: AgendaRecord;
}

export function initTalkSession(): TalkSession {
  return { transcript: [], record: initAgenda() };
}

export interface ProposedAction {
  fieldId: string;
  action: FieldAction;
  value?: string;
}

export type ExtractFn = (session: TalkSession, message: string) => ProposedAction[];

export type AskFn = (field: FormFieldSpec | null, record: AgendaRecord) => string;

export interface TalkStep {
  session: TalkSession;
  reply: string;
  done: boolean;
}

export function startTalk(session: TalkSession, deps: { ask: AskFn }): TalkStep {
  const field = nextField(session.record);
  const reply = deps.ask(field, session.record);
  return {
    session: {
      record: session.record,
      transcript: [...session.transcript, { role: "talker", text: reply }],
    },
    reply,
    done: field === null,
  };
}

export function processTurn(
  session: TalkSession,
  message: string,
  deps: { extract: ExtractFn; ask: AskFn },
): TalkStep {
  const proposals = deps.extract(session, message);
  // applyAction() is pure — it never mutates its input and throws before
  // returning anything on an invalid proposal — so a reduce that throws
  // partway through never lets a partially-applied record escape this
  // function. No separate atomicity handling needed.
  const record = proposals.reduce(
    (rec, proposal) => applyAction(rec, proposal.fieldId, proposal.action, proposal.value),
    session.record,
  );
  const field = nextField(record);
  const reply = deps.ask(field, record);
  return {
    session: {
      record,
      transcript: [
        ...session.transcript,
        { role: "clinician", text: message },
        { role: "talker", text: reply },
      ],
    },
    reply,
    done: field === null,
  };
}
