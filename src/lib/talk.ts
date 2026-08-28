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
import type { CorrectionOffer } from "./followup-sweep";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import {
  TOPICS,
  initRepeatCounts,
  nextStep,
  setRepeatCount,
  type NextStep,
  type RepeatCounts,
  type RepeatGroup,
  type Topic,
} from "./topics";

export type TalkRole = "clinician" | "talker";

export interface TalkTurn {
  role: TalkRole;
  text: string;
  // Present only for a chip-driven write (Issue #44: repeat-decision or
  // checkbox/enum widget tap, "I don't have that"/"rather not say"),
  // never for a typed/spoken turn. Lets Transcript.tsx render a tapped
  // answer distinctly rather than as invented clinician prose — lucy's
  // own Transcript.tsx does the same for the identical reason ("a
  // machine-composed line reading as patient speech"). Optional and
  // additive: every existing session predates this field and is still a
  // valid TalkSession with it absent.
  source?: "widget";
}

export interface TalkSession {
  transcript: TalkTurn[];
  record: AgendaRecord;
  repeatCounts: RepeatCounts;
  // Issue #44's widened follow-up sweep (design.md "Follow-up turns are
  // mined for everything still open"): which repeat groups the sweep has
  // seen a later-instance field volunteered for (e.g. a second suspect
  // product's name mentioned before its "was there another?" decision is
  // reached) — never written as a field or a count itself, only surfaced
  // as a hint on that group's own repeat-decision ask (askDeterministic
  // reads this; see src/lib/ask.ts). Optional and additive, same
  // convention as TalkTurn.source above: every session that predates
  // this field is still a valid TalkSession with it absent.
  volunteeredRepeats?: Partial<Record<RepeatGroup, true>>;
  // ask-copy.md rule 9's first-voicing amendment (#125): which authored
  // asks (by AuthoredAsk.id) have had their copy rendered at least once
  // this report. Read by askDeterministic (src/lib/ask.ts) to choose
  // between the primary/arrival copy and the ordinary re-ask frame for a
  // partially-resolved ask, and written by voiceStep() below — never
  // read or written any other way, so the two stay in agreement. "Voiced
  // this report": intake state, cleared with the rest by "Start over"
  // (C6's boundary) because that path always constructs a fresh session
  // through initTalkSession(), never by editing this map in place.
  // Optional and additive, same convention as volunteeredRepeats above.
  voicedAsks?: Partial<Record<string, true>>;
}

export function initTalkSession(): TalkSession {
  return {
    transcript: [],
    record: initAgenda(),
    repeatCounts: initRepeatCounts(),
    volunteeredRepeats: {},
    voicedAsks: {},
  };
}

