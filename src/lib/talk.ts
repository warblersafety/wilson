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
import type { CorrectionOffer, FieldCollision } from "./followup-sweep";
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
}

export function initTalkSession(): TalkSession {
  return { transcript: [], record: initAgenda(), repeatCounts: initRepeatCounts(), volunteeredRepeats: {} };
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
  // Issue #124: one-tap-per-value data for the UI (AskForm.tsx renders a
  // chip per colliding value, the way Read-back already offers one choice
  // per candidate) — the pending-state channel a collision never had
  // before this unit; classifyFollowUpActions() writes neither candidate,
  // and until now nothing carried the values forward for a clinician to
  // choose between. Ephemeral to this turn, same contract as
  // correctionOffers above — see TalkStep below. Non-empty here is also
  // what tells respond() (below) to suppress the ask's own next question
  // rather than concatenate it after replyPrefix's collision sentence —
  // see respond()'s own comment for why.
  collisions?: FieldCollision[];
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
  // Issue #124: this turn's pending field collisions, one entry per
  // colliding field, each carrying one tappable choice per candidate
  // value (FieldCollision.actions). Same ephemeral contract as
  // correctionOffers just above, for the same reason: not part of
  // TalkSession, never persisted, nothing to reconcile if ignored — the
  // field stays exactly as untouched as it is today (classifyFollowUpActions
  // writes neither candidate), and a reload simply loses the two chips,
  // never any data. A clinician who repeats the same contradiction gets
  // the same collision fresh from the next sweep.
  collisions?: FieldCollision[];
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
//
// `pendingCollision` (Issue #124): true exactly when this turn's sweep
// produced one or more field collisions (processTurn() below passes
// `(result.collisions?.length ?? 0) > 0`). Rule 9's re-ask frame
// (ask.ts's reAskFrame(), reached through deps.ask() below) says "Got
// it" over exactly the facts still open on the CURRENT ask — and a
// colliding field is exactly that: still open, nothing was written for
// it. Concatenating the two ("<collision line> Got it. Still need:
// <the same field again>") states the field is simultaneously an open
// question and an acknowledged one, in the same bubble. So while a
// collision is pending, the ask's own next question is suppressed
// rather than concatenated — `replyPrefix` (which describeFollowUpSweep()
// already ends with the collision's own line, ask-copy.md rule 8) is
// shown alone, and `question` becomes that same shown text rather than
// the unseen, deferred ask()'s own phrasing, so a widget tap that quotes
// TalkStep.question (AskForm.tsx's dismiss chips) never quotes text the
// clinician was never shown. The suppressed question is not lost, only
// deferred: nextStep() is still computed against the real, unwritten
// record, so the very next turn — whether the collision is accepted or
// the ask is dismissed some other way — recomputes it fresh, exactly as
// stepForSession() already does after a correction-offer accept
// (direct-step.ts, #109/#110).
//
// Gated on `step.kind === "topic"` (reviewer pass on PR #142, finding
// 1 — BLOCKING, fixed here): `collisions` has exactly one consumer,
// AskForm.tsx, which renders a chip per colliding value only on a
// topic step. A repeat-decision or `done` step has no chip to replace
// the erased question with, and unconditional suppression erased it
// from every place it would otherwise live: `reply` (what's shown on
// screen above RepeatDecision's Yes/No chips) AND the transcript's own
// talker turn (`respond()` always records `reply` there, below) — a
// "No" tap would sit under a bare collision sentence with nothing on
// screen and nothing in the transcript connecting it to "was there
// another suspect product?" at all. (Before Issue #123 this also broke
// a second way — RepeatDecision.tsx used to quote `question` into the
// clinician's own tap turn too, so a wrong `question` value reached a
// clinician-role transcript entry directly; #123 removed that specific
// mechanism by making a chip tap's turn answer-only, but the erased-
// reply/no-visible-question problem this gate fixes is independent of
// it and survives untouched.) Narrowing the gate, rather than widening
// chip rendering to other step kinds, is the deliberate choice: the
// latter wants design. The accepted consequence is that on a non-topic
// step a pending collision goes back to being concatenated with the
// ask's own next question — the PRE-#124 behavior, unresolvable by any
// chip there — restored on purpose rather than left erased. Filed as
// the follow-up: warblersafety/wilson#151.
async function respond(
  next: TalkSession,
  deps: Deps,
  replyPrefix?: string,
  pendingCollision?: boolean,
): Promise<TalkStep> {
  const step = nextStep(next.record, next.repeatCounts, deps.topics ?? TOPICS, deps.fields ?? FORM_3500_FIELDS);
  const question = await deps.ask(step, next);
  const suppressQuestion = pendingCollision && step.kind === "topic";
  const reply = suppressQuestion ? (replyPrefix ?? question) : replyPrefix ? `${replyPrefix} ${question}` : question;
  return {
    session: { ...next, transcript: [...next.transcript, { role: "talker", text: reply }] },
    reply,
    question: suppressQuestion ? reply : question,
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
    },
    deps,
    result.replyPrefix,
    (result.collisions?.length ?? 0) > 0,
  );
  return { ...step, correctionOffers: result.correctionOffers, collisions: result.collisions };
}
