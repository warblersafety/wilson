// The fake model the round-gate case driver runs against (Issue #96,
// docs/round-gate.md "How it runs": "Fake-model locally: copy, layout,
// and screen fidelity are model-independent; flow and length are NOT").
//
// **What this is not.** It is not a second extractor. It substitutes for
// exactly one thing — the model call — through extract.ts's ProposeFn and
// narrative-extract.ts's NarrativeProposeFn seams. Everything a candidate
// meets after that is the shipped code: quote grounding against the
// clinician's own turn, the current-turn citation pool, the legal-option
// check, the lab-row gate, collision/correction classification, rule 3's
// derives, and the sweep's reply composition. A scripted candidate whose
// quote is not really in the clinician's message is REJECTED here exactly
// as a hallucinating model's would be, which is what makes a gate case
// evidence about this build rather than about the script.
//
// **A script names quote TEXT, never a turn index.** The index a
// candidate must cite is whatever position the clinician's message
// occupies in this session's transcript — a number no static fixture can
// know, and the very thing design.md's citation-pool rule is about. So
// the script says what text grounds the claim and this module stamps the
// current turn, exactly as the real prompt instructs the model to. A
// script that could choose its own index could cite the opening
// narrative and walk straight through the check that exists to stop that.
//
// **Why it fails loudly on an unscripted turn.** The obvious alternative
// — return no candidates for a message the script doesn't know — makes a
// drifted case silently extract nothing and walk on, and the gate then
// certifies a run that never exercised what the case exists to exercise.
// A case that has fallen out of step with the app must stop the run, not
// quietly weaken it.
import type { ProposeFn, TurnProposal } from "./extract";
import type { NarrativeProposeFn } from "./narrative-extract";
import type { ExtractionCandidate } from "./extraction-validator";
import type { RepeatGroup } from "./topics";

// A candidate as a script writes it: the quote is the text, not a
// {turnIndex, text} pair. See the header.
export type ScriptedCandidate =
  | { fieldId: string; kind: "value"; value: string; quote: string }
  | { fieldId: string; kind: "unknown"; quote: string }
  | { fieldId: string; kind: "declined"; quote: string };

export interface ScriptedRepeatDecision {
  repeatGroup: RepeatGroup;
  count: number;
  quote: string;
}

// One scripted clinician turn: what they send, and what the model would
// have proposed from it. `message` is matched against what the driver
// actually types, so a case input and its scripted extraction cannot
// drift apart without the run failing.
export interface ScriptedTurn {
  message: string;
  candidates: ScriptedCandidate[];
  repeatDecision?: ScriptedRepeatDecision;
}

export interface ScriptedNarrative {
  narrative: string;
  candidates: ScriptedCandidate[];
  repeatDecisions?: { repeatGroup: RepeatGroup; count: number; quote: string }[];
}

export interface ExtractionScript {
  caseId: string;
  // A list, not one: C6 runs two cases in a single process (Start over
  // does not restart the server), so both dictations have to be
  // scripted. Matched by text, the same way turns are.
  narratives?: ScriptedNarrative[];
  turns: ScriptedTurn[];
}

// Whitespace-insensitive, case-insensitive. Deliberately no fuzzier than
// that: a script keyed by "close enough" would let a case match the wrong
// turn and produce a run nobody can reason about.
function key(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function stamp(candidates: ScriptedCandidate[], turnIndex: number): ExtractionCandidate[] {
  return candidates.map((candidate) =>
    candidate.kind === "value"
      ? { fieldId: candidate.fieldId, kind: "value", value: candidate.value, quote: { turnIndex, text: candidate.quote } }
      : { fieldId: candidate.fieldId, kind: candidate.kind, quote: { turnIndex, text: candidate.quote } },
  );
}

export class UnscriptedTurnError extends Error {
  constructor(caseId: string, message: string, known: string[]) {
    super(
      `scripted-extract: case ${caseId} has no scripted extraction for ${JSON.stringify(message)}. ` +
        `Scripted turns: ${known.map((m) => JSON.stringify(m)).join(", ")}`,
    );
    this.name = "UnscriptedTurnError";
  }
}

export function createScriptedProposeFn(script: ExtractionScript): ProposeFn {
  const byMessage = new Map<string, ScriptedTurn>();
  for (const turn of script.turns) {
    if (byMessage.has(key(turn.message))) {
      // Two entries for one message means the second is unreachable, and
      // a case that needs to send the same message twice needs
      // turn-indexed scripting rather than a silently-shadowed duplicate.
      throw new Error(`scripted-extract: case ${script.caseId} scripts ${JSON.stringify(turn.message)} twice`);
    }
    byMessage.set(key(turn.message), turn);
  }

  return async ({ message, transcript }): Promise<TurnProposal> => {
    const scripted = byMessage.get(key(message));
    if (scripted === undefined) {
      throw new UnscriptedTurnError(
        script.caseId,
        message,
        script.turns.map((t) => t.message),
      );
    }
    // The clinician's message is already the last entry — extract.ts
    // appends it before calling a proposer, precisely so this index and
    // the one validateCandidates() enforces are the same number.
    const turnIndex = transcript.length - 1;
    return {
      candidates: stamp(scripted.candidates, turnIndex),
      repeatDecision: scripted.repeatDecision
        ? {
            repeatGroup: scripted.repeatDecision.repeatGroup,
            count: scripted.repeatDecision.count,
            quote: { turnIndex, text: scripted.repeatDecision.quote },
          }
        : null,
    };
  };
}

export function createScriptedNarrativeProposeFn(script: ExtractionScript): NarrativeProposeFn {
  return async (narrative) => {
    const scripted = (script.narratives ?? []).find((n) => key(n.narrative) === key(narrative));
    if (scripted === undefined) {
      throw new UnscriptedTurnError(
        script.caseId,
        narrative,
        (script.narratives ?? []).map((n) => n.narrative),
      );
    }
    // The narrative is the whole transcript this pass grounds against, so
    // turn 0 is the only index there is (narrative-extract.ts builds
    // exactly that one-turn transcript).
    return {
      candidates: stamp(scripted.candidates, 0),
      repeatDecisions: (scripted.repeatDecisions ?? []).map((decision) => ({
        repeatGroup: decision.repeatGroup,
        count: decision.count,
        quote: { turnIndex: 0, text: decision.quote },
      })),
    };
  };
}

// Parses and shape-checks a script read from disk. The driver writes one
// per case and names it in WILSON_GATE_SCRIPT; a malformed file must fail
// here with something a human can act on, not deep inside a Server Action
// as an undefined property.
export function parseExtractionScript(json: string): ExtractionScript {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("scripted-extract: script is not an object");
  }
  const script = parsed as Partial<ExtractionScript>;
  if (typeof script.caseId !== "string" || script.caseId.length === 0) {
    throw new Error("scripted-extract: script has no caseId");
  }
  if (!Array.isArray(script.turns)) {
    throw new Error(`scripted-extract: script ${script.caseId} has no turns array`);
  }
  for (const [index, turn] of script.turns.entries()) {
    if (typeof turn?.message !== "string" || !Array.isArray(turn?.candidates)) {
      throw new Error(`scripted-extract: script ${script.caseId} turn ${index} is malformed`);
    }
  }
  return script as ExtractionScript;
}
