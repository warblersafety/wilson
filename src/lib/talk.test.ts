import { describe, expect, it, vi } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import type { FormFieldSpec } from "./form-3500-fields";
import { initRepeatCounts, setRepeatCount, type Topic } from "./topics";
import {
  initTalkSession,
  processTurn,
  startTalk,
  type AskFn,
  type ExtractFn,
  type TalkSession,
} from "./talk";
import { syntheticAsk } from "./synthetic-topic";

function field(id: string, type: FormFieldSpec["type"]): FormFieldSpec {
  return { id, section: "A", pdfFieldName: `f.${id}[0]`, label: id, type, required: false };
}

function topic(
  id: string,
  fieldIds: string[],
  opts: { repeatGroup?: "suspect-product" | "concomitant-medication"; repeatInstance?: number } = {},
): Topic {
  return {
    id,
    section: "A",
    label: id,
    fieldIds,
    repeatGroup: opts.repeatGroup ?? null,
    repeatInstance: opts.repeatInstance ?? null,
    asks: [syntheticAsk(id, fieldIds)],
  };
}

// A record keyed to the synthetic "a"/"b"/"c" fields above, not
// initAgenda()'s real 227-field manifest — applyAction() throws on any
// field id it doesn't already have an entry for.
function unaskedRecordFor(fieldIds: string[]): AgendaRecord {
  const record: AgendaRecord = {};
  for (const id of fieldIds) record[id] = { state: "unasked" };
  return record;
}

function syntheticSession(): TalkSession {
  return {
    transcript: [],
    record: unaskedRecordFor(["a", "b", "c"]),
    repeatCounts: initRepeatCounts(),
  };
}

const FIELD_A = field("a", "text");
const FIELD_B = field("b", "text");
const FIELD_C = field("c", "text");
const TOPIC_1 = topic("t1", ["a", "b"]);
const TOPIC_2 = topic("t2", ["c"]);
const FIELDS = [FIELD_A, FIELD_B, FIELD_C];
const TOPICS = [TOPIC_1, TOPIC_2];

const askStep: AskFn = async (step) => {
  if (step.kind === "topic") return step.topic.label;
  if (step.kind === "repeat-decision") return `another ${step.repeatGroup}?`;
  return "All done, thanks.";
};

describe("initTalkSession", () => {
  it("starts with an empty transcript, a fresh Agenda record, and empty repeat counts", () => {
    const session = initTalkSession();
    expect(session.transcript).toEqual([]);
    expect(session.record).toEqual(initAgenda());
    expect(session.repeatCounts).toEqual({});
  });
});

describe("startTalk", () => {
  it("asks about the first topic's unresolved fields, bundled, without any extraction step", async () => {
    const ask = vi.fn(askStep);
    const session = syntheticSession();
    const result = await startTalk(session, { ask, topics: TOPICS, fields: FIELDS });

    expect(ask).toHaveBeenCalledTimes(1);
    const [step, seenSession] = ask.mock.calls[0];
    expect(step).toEqual({ kind: "topic", topic: TOPIC_1, ask: TOPIC_1.asks[0], fieldIds: ["a", "b"] });
    expect(seenSession.record).toEqual(session.record);
    expect(result.reply).toBe(TOPIC_1.label);
    expect(result.nextStep).toEqual(step);
  });

  it("appends the opening reply to the transcript as a talker turn", async () => {
    const session = syntheticSession();
    const result = await startTalk(session, { ask: askStep, topics: TOPICS, fields: FIELDS });
    expect(result.session.transcript).toEqual([{ role: "talker", text: TOPIC_1.label }]);
  });

  it("does not mutate the input session", async () => {
    const session = syntheticSession();
    await startTalk(session, { ask: askStep, topics: TOPICS, fields: FIELDS });
    expect(session.transcript).toEqual([]);
  });

  it("reports done when every topic's fields are already resolved", async () => {
    let record = unaskedRecordFor(["a", "b", "c"]);
    for (const f of FIELDS) {
      record = applyAction(record, f.id, { type: "decline" });
    }
    const session = { transcript: [], record, repeatCounts: initRepeatCounts() };
    const result = await startTalk(session, { ask: askStep, topics: TOPICS, fields: FIELDS });
    expect(result.nextStep).toEqual({ kind: "done" });
    expect(result.reply).toBe("All done, thanks.");
  });

  it("against the real manifest: the first step is patient-basics's text/date fields (defaults with no override)", async () => {
    const result = await startTalk(initTalkSession(), { ask: askStep });
    expect(result.nextStep.kind).toBe("topic");
    if (result.nextStep.kind === "topic") {
      expect(result.nextStep.topic.id).toBe("patient-basics");
    }
  });
});

