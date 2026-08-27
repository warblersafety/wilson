// The Talker's rendered copy, against docs/ask-copy.md. This replaces the
// v1.1 suite wholesale: every test in it proved a property of the
// label-template path (the last-colon-segment rule, the override table,
// the comma guard, the "(yes or no)" suffix, the MAX_FIELDS_PER_ASK cap),
// and rule 1 deletes that path rather than demoting it. What replaces
// those tests is the contract's own claim — a rendered ask EQUALS the
// authored copy, for every topic and both repeat instances.
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import {
  askCopy,
  askDeterministic,
  DONE_MESSAGE,
  REPEAT_DECISION_COPY,
  reAskFrame,
  VOLUNTEERED_REPEAT_HINT,
} from "./ask";
import { AUTHORED_ASKS, askApplies, unresolvedFactNames } from "./ask-inventory";
import { displayName } from "./display-names";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { initTalkSession, type TalkSession } from "./talk";
import { initRepeatCounts, nextStep, setRepeatCount, TOPICS } from "./topics";

function sessionWith(record: AgendaRecord): TalkSession {
  return { ...initTalkSession(), record };
}

// Marks every field the given ask waits on as unknown — the "I don't have
// that" chip's own write path, and the only way to walk past an ask
// without inventing manifest-valid values.
function dismiss(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
  return fieldIds.reduce((rec, id) => applyAction(rec, id, { type: "mark_unknown" }), record);
}

// Every ask the walk actually voices, in order, from a fresh session
// dismissed straight through to done.
function scriptedWalk(): string[] {
  let record = initAgenda();
  let counts = initRepeatCounts();
  const asked: string[] = [];
  for (let guard = 0; guard < 200; guard += 1) {
    const step = nextStep(record, counts);
    if (step.kind === "done") return asked;
    if (step.kind === "repeat-decision") {
      asked.push(REPEAT_DECISION_COPY[step.repeatGroup]);
      counts = setRepeatCount(counts, step.repeatGroup, step.afterInstance);
      continue;
    }
    asked.push(askCopy(step.ask, record));
    record = dismiss(record, step.fieldIds);
  }
  throw new Error("scriptedWalk: the walk never reached done");
}

describe("authored ask copy", () => {
  // AC-1's structural test. Every ask, every topic, both repeat
  // instances — driven through askDeterministic, not read off the
  // inventory, so it proves what a clinician is actually shown.
  it("renders every authored ask, for every topic and both repeat instances, exactly as authored", async () => {
    const record = initAgenda();
    for (const ask of AUTHORED_ASKS) {
      if (!askApplies(ask, record)) continue;
      const topic = TOPICS.find((t) => t.id === ask.topicId)!;
      const step = { kind: "topic" as const, topic, ask, fieldIds: ask.askFieldIds };
      expect(await askDeterministic(step, sessionWith(record)), ask.id).toBe(ask.copy);
    }
  });

  it("covers both suspect-product instances with instance-specific copy", async () => {
    const sp1 = AUTHORED_ASKS.find((a) => a.id === "SP-1")!;
    const sp1of2 = AUTHORED_ASKS.find((a) => a.id === "SP-1-2")!;
    expect(sp1.copy).toContain("the suspect product");
    expect(sp1of2.copy).toContain("the second suspect product");
    expect(sp1.copy).not.toBe(sp1of2.copy);
  });

  // The exact defect Steve rejected on 2026-08-26.
  it("never renders a template marker, a manifest label, or a field id", () => {
    const labels = new Set(FORM_3500_FIELDS.map((f) => f.label));
    const rendered = [
      ...AUTHORED_ASKS.map((a) => a.copy),
      ...Object.values(REPEAT_DECISION_COPY),
      DONE_MESSAGE,
      VOLUNTEERED_REPEAT_HINT,
      ...FORM_3500_FIELDS.map((f) => displayName(f.id)),
    ];
    for (const text of rendered) {
      expect(text, text).not.toContain("(yes or no)");
      expect(text, text).not.toMatch(/Page\d|Prod\d\.|Sec[A-G]_/);
      for (const label of labels) {
        expect(text.includes(label), `${text} contains the manifest label ${label}`).toBe(false);
      }
    }
  });

  // Rule 8's voice: "one question mark per ask, no exclamation marks".
  // The exclamation half holds everywhere. The question-mark half does
  // not: six of the contract's OWN authored asks depart from it, and the
  // inventory is what AC-1 requires be rendered verbatim. Pinned as an
  // exact set rather than described in a comment (reviewer pass, PR #98,
  // finding 3 — my first description of it named the wrong asks), so
  // #91's UX floor can encode the exemption against a list a test keeps
  // honest, and an amendment to either side fails here first.
  it("never shouts — no exclamation marks anywhere in the authored copy", () => {
    for (const ask of AUTHORED_ASKS) expect(ask.copy, ask.id).not.toContain("!");
  });

  it("departs from rule 8's one-question-mark rule in exactly six places", () => {
    const departures = AUTHORED_ASKS
      // Instance 2 and concomitant instances 2-10 reuse the same copy
      // pattern; counting them would just multiply the same departures.
      .filter((a) => !/suspect-product-2|concomitant-medication-([2-9]|10)/.test(a.topicId))
      .map((a) => ({ id: a.id, marks: (a.copy.match(/\?/g) ?? []).length }))
      .filter((a) => a.marks !== 1);
    expect(departures).toEqual([
      // Imperatives, not questions — no question mark at all.
      { id: "WH-1", marks: 0 },
      { id: "SP-2", marks: 0 },
      // Deliberate two-part questions.
      { id: "SP-4", marks: 2 },
      { id: "DV-2", marks: 2 },
      { id: "DV-3", marks: 2 },
      { id: "RA-2", marks: 2 },
    ]);
  });
});

