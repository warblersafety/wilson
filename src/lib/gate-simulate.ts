// Runs a round-gate case through the real Talker loop with no browser
// (Issue #96). Two jobs, and the second is why it exists at all:
//
// 1. It is how a case's steps are kept aligned with the walk. A case is
//    an ordered list of what a clinician does, and the walk it drives
//    changes whenever the ask inventory does — so a case written against
//    last week's walk types a lot-number answer at the outcome question
//    and produces a run that looks fine. This runs in the ordinary test
//    job and fails when they diverge, seconds after the change rather
//    than during a gate run.
//
// 2. It is the browser driver's oracle. The driver captures what the
//    SURFACES show; this computes what the SESSION should be, from the
//    same case and the same machinery. AC-4's "the transcript matches the
//    session state" is that comparison.
//
// Every write goes through the same functions the UI's own handlers call
// — processTurn for a typed turn, applyActionToFields/setRepeatCount plus
// a recomputed step for a chip — so this is not a second implementation
// of the walk. What it deliberately does NOT model is the DOM: rendering,
// layout and the surfaces themselves are the browser driver's half, and a
// pure simulation claiming them would be the "green suite, rejected
// build" failure this round already had once.
import { applyActionToFields, dismissAcknowledgment, dismissableFieldIds, widgetTurnText } from "./chip-grammar";
import { askDeterministic } from "./ask";
import { createExtractFnFrom } from "./extract";
import { createScriptedProposeFn, type ExtractionScript } from "./scripted-extract";
import { initTalkSession, processTurn, startTalk, applyProposedActions, type TalkSession, type TalkStep } from "./talk";
import { nextStep, setRepeatCount } from "./topics";
import { repeatDecisionOptions } from "./chip-grammar";

// One step's outcome: what the clinician was looking at, what they did,
// and what the app said next.
export interface SimulatedStep {
  index: number;
  // The question on screen when this step was performed.
  ask: string;
  // The ask's contract id ("SP-4"), or the repeat group's name.
  askId: string;
  action: string;
  // The reply the app produced, prefix and question together.
  reply: string;
}

export interface SimulationResult {
  steps: SimulatedStep[];
  session: TalkSession;
  // Steps whose `expectAsk` did not appear in the question actually on
  // screen. Returned rather than thrown so a caller can report ALL of
  // them at once — a case that has drifted has usually drifted at
  // several steps, and fixing them one exception per run is miserable.
  mismatches: string[];
}

// The subset of a GateCase this module needs. Declared structurally
// rather than imported from fixtures/: src/lib never depends on
// fixtures/, and this keeps the simulator usable for any step list.
export interface SimulableStep {
  kind: "type" | "chip" | "start-over";
  expectAsk?: string;
  message?: string;
  label?: string;
}

function askIdOf(session: TalkSession): string {
  const step = nextStep(session.record, session.repeatCounts);
  if (step.kind === "topic") return step.ask.id;
  if (step.kind === "repeat-decision") return step.repeatGroup;
  return "done";
}

// The chip labels AskForm renders, mapped to the action they write. A
// repeat-decision chip ("Yes"/"No"/a count) is handled separately — it
// writes a count, not a field action.
const DISMISS_ACTIONS: Record<string, "mark_unknown" | "decline"> = {
  "I don't have that": "mark_unknown",
  "Rather not say": "decline",
};