describe("processTurn", () => {
  it("applies one answer within a bundled topic and re-surfaces just the remaining field", async () => {
    const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
    const session = syntheticSession();
    const result = await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });

    expect(result.session.record.a).toEqual({ state: "answered", value: "42" });
    expect(result.nextStep).toEqual({ kind: "topic", topic: TOPIC_1, ask: TOPIC_1.asks[0], fieldIds: ["b"] });
  });

  it("moves to the next topic once every field in the current one is resolved", async () => {
    const extract: ExtractFn = async () => ({
      actions: [
        { fieldId: "a", type: "answer", value: "42" },
        { fieldId: "b", type: "decline" },
      ],
    });
    const session = syntheticSession();
    const result = await processTurn(session, "42, no comment on the rest", {
      extract,
      ask: askStep,
      topics: TOPICS,
      fields: FIELDS,
    });
    expect(result.nextStep).toEqual({ kind: "topic", topic: TOPIC_2, ask: TOPIC_2.asks[0], fieldIds: ["c"] });
  });

  it("appends both the clinician's message and the reply to the transcript", async () => {
    const extract: ExtractFn = async () => ({ actions: [] });
    const session = syntheticSession();
    const result = await processTurn(session, "not sure", {
      extract,
      ask: askStep,
      topics: TOPICS,
      fields: FIELDS,
    });
    expect(result.session.transcript).toEqual([
      { role: "clinician", text: "not sure" },
      { role: "talker", text: TOPIC_1.label },
    ]);
  });

  it("does not mutate the input session", async () => {
    const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
    const session = syntheticSession();
    await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });
    expect(session.transcript).toEqual([]);
    expect(session.record.a).toEqual({ state: "unasked" });
  });

  it("ask sees the record already updated with this turn's extraction — never a stale record", async () => {
    const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
    const ask = vi.fn(askStep);
    await processTurn(syntheticSession(), "42", { extract, ask, topics: TOPICS, fields: FIELDS });

    const [, seenSession] = ask.mock.calls[0];
    expect(seenSession.record.a).toEqual({ state: "answered", value: "42" });
  });

  it("ask sees this turn's clinician message already in the transcript", async () => {
    const extract: ExtractFn = async () => ({ actions: [] });
    const ask = vi.fn(askStep);
    await processTurn(syntheticSession(), "not sure", { extract, ask, topics: TOPICS, fields: FIELDS });

    const [, seenSession] = ask.mock.calls[0];
    expect(seenSession.transcript).toEqual([{ role: "clinician", text: "not sure" }]);
  });

  it("applies every proposed action from a turn, even for a field outside the current topic", async () => {
    const extract: ExtractFn = async () => ({
      actions: [
        { fieldId: "a", type: "answer", value: "42" },
        { fieldId: "c", type: "decline" },
      ],
    });
    const session = syntheticSession();
    const result = await processTurn(session, "42, and skip the other thing entirely", {
      extract,
      ask: askStep,
      topics: TOPICS,
      fields: FIELDS,
    });
    expect(result.session.record.a).toEqual({ state: "answered", value: "42" });
    expect(result.session.record.c).toEqual({ state: "declined", value: undefined });
  });

  it("applies proposals in the order extract returned them", async () => {
    const extract: ExtractFn = async () => ({
      actions: [
        { fieldId: "a", type: "answer", value: "first" },
        { fieldId: "a", type: "answer", value: "second" },
      ],
    });
    const result = await processTurn(syntheticSession(), "actually, second", {
      extract,
      ask: askStep,
      topics: TOPICS,
      fields: FIELDS,
    });
    expect(result.session.record.a).toEqual({ state: "answered", value: "second" });
  });

  it("directly overwrites an already-resolved field via answer, no reopen required", async () => {
    const declined = applyAction(unaskedRecordFor(["a", "b", "c"]), "a", { type: "decline" });
    const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "45" }] });
    const result = await processTurn(
      { transcript: [], record: declined, repeatCounts: initRepeatCounts() },
      "actually, it's 45",
      { extract, ask: askStep, topics: TOPICS, fields: FIELDS },
    );
    expect(result.session.record.a).toEqual({ state: "answered", value: "45" });
  });

  it("throws and leaves the record untouched if any proposed action is invalid — never partially applied", async () => {
    const extract: ExtractFn = async () => ({
      actions: [
        { fieldId: "a", type: "answer", value: "42" },
        { fieldId: "not-a-real-field", type: "answer", value: "x" },
      ],
    });
    const session = syntheticSession();
    await expect(
      processTurn(session, "42 and something bogus", {
        extract,
        ask: askStep,
        topics: TOPICS,
        fields: FIELDS,
      }),
    ).rejects.toThrow();
    expect(session.record.a).toEqual({ state: "unasked" });
  });

  it("reports done and lets ask produce a closing message once every topic resolves", async () => {
    const extract: ExtractFn = async () => ({ actions: [{ fieldId: "c", type: "decline" }] });
    let record = applyAction(unaskedRecordFor(["a", "b", "c"]), "a", { type: "decline" });
    record = applyAction(record, "b", { type: "decline" });
    const session = { transcript: [], record, repeatCounts: initRepeatCounts() };
    const result = await processTurn(session, "no comment", {
      extract,
      ask: askStep,
      topics: TOPICS,
      fields: FIELDS,
    });
    expect(result.nextStep).toEqual({ kind: "done" });
    expect(result.reply).toBe("All done, thanks.");
  });

  it("surfaces a repeat-decision step via ask when a repeating group's next instance isn't decided", async () => {
    const g1 = topic("g1", ["a"], { repeatGroup: "suspect-product", repeatInstance: 1 });
    const g2 = topic("g2", ["b"], { repeatGroup: "suspect-product", repeatInstance: 2 });
    let record = applyAction(unaskedRecordFor(["a", "b", "c"]), "a", { type: "decline" });
    const session = { transcript: [], record, repeatCounts: initRepeatCounts() };
    const ask = vi.fn(askStep);
    const extract: ExtractFn = async () => ({ actions: [] });
    const result = await processTurn(session, "that's the only one", {
      extract,
      ask,
      topics: [g1, g2],
      fields: FIELDS,
    });
    expect(result.nextStep).toEqual({
      kind: "repeat-decision",
      repeatGroup: "suspect-product",
      afterInstance: 1,
    });
    expect(result.reply).toBe("another suspect-product?");
  });

  it("skips a repeating group's later instance once repeatCounts has already decided a lower count", async () => {
    const g1 = topic("g1", ["a"], { repeatGroup: "suspect-product", repeatInstance: 1 });
    const g2 = topic("g2", ["b"], { repeatGroup: "suspect-product", repeatInstance: 2 });
    let record = applyAction(unaskedRecordFor(["a", "b", "c"]), "a", { type: "decline" });
    const repeatCounts = setRepeatCount(initRepeatCounts(), "suspect-product", 1, [g1, g2]);
    const session = { transcript: [], record, repeatCounts };
    const extract: ExtractFn = async () => ({ actions: [] });
    const result = await processTurn(session, "no more", {
      extract,
      ask: askStep,
      topics: [g1, g2],
      fields: FIELDS,
    });
    expect(result.nextStep).toEqual({ kind: "done" });
  });

  it("applies a repeatDecision to repeatCounts, in addition to any field actions from the same turn", async () => {
    const g1 = topic("g1", ["a"], { repeatGroup: "suspect-product", repeatInstance: 1 });
    const g2 = topic("g2", ["b"], { repeatGroup: "suspect-product", repeatInstance: 2 });
    const record = unaskedRecordFor(["a", "b", "c"]);
    const session = { transcript: [], record, repeatCounts: initRepeatCounts() };
    const extract: ExtractFn = async () => ({
      actions: [],
      repeatDecision: { repeatGroup: "suspect-product", count: 2 },
    });
    const result = await processTurn(session, "yes, there was a second one", {
      extract,
      ask: askStep,
      topics: [g1, g2],
      fields: FIELDS,
    });
    expect(result.session.repeatCounts).toEqual({ "suspect-product": 2 });
  });

  it("throws and leaves repeatCounts untouched if repeatDecision's count is out of range", async () => {
    const g1 = topic("g1", ["a"], { repeatGroup: "suspect-product", repeatInstance: 1 });
    const g2 = topic("g2", ["b"], { repeatGroup: "suspect-product", repeatInstance: 2 });
    const record = unaskedRecordFor(["a", "b", "c"]);
    const session = { transcript: [], record, repeatCounts: initRepeatCounts() };
    const extract: ExtractFn = async () => ({
      actions: [],
      repeatDecision: { repeatGroup: "suspect-product", count: 99 },
    });
    await expect(
      processTurn(session, "there were loads more", {
        extract,
        ask: askStep,
        topics: [g1, g2],
        fields: FIELDS,
      }),
    ).rejects.toThrow();
    expect(session.repeatCounts).toEqual({});
  });

  it("does not mutate repeatCounts when repeatDecision is absent", async () => {
    const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
    const session = syntheticSession();
    const result = await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });
    expect(result.session.repeatCounts).toEqual(session.repeatCounts);
  });

  // Issue #44's widened follow-up sweep: processTurn() composes the final
  // reply from extract()'s replyPrefix plus the ordinary next question,
  // threads correctionOffers through to the returned TalkStep (never into
  // TalkSession/localStorage — see TalkStep's own comment), and merges
  // volunteeredRepeatGroups into session.volunteeredRepeats.
  describe("widened follow-up sweep plumbing (Issue #44)", () => {
    it("prepends replyPrefix to the ask's own question in both .reply and the stored transcript turn", async () => {
      const extract: ExtractFn = async () => ({
        actions: [{ fieldId: "a", type: "answer", value: "42" }],
        replyPrefix: "Also noted: something else — a value.",
      });
      const session = syntheticSession();
      const result = await processTurn(session, "42, and something else", {
        extract,
        ask: askStep,
        topics: TOPICS,
        fields: FIELDS,
      });
      expect(result.reply).toBe(`Also noted: something else — a value. ${TOPIC_1.label}`);
      expect(result.session.transcript.at(-1)).toEqual({ role: "talker", text: result.reply });
    });

    it("omits the prefix entirely when replyPrefix is absent — the reply reads exactly as it always has", async () => {
      const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
      const session = syntheticSession();
      const result = await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });
      expect(result.reply).toBe(TOPIC_1.label);
    });

    it("carries correctionOffers through to the returned TalkStep", async () => {
      const offer = {
        fieldId: "a",
        action: { fieldId: "a", type: "answer" as const, value: "42" },
        currentState: "answered" as const,
        currentValue: "41",
      };
      const extract: ExtractFn = async () => ({ actions: [], correctionOffers: [offer] });
      const session = syntheticSession();
      const result = await processTurn(session, "actually it's 42", {
        extract,
        ask: askStep,
        topics: TOPICS,
        fields: FIELDS,
      });
      expect(result.correctionOffers).toEqual([offer]);
    });

    it("leaves correctionOffers undefined when extract() reports none", async () => {
      const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
      const session = syntheticSession();
      const result = await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });
      expect(result.correctionOffers).toBeUndefined();
    });

    // Issue #124: a follow-up collision holds pending state the same way
    // a correction offer does — carried through processTurn() untouched,
    // never folded into `actions` (classifyFollowUpActions() writes
    // neither colliding candidate).
    describe("collisions (Issue #124)", () => {
      const COLLISION = {
        fieldId: "a",
        values: ["500 mg", "875 mg"],
        actions: [
          { fieldId: "a", type: "answer" as const, value: "500 mg" },
          { fieldId: "a", type: "answer" as const, value: "875 mg" },
        ],
      };

      it("carries collisions through to the returned TalkStep", async () => {
        const extract: ExtractFn = async () => ({
          actions: [],
          replyPrefix: "I heard two values for a: 500 mg and 875 mg — which should I write?",
          collisions: [COLLISION],
        });
        const session = syntheticSession();
        const result = await processTurn(session, "500 mg, no, 875 mg", {
          extract,
          ask: askStep,
          topics: TOPICS,
          fields: FIELDS,
        });
        expect(result.collisions).toEqual([COLLISION]);
      });

      it("leaves collisions undefined when extract() reports none", async () => {
        const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
        const session = syntheticSession();
        const result = await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });
        expect(result.collisions).toBeUndefined();
      });

      // The bug this unit fixes (Issue #124): before this, the collision
      // sentence — already a live, unresolved question ("which should I
      // write?") — was concatenated with the ask's own next question,
      // which for a partially-answered topic is rule 9's re-ask frame
      // ("Got it. Still need: …"). "Got it" acknowledges facts as settled
      // in the SAME breath the collision line asks the clinician to
      // settle one. askStep (this file's fake AskFn) always returns
      // TOPIC_1.label regardless of record state — standing in here for
      // "whatever the ask's own next question would have been" — so this
      // proves respond() suppresses it, not that a specific re-ask frame
      // is absent.
      it("does not append the ask's own question when a collision is pending — the collision line stands alone", async () => {
        const collisionLine = "I heard two values for a: 500 mg and 875 mg — which should I write?";
        const extract: ExtractFn = async () => ({
          actions: [],
          replyPrefix: collisionLine,
          collisions: [COLLISION],
        });
        const session = syntheticSession();
        const result = await processTurn(session, "500 mg, no, 875 mg", {
          extract,
          ask: askStep,
          topics: TOPICS,
          fields: FIELDS,
        });
        expect(result.reply).toBe(collisionLine);
        expect(result.reply).not.toContain(TOPIC_1.label);
        // The transcript's talker turn is exactly what's shown — no
        // suppressed text lurking in session state either.
        expect(result.session.transcript.at(-1)).toEqual({ role: "talker", text: collisionLine });
        // TalkStep.question backs a widget tap's own transcript quote
        // (chip-grammar.ts's widgetTurnText) — it must equal what was
        // actually shown, never the suppressed ask() text, or a dismiss
        // tap on this turn would quote a question the clinician never saw.
        expect(result.question).toBe(collisionLine);
      });

      // Cross-unit, first met in the dev merge that brought #124's
      // suppression gate together with #125's voicing: a suppressed
      // question was COMPUTED but never uttered — `reply` above is the
      // collision sentence alone. It must not count as the ask's first
      // voicing. If it did, the next turn would render the re-ask frame
      // ("Got it. Still need: …") as this topic's first utterance, which
      // is gate run #1's entry 1 — the defect unit #125 exists to remove.
      // Neither unit's own suite could have caught this; they were built
      // on separate branches.
      it("does not voice a topic ask whose question it suppressed — the clinician never saw it", async () => {
        const collisionLine = "I heard two values for a: 500 mg and 875 mg — which should I write?";
        const extract: ExtractFn = async () => ({
          actions: [],
          replyPrefix: collisionLine,
          collisions: [COLLISION],
        });
        const session = syntheticSession();
        const result = await processTurn(session, "500 mg, no, 875 mg", {
          extract,
          ask: askStep,
          topics: TOPICS,
          fields: FIELDS,
        });
        expect(result.nextStep.kind).toBe("topic");
        expect(result.session.voicedAsks ?? {}).toEqual({});
      });

      // The positive half, so the assertion above cannot pass vacuously:
      // the same turn with nothing colliding voices the ask it shows.
      it("still voices the ask on an ordinary turn — the suppression carve-out is not a blanket off-switch", async () => {
        const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
        const session = syntheticSession();
        const result = await processTurn(session, "42", {
          extract,
          ask: askStep,
          topics: TOPICS,
          fields: FIELDS,
        });
        expect(result.nextStep.kind).toBe("topic");
        expect(Object.keys(result.session.voicedAsks ?? {})).toHaveLength(1);
      });

      // Reviewer pass on PR #142, finding 1 (BLOCKING): the suppression
      // proven above must NOT fire here. `collisions` has exactly one
      // consumer, AskForm.tsx, which renders a collision chip only when
      // step.kind === "topic" — a repeat-decision step has no chip to
      // replace the erased question with, and RepeatDecision.tsx:55
      // quotes `question` into a clinician-role transcript turn.
      // Suppressing on this step kind used to delete the repeat question
      // from `reply`, from `question`, AND from the transcript, leaving
      // it nowhere — the same clinician-role-misattribution harm class
      // unit #123 closed, reopened through this path. The fix narrows
      // respond()'s gate to step.kind === "topic"; on every other step
      // kind a pending collision goes back to being concatenated with
      // the ask's own next question, exactly the pre-#124 behavior.
      it("does not suppress a repeat-decision's own question when a collision is pending — no chip exists there to replace it", async () => {
        const repeatTopics: Topic[] = [
          topic("suspect-product-1", ["a"], { repeatGroup: "suspect-product", repeatInstance: 1 }),
          topic("suspect-product-2", ["b"], { repeatGroup: "suspect-product", repeatInstance: 2 }),
        ];
        // Field "a" is already answered — instance 1's topic is fully
        // resolved, so nextStep() lands on the "is there another?"
        // decision before instance 2 is ever asked about, exactly like
        // the reviewer pass's probe (parked at the suspect-product
        // repeat decision).
        const record = applyAction(unaskedRecordFor(["a", "b"]), "a", { type: "answer" }, "already answered");
        const session: TalkSession = { transcript: [], record, repeatCounts: initRepeatCounts() };
        const collisionLine = "I heard two values for a: 500 mg and 875 mg — which should I write?";
        const extract: ExtractFn = async () => ({
          actions: [],
          replyPrefix: collisionLine,
          collisions: [COLLISION],
        });
        const result = await processTurn(session, "500 mg, no, 875 mg", {
          extract,
          ask: askStep,
          topics: repeatTopics,
          fields: FIELDS,
        });
        expect(result.nextStep).toEqual({ kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 });
        // askStep's own repeat-decision phrasing (this file's fake AskFn).
        const repeatQuestion = "another suspect-product?";
        // (a) the repeat question is present in `reply` ...
        expect(result.reply).toBe(`${collisionLine} ${repeatQuestion}`);
        // (b) ... and `question` is that repeat question, never the
        // collision sentence — a chip tap on this turn (RepeatDecision's
        // Yes/No) must quote the question the clinician actually saw.
        expect(result.question).toBe(repeatQuestion);
        expect(result.question).not.toBe(collisionLine);
      });

      it("does not suppress the done message when a collision is pending — same reason as the repeat-decision case above", async () => {
        let record = applyAction(unaskedRecordFor(["a", "b", "c"]), "a", { type: "answer" }, "1");
        record = applyAction(record, "b", { type: "answer" }, "2");
        record = applyAction(record, "c", { type: "answer" }, "3");
        const session: TalkSession = { transcript: [], record, repeatCounts: initRepeatCounts() };
        const collisionLine = "I heard two values for a: 500 mg and 875 mg — which should I write?";
        const extract: ExtractFn = async () => ({
          actions: [],
          replyPrefix: collisionLine,
          collisions: [COLLISION],
        });
        const result = await processTurn(session, "500 mg, no, 875 mg", {
          extract,
          ask: askStep,
          topics: TOPICS,
          fields: FIELDS,
        });
        expect(result.nextStep).toEqual({ kind: "done" });
        const doneMessage = "All done, thanks."; // askStep's own done phrasing
        expect(result.reply).toBe(`${collisionLine} ${doneMessage}`);
        expect(result.question).toBe(doneMessage);
        expect(result.question).not.toBe(collisionLine);
      });

      it("still concatenates the ask's own question normally once nothing is colliding", async () => {
        const extract: ExtractFn = async () => ({
          actions: [{ fieldId: "a", type: "answer", value: "42" }],
          replyPrefix: "Also noted: something else — a value.",
        });
        const session = syntheticSession();
        const result = await processTurn(session, "42, and something else", {
          extract,
          ask: askStep,
          topics: TOPICS,
          fields: FIELDS,
        });
        expect(result.reply).toBe(`Also noted: something else — a value. ${TOPIC_1.label}`);
      });
    });

    it("merges a volunteered repeat group into session.volunteeredRepeats", async () => {
      const extract: ExtractFn = async () => ({ actions: [], volunteeredRepeatGroups: ["suspect-product"] });
      const session = syntheticSession();
      const result = await processTurn(session, "she's also on a second one, lisinopril", {
        extract,
        ask: askStep,
        topics: TOPICS,
        fields: FIELDS,
      });
      expect(result.session.volunteeredRepeats).toEqual({ "suspect-product": true });
    });

    it("preserves an earlier volunteeredRepeats entry across a turn that doesn't touch it", async () => {
      const extract: ExtractFn = async () => ({ actions: [{ fieldId: "a", type: "answer", value: "42" }] });
      const session = { ...syntheticSession(), volunteeredRepeats: { "suspect-product": true as const } };
      const result = await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });
      expect(result.session.volunteeredRepeats).toEqual({ "suspect-product": true });
    });

    it("accumulates a second group alongside an already-recorded one", async () => {
      const extract: ExtractFn = async () => ({ actions: [], volunteeredRepeatGroups: ["concomitant-medication"] });
      const session = { ...syntheticSession(), volunteeredRepeats: { "suspect-product": true as const } };
      const result = await processTurn(session, "and metformin too", {
        extract,
        ask: askStep,
        topics: TOPICS,
        fields: FIELDS,
      });
      expect(result.session.volunteeredRepeats).toEqual({
        "suspect-product": true,
        "concomitant-medication": true,
      });
    });

    it("does not mutate the input session's volunteeredRepeats", async () => {
      const extract: ExtractFn = async () => ({ actions: [], volunteeredRepeatGroups: ["suspect-product"] });
      const session = syntheticSession();
      await processTurn(session, "she's also on a second one", {
        extract,
        ask: askStep,
        topics: TOPICS,
        fields: FIELDS,
      });
      expect(session.volunteeredRepeats).toBeUndefined();
    });
  });
});