describe("rule 9's re-ask frames", () => {
  it("names one still-open fact with the short frame", () => {
    expect(reAskFrame(["age"])).toBe("And the age?");
  });

  it("lists several with the long frame", () => {
    expect(reAskFrame(["age", "sex: male"])).toBe("Got it. Still need: age and sex: male.");
    expect(reAskFrame(["age", "weight", "date of birth"])).toBe(
      "Got it. Still need: age, weight, and date of birth.",
    );
  });

  it("refuses to compose a frame naming nothing", () => {
    expect(() => reAskFrame([])).toThrow(/at least one/);
  });

  // The contract's own reason for the frames: "A frame is never
  // byte-equal to the primary ask, so the no-consecutive-duplicates check
  // holds across the pair."
  it("re-asks a partly answered ask by naming only what is still open", async () => {
    const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
    const topic = TOPICS.find((t) => t.id === pb1.topicId)!;
    const record = applyAction(initAgenda(), pb1.askFieldIds[0], { type: "answer" }, "MRN 44-1902");
    const step = { kind: "topic" as const, topic, ask: pb1, fieldIds: pb1.askFieldIds.slice(1) };
    const rendered = await askDeterministic(step, sessionWith(record));
    // Facts, not fields: the sex one-hot is one fact, named once.
    expect(rendered).toBe("Got it. Still need: age and sex.");
    expect(rendered).toBe(reAskFrame(unresolvedFactNames(pb1, record)));
    expect(rendered).not.toBe(pb1.copy);
    expect(rendered).not.toContain(displayName(pb1.askFieldIds[0]));
  });

  it("returns to the primary copy while nothing in the ask is resolved", () => {
    const pb2 = AUTHORED_ASKS.find((a) => a.id === "PB-2")!;
    expect(askCopy(pb2, initAgenda())).toBe(pb2.copy);
  });

  it("refuses to compose copy for an ask with nothing left to ask", () => {
    const pb2 = AUTHORED_ASKS.find((a) => a.id === "PB-2")!;
    const record = dismiss(initAgenda(), pb2.askFieldIds);
    expect(() => askCopy(pb2, record)).toThrow(/nothing left to ask/);
  });
});

describe("machinery copy", () => {
  it("phrases each repeat decision as the contract authors it", async () => {
    const session = initTalkSession();
    expect(
      await askDeterministic({ kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 }, session),
    ).toBe("Was there another suspect product?");
    expect(
      await askDeterministic(
        { kind: "repeat-decision", repeatGroup: "concomitant-medication", afterInstance: 1 },
        session,
      ),
    ).toBe("Is there another medication to add?");
  });

  it("prefixes the volunteered-repeat hint without changing the decision's own copy", async () => {
    const session: TalkSession = { ...initTalkSession(), volunteeredRepeats: { "suspect-product": true } };
    const rendered = await askDeterministic(
      { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 },
      session,
    );
    expect(rendered).toBe(`${VOLUNTEERED_REPEAT_HINT}Was there another suspect product?`);
    expect(rendered).toContain(REPEAT_DECISION_COPY["suspect-product"]);
  });

  it("ends the walk with the contract's done message", async () => {
    expect(await askDeterministic({ kind: "done" }, initTalkSession())).toBe(
      "That's everything I need to ask. Review the report before you sign off.",
    );
  });
});

describe("a scripted full walk", () => {
  const walk = scriptedWalk();

  // The count the contract states, reached by actually walking rather
  // than by summing the inventory — 58-82 template asks is what Steve
  // was shown.
  it("asks 26 questions plus the two repeat decisions, not 58-82", () => {
    // 21 ungated (ask-inventory.test.ts pins the list) + the 5 gated asks
    // this walk still reaches, since gate evaluation is the sibling PR's
    // scope: PA-1, SP-9, and the three device asks.
    expect(walk.filter((q) => !Object.values(REPEAT_DECISION_COPY).includes(q))).toHaveLength(26);
    expect(walk.filter((q) => Object.values(REPEAT_DECISION_COPY).includes(q))).toHaveLength(2);
    expect(walk).toHaveLength(28);
  });

  it("never asks the same thing twice in a row", () => {
    for (let i = 1; i < walk.length; i += 1) {
      expect(walk[i], `turn ${i} repeats turn ${i - 1}`).not.toBe(walk[i - 1]);
    }
  });

  it("asks only authored strings", () => {
    const authored = new Set([...AUTHORED_ASKS.map((a) => a.copy), ...Object.values(REPEAT_DECISION_COPY)]);
    for (const question of walk) expect(authored.has(question), question).toBe(true);
  });

  it("skips no gated topic yet — gates are the sibling unit's scope", () => {
    // Recorded so this file says plainly what it does NOT yet prove: the
    // gate evaluation (ask-copy.md rule 5) lands with the derive rules,
    // so today's walk still voices the device and purchase asks.
    expect(walk).toContain("Where and when was it purchased — the store or website, and the date?");
  });
});
