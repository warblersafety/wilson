// The fake model's own guarantees (Issue #96). These matter more than
// they look: everything a gate run claims rests on this substituting for
// the model call and NOTHING else. A scripted proposal that skipped
// grounding, or cited a turn of its own choosing, would make a gate case
// evidence about the fixture rather than about the build.
import { describe, expect, it } from "vitest";
import {
  createScriptedNarrativeProposeFn,
  createScriptedProposeFn,
  parseExtractionScript,
  UnscriptedTurnError,
  type ExtractionScript,
} from "./scripted-extract";
import { createExtractFnFrom } from "./extract";
import { askDeterministic } from "./ask";
import { initTalkSession, processTurn, startTalk } from "./talk";

const AGE = "Page1.SecA_Patient.AgeValue";
const IDENT = "Page1.SecA_Patient.PatientIdentifier";

const script: ExtractionScript = {
  caseId: "T1",
  turns: [
    {
      message: "MRN 12-3456, she's 58.",
      candidates: [
        { fieldId: IDENT, kind: "value", value: "MRN 12-3456", quote: "MRN 12-3456" },
        { fieldId: AGE, kind: "value", value: "58", quote: "she's 58" },
      ],
    },
    {
      message: "Made up entirely.",
      candidates: [{ fieldId: AGE, kind: "value", value: "61", quote: "a quote that is not in the message" }],
    },
  ],
};

const context = (message: string, transcriptLength: number) =>
  ({
    message,
    transcript: Array.from({ length: transcriptLength }, () => ({ role: "clinician" as const, text: "x" })),
  }) as never;

describe("createScriptedProposeFn", () => {
  it("stamps the CURRENT turn index, which no script can choose for itself", async () => {
    const propose = createScriptedProposeFn(script);
    const atSeven = await propose(context("MRN 12-3456, she's 58.", 8));
    expect(atSeven?.candidates.map((c) => c.quote.turnIndex)).toEqual([7, 7]);
    // The same script, later in a longer session: a different index, and
    // the script said nothing about either. This is design.md's
    // citation-pool rule holding for the fake exactly as for the model.
    const atTwenty = await propose(context("MRN 12-3456, she's 58.", 21));
    expect(atTwenty?.candidates.map((c) => c.quote.turnIndex)).toEqual([20, 20]);
  });

  it("matches a message regardless of surrounding whitespace and case", async () => {
    const propose = createScriptedProposeFn(script);
    expect(await propose(context("  mrn 12-3456,   SHE'S 58. ", 1))).not.toBeNull();
  });

  // The alternative — returning nothing for an unknown message — is what
  // makes a drifted case run green while exercising none of what it
  // exists to exercise.
  it("refuses an unscripted message instead of extracting nothing", async () => {
    const propose = createScriptedProposeFn(script);
    await expect(propose(context("something nobody scripted", 1))).rejects.toThrow(UnscriptedTurnError);
    await expect(propose(context("something nobody scripted", 1))).rejects.toThrow(/case T1 has no scripted extraction/);
  });

  it("refuses a script that would shadow one of its own turns", () => {
    expect(() =>
      createScriptedProposeFn({ caseId: "dupe", turns: [script.turns[0], { ...script.turns[0], candidates: [] }] }),
    ).toThrow(/scripts .* twice/);
  });
});

describe("a scripted candidate faces the real checks", () => {
  it("is written when its quote is really in the clinician's message", async () => {
    const extract = createExtractFnFrom(createScriptedProposeFn(script));
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const step = await processTurn(opening.session, "MRN 12-3456, she's 58.", { ask: askDeterministic, extract });
    expect(step.session.record[IDENT]).toEqual({ state: "answered", value: "MRN 12-3456" });
    expect(step.session.record[AGE]).toEqual({ state: "answered", value: "58" });
  });

  // The whole premise of the fake: it proposes, the real validator
  // disposes. A fixture that could write ungrounded values would make a
  // gate run prove nothing about grounding at all.
  it("is REJECTED when its quote is not, exactly as a hallucinating model's would be", async () => {
    const extract = createExtractFnFrom(createScriptedProposeFn(script));
    const opening = await startTalk(initTalkSession(), { ask: askDeterministic });
    const step = await processTurn(opening.session, "Made up entirely.", { ask: askDeterministic, extract });
    expect(step.session.record[AGE].state).toBe("unasked");
  });
});

describe("createScriptedNarrativeProposeFn", () => {
  const withNarratives: ExtractionScript = {
    ...script,
    narratives: [
      { narrative: "First dictation.", candidates: [] },
      { narrative: "Second dictation, after Start over.", candidates: [] },
    ],
  };

  // C6 runs two cases in one process, so one script answers both.
  it("matches any of the scripted narratives", async () => {
    const propose = createScriptedNarrativeProposeFn(withNarratives);
    expect(await propose("First dictation.", [])).toEqual({ candidates: [], repeatDecisions: [] });
    expect(await propose("Second dictation, after Start over.", [])).toEqual({ candidates: [], repeatDecisions: [] });
  });

  it("refuses a narrative it has no script for", async () => {
    const propose = createScriptedNarrativeProposeFn(withNarratives);
    await expect(propose("a third dictation", [])).rejects.toThrow(UnscriptedTurnError);
  });

  it("cites turn 0 — the narrative is the whole transcript it grounds against", async () => {
    const propose = createScriptedNarrativeProposeFn({
      caseId: "N1",
      turns: [],
      narratives: [{ narrative: "She is 61.", candidates: [{ fieldId: AGE, kind: "value", value: "61", quote: "She is 61" }] }],
    });
    const result = await propose("She is 61.", []);
    expect(result?.candidates[0].quote.turnIndex).toBe(0);
  });
});

describe("parseExtractionScript", () => {
  it("accepts what the driver writes", () => {
    expect(parseExtractionScript(JSON.stringify(script)).caseId).toBe("T1");
  });

  // A malformed script must fail with something a human can act on, not
  // as an undefined property deep inside a Server Action.
  it.each([
    ["null", "not an object"],
    ['{"turns":[]}', "no caseId"],
    ['{"caseId":"x"}', "no turns array"],
    ['{"caseId":"x","turns":[{"message":1}]}', "turn 0 is malformed"],
  ])("rejects %s", (json, message) => {
    expect(() => parseExtractionScript(json)).toThrow(new RegExp(message));
  });
});