// Marks the ask a just-computed NextStep voices as voiced for the rest
// of this report (ask-copy.md rule 9, #125: "the arrival frame counts as
// the ask's voicing"). Called from respond() below and from
// stepForSession() (src/app/wizard/direct-step.ts) — every place that
// computes a step's copy for display — so a later partial state of the
// SAME ask, reached after this one (a further answer that still leaves
// it open, or a re-derivation once more of it is on the record), renders
// rule 9's ordinary re-ask frame instead of a second arrival frame.
// A no-op for a repeat-decision or done step (neither is an ask) and for
// an ask already marked, so callers can apply it unconditionally rather
// than each re-deriving step.kind === "topic" first.
export function voiceStep(session: TalkSession, step: NextStep): TalkSession {
  if (step.kind !== "topic") return session;
  if (session.voicedAsks?.[step.ask.id] === true) return session;
  return { ...session, voicedAsks: { ...session.voicedAsks, [step.ask.id]: true } };
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

// A resolved (answered/unknown/declined) field the widened follow-up sweep
// found new evidence for, but did NOT write (Issue #44, design.md:
// "answered, unknown, and declined are clinician-established states the
// sweep never writes... a proposal targeting one becomes a correction
// offer"). `action` is what accepting the offer writes, through the exact
// same applyProposedActions() path any other answer takes.
// `currentState`/`currentValue` describe what's recorded right now, for
// phrasing "it's recorded as Y" (or "it's marked unknown"/"declined" when
// there's no value to quote). Lives in src/lib/followup-sweep.ts, the
// module that actually produces one — imported here in type-only form (no
// runtime dependency on that module; extract.ts is the one caller that
// needs its actual functions) purely so ExtractResult/TalkStep below can
// reference the shape. A caller building UI around a CorrectionOffer
// (AskForm.tsx) imports the type directly from followup-sweep.ts.

// `actions` is field-level, matching ProposedAction's own {fieldId, type}
// shape — every entry here is a field the sweep decided TO write (an
// in-ask answer, or an out-of-ask `unasked` field named in the reply);
// never a correction offer or a collision, which are surfaced separately
// below and never silently applied. `repeatDecision` is separate, not
// folded into `actions`, because a repeat-group decision isn't about any
// field — topics.ts's RepeatCounts is deliberately kept outside
// AgendaRecord (Issue #18), so there's no fieldId for it to attach to.
// Optional: most turns answer field-level questions, not the "is there
// another one?" question.
export interface ExtractResult {
  actions: ProposedAction[];
  repeatDecision?: { repeatGroup: RepeatGroup; count: number };
  // Issue #44: acknowledgment/correction-offer/collision text the widened
  // sweep produced this turn (src/lib/followup-sweep.ts's
  // describeFollowUpSweep()) — prepended to the next question by
  // processTurn() below, so a clinician always sees what an out-of-ask
  // write or a declined correction did, never a silent one.
  replyPrefix?: string;
  // Issue #44: one-tap "replace it?" data for the UI (AskForm.tsx renders
  // a chip per offer). Ephemeral to this turn — see TalkStep below.
  correctionOffers?: CorrectionOffer[];
  // Issue #44: repeat groups a later-instance field was volunteered for
  // this turn — merged into TalkSession.volunteeredRepeats by
  // processTurn(), never into `actions` (no field or count is written).
  volunteeredRepeatGroups?: RepeatGroup[];
}

export type ExtractFn = (session: TalkSession, message: string) => Promise<ExtractResult>;

// The one write path from a validated proposal to the record — applyAction()
// is pure and throws before returning anything on an invalid proposal, so a
// reduce that throws partway through never lets a partially-applied record
// escape this function. Shared by processTurn() below, the one-tap
// correction-offer accept path (AskForm.tsx applies a single CorrectionOffer's
// `action` through this exact function) and, for the narrative-extraction
// pass (Issue #41), the confirmed-batch apply step design.md calls for — one
// write path, not several, per its own Architecture table ("Assembly/
// Export... Deterministic mapping").
export function applyProposedActions(record: AgendaRecord, actions: ProposedAction[]): AgendaRecord {
  return actions.reduce((rec, proposal) => {
    if (proposal.type === "answer") {
      return applyAction(rec, proposal.fieldId, { type: "answer" }, proposal.value);
    }
    return applyAction(rec, proposal.fieldId, { type: proposal.type });
  }, record);
}

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
  // The ask alone, without whatever acknowledgment `reply` may have been
  // composed with (the sweep's prefix, a dismiss tap's rule-8 line). The
  // transcript's talker turn carries the full `reply`. Added (reviewer
  // pass, #109/#110) so a chip tap's own "question — answer" clinician
  // turn could quote the bare question rather than `reply` — folding a
  // talker's acknowledgment into a `role: "clinician"` turn attributes a
  // machine-composed statement to the clinician, which this field existed
  // to prevent; before it, two dismiss taps in a row produced "Marked age
  // and sex as not on hand. What's the patient's weight…? — I don't have
  // that" as something the clinician said. Issue #123 then removed the
  // question from a chip tap's turn entirely (both bubbles are already on
  // screen at once, so quoting either form only made the clinician's turn
  // read as a recitation) — chip-grammar.ts's widgetTurnText() no longer
  // consumes this field, though nothing else claimed it either, so it is
  // left defined rather than removed as part of that unit (warblersafety/
  // wilson, follow-up filed). Equal to `reply` whenever there is no
  // prefix, which is most turns.
  question: string;
  nextStep: NextStep;
  // Issue #44: one-tap "replace it?" correction offers surfaced by THIS
  // turn's widened sweep. Deliberately NOT part of TalkSession — never
  // persisted to localStorage (session-storage.ts) — so there is nothing
  // to reconcile if a clinician ignores one: design.md's "ignoring
  // changes nothing" is true by construction, not by cleanup code. A
  // clinician who reloads mid-session simply loses the convenience nudge,
  // never any data — the field an offer would have touched is untouched
  // either way, and the very next sweep re-proposes the same correction
  // fresh if the clinician repeats it.
  correctionOffers?: CorrectionOffer[];
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
// for by mistake. `replyPrefix` (Issue #44) is prepended to the ask's own
// question — startTalk() never passes one (nothing has been extracted
// yet), processTurn() below passes whatever describeFollowUpSweep()
// produced, so the transcript's talker turn always carries the FULL
// reply (prefix and question together), never just the question with the
// sweep's acknowledgment silently dropped.
async function respond(
  next: TalkSession,
  deps: Deps,
  replyPrefix?: string,
): Promise<TalkStep> {
  const step = nextStep(next.record, next.repeatCounts, deps.topics ?? TOPICS, deps.fields ?? FORM_3500_FIELDS);
  // deps.ask() reads `next`'s voicedAsks as it stood BEFORE this step —
  // voiceStep() below only updates the session this function returns, so
  // an ask's own first computation always sees itself as not-yet-voiced.
  const question = await deps.ask(step, next);
  const reply = replyPrefix ? `${replyPrefix} ${question}` : question;
  const voiced = voiceStep(next, step);
  return {
    session: { ...voiced, transcript: [...voiced.transcript, { role: "talker", text: reply }] },
    reply,
    question,
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
  const result = await deps.extract(session, message);
  // Every entry in `result.actions` is already a decision the widened
  // sweep (src/lib/followup-sweep.ts) made about a currently `unasked`
  // field — an in-ask answer, or an out-of-ask write named in
  // result.replyPrefix. This REPLACES the direct-apply-on-resolved
  // behavior this comment used to document (a proposal against an
  // ALREADY-resolved field silently overwriting it, e.g. "actually, make
  // that 45" just applying via "answer" with no confirmation): design.md's
  // 2026-08-25 widening closed that silent path — a candidate targeting
  // an answered/unknown/declined field never reaches `actions` at all, it
  // becomes a `result.correctionOffers` entry instead, written only on an
  // explicit one-tap accept (through this exact function, so there is
  // still only one write path). `reopen` remains the review-stage
  // re-entry path (field-state.ts) for a UI-driven edit after the
  // clinician has seen the generated PDF — a different case from an
  // in-conversation correction, which is what the offer mechanism is for.
  const record = applyProposedActions(session.record, result.actions);
  // setRepeatCount() throws on an out-of-range count, same as applyAction()
  // throws on an invalid field action — an invalid repeatDecision fails the
  // whole turn rather than writing a bad count, matching the "never
  // partially applied" guarantee above.
  const repeatCounts = result.repeatDecision
    ? setRepeatCount(
        session.repeatCounts,
        result.repeatDecision.repeatGroup,
        result.repeatDecision.count,
        deps.topics ?? TOPICS,
      )
    : session.repeatCounts;
  // Issue #44: a later-instance field volunteered this turn is recorded
  // as a hint for that group's own repeat-decision ask (ask.ts reads
  // this) — never merged into repeatCounts or any field write.
  const volunteeredRepeats = result.volunteeredRepeatGroups?.length
    ? {
        ...session.volunteeredRepeats,
        ...Object.fromEntries(result.volunteeredRepeatGroups.map((group) => [group, true as const])),
      }
    : session.volunteeredRepeats;
  const step = await respond(
    {
      record,
      transcript: [...session.transcript, { role: "clinician", text: message }],
      repeatCounts,
      volunteeredRepeats,
      // Carried forward unchanged — respond() below is what advances it
      // (voiceStep(), for whatever step THIS call computes next). Built
      // as a new object literal rather than `{ ...session, record, ... }`
      // deliberately (pre-dates #125), which is exactly why this field
      // was silently dropped here until now: every processTurn() call
      // reset voicedAsks to undefined, so a re-ask frame anywhere past
      // the FIRST typed turn of a session always read "never voiced" —
      // making the whole session behave as if `respond()` had marked
      // nothing, ever.
      voicedAsks: session.voicedAsks,
    },
    deps,
    result.replyPrefix,
  );
  return { ...step, correctionOffers: result.correctionOffers };
}