export async function simulateCase(
  steps: SimulableStep[],
  script: ExtractionScript,
  seed: TalkSession = initTalkSession(),
): Promise<SimulationResult> {
  const extract = createExtractFnFrom(createScriptedProposeFn(script));
  let step: TalkStep = await startTalk(seed, { ask: askDeterministic });
  const out: SimulatedStep[] = [];
  const mismatches: string[] = [];

  for (const [index, cased] of steps.entries()) {
    if (cased.kind === "start-over") break; // the browser driver's half
    const ask = step.reply;
    const askId = askIdOf(step.session);
    if (cased.expectAsk !== undefined && !ask.includes(cased.expectAsk)) {
      mismatches.push(
        `step ${index} (${cased.kind} ${JSON.stringify(cased.message ?? cased.label)}) expected an ask containing ` +
          `${JSON.stringify(cased.expectAsk)} but the walk was at ${askId}: ${JSON.stringify(ask)}`,
      );
    }

    if (cased.kind === "type") {
      step = await processTurn(step.session, cased.message ?? "", { ask: askDeterministic, extract });
      out.push({ index, ask, askId, action: `type ${JSON.stringify(cased.message)}`, reply: step.reply });
      continue;
    }

    // A chip. Which kind depends on the step the walk is actually at —
    // the same thing that decides which component the UI renders.
    const current = nextStep(step.session.record, step.session.repeatCounts);
    if (current.kind === "repeat-decision") {
      // RepeatDecision.tsx's two-tap path: for a group with more than one
      // possible total, "Yes" alone is lossy (a bare yes used to write 2
      // and silently drop medications 3+, PR #46), so the UI shows count
      // chips and commits nothing until one is tapped. Modelled here for
      // the same reason the rest of this file exists — a simulation that
      // committed on "Yes" would make a three-medication case quietly run
      // as a two-medication one.
      const options = repeatDecisionOptions(current.afterInstance, current.repeatGroup);
      if (cased.label === "Yes" && options.needsCountFollowThrough) {
        out.push({ index, ask, askId, action: 'chip "Yes" (awaiting count)', reply: step.reply });
        continue;
      }
      const count = cased.label === "No" ? current.afterInstance : Number(cased.label === "Yes" ? current.afterInstance + 1 : cased.label);
      if (!Number.isFinite(count)) {
        mismatches.push(`step ${index}: ${JSON.stringify(cased.label)} is not a repeat answer at ${askId}`);
        break;
      }
      const next: TalkSession = {
        ...step.session,
        repeatCounts: setRepeatCount(step.session.repeatCounts, current.repeatGroup, count),
        transcript: [
          ...step.session.transcript,
          { role: "clinician", text: widgetTurnText(step.question, cased.label ?? ""), source: "widget" },
        ],
      };
      step = await recompute(next);
      out.push({ index, ask, askId, action: `chip ${JSON.stringify(cased.label)}`, reply: step.reply });
      continue;
    }

    const action = DISMISS_ACTIONS[cased.label ?? ""];
    if (action === undefined) {
      // Recorded and the run stopped, rather than thrown: a case that has
      // drifted has usually drifted at several steps, and the caller
      // reports them together. Stopping is still required — every step
      // after this one would be simulated against a walk position the
      // case no longer describes.
      mismatches.push(
        `step ${index} taps ${JSON.stringify(cased.label)} at ${askId}, a topic ask, which offers no such chip ` +
          `(the walk was at ${JSON.stringify(ask.slice(0, 60))})`,
      );
      break;
    }
    const fieldIds = dismissableFieldIds(current);
    const prefix = dismissAcknowledgment(current, action);
    const next: TalkSession = {
      ...step.session,
      record: applyActionToFields(step.session.record, fieldIds, { type: action }),
      transcript: [
        ...step.session.transcript,
        { role: "clinician", text: widgetTurnText(step.question, cased.label ?? ""), source: "widget" },
      ],
    };
    step = await recompute(next, prefix);
    out.push({ index, ask, askId, action: `chip ${JSON.stringify(cased.label)}`, reply: step.reply });
  }

  return { steps: out, session: step.session, mismatches };
}

// src/app/wizard/direct-step.ts's stepForSession, without the @/ import —
// src/lib must not depend on src/app (tsconfig.node.json typechecks lib
// with no DOM lib and no app paths). Kept to the same three lines rather
// than abstracted into a shared helper: the app's copy carries the
// appendReply contract this one does not need, and merging them would
// drag that whole comment into lib for no gain.
async function recompute(session: TalkSession, replyPrefix?: string): Promise<TalkStep> {
  const step = nextStep(session.record, session.repeatCounts);
  const question = await askDeterministic(step, session);
  const reply = replyPrefix ? `${replyPrefix} ${question}` : question;
  return {
    session: { ...session, transcript: [...session.transcript, { role: "talker", text: reply }] },
    reply,
    question,
    nextStep: step,
  };
}

// The record a case's narrative would leave behind after a Read-back
// confirm — the state Follow-ups actually starts from. Applied through
// talk.ts's own applyProposedActions, the one write path.
export function seedFromNarrative(
  narrative: string,
  actions: Parameters<typeof applyProposedActions>[1],
): TalkSession {
  const base = initTalkSession();
  return {
    ...base,
    record: applyProposedActions(base.record, actions),
    transcript: [{ role: "clinician", text: narrative }],
  };
}
