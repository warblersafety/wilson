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
} from "./talk";

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

function syntheticSession() {
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
    expect(step).toEqual({ kind: "topic", topic: TOPIC_1, fieldIds: ["a", "b"] });
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
    const extract: ExtractFn = async () => [{ fieldId: "a", type: "answer", value: "42" }];
    const session = syntheticSession();
    const result = await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });

    expect(result.session.record.a).toEqual({ state: "answered", value: "42" });
    expect(result.nextStep).toEqual({ kind: "topic", topic: TOPIC_1, fieldIds: ["b"] });
  });

  it("moves to the next topic once every field in the current one is resolved", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: "a", type: "answer", value: "42" },
      { fieldId: "b", type: "decline" },
    ];
    const session = syntheticSession();
    const result = await processTurn(session, "42, no comment on the rest", {
      extract,
      ask: askStep,
      topics: TOPICS,
      fields: FIELDS,
    });
    expect(result.nextStep).toEqual({ kind: "topic", topic: TOPIC_2, fieldIds: ["c"] });
  });

  it("appends both the clinician's message and the reply to the transcript", async () => {
    const extract: ExtractFn = async () => [];
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
    const extract: ExtractFn = async () => [{ fieldId: "a", type: "answer", value: "42" }];
    const session = syntheticSession();
    await processTurn(session, "42", { extract, ask: askStep, topics: TOPICS, fields: FIELDS });
    expect(session.transcript).toEqual([]);
    expect(session.record.a).toEqual({ state: "unasked" });
  });

  it("ask sees the record already updated with this turn's extraction — never a stale record", async () => {
    const extract: ExtractFn = async () => [{ fieldId: "a", type: "answer", value: "42" }];
    const ask = vi.fn(askStep);
    await processTurn(syntheticSession(), "42", { extract, ask, topics: TOPICS, fields: FIELDS });

    const [, seenSession] = ask.mock.calls[0];
    expect(seenSession.record.a).toEqual({ state: "answered", value: "42" });
  });

  it("ask sees this turn's clinician message already in the transcript", async () => {
    const extract: ExtractFn = async () => [];
    const ask = vi.fn(askStep);
    await processTurn(syntheticSession(), "not sure", { extract, ask, topics: TOPICS, fields: FIELDS });

    const [, seenSession] = ask.mock.calls[0];
    expect(seenSession.transcript).toEqual([{ role: "clinician", text: "not sure" }]);
  });

  it("applies every proposed action from a turn, even for a field outside the current topic", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: "a", type: "answer", value: "42" },
      { fieldId: "c", type: "decline" },
    ];
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
    const extract: ExtractFn = async () => [
      { fieldId: "a", type: "answer", value: "first" },
      { fieldId: "a", type: "answer", value: "second" },
    ];
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
    const extract: ExtractFn = async () => [{ fieldId: "a", type: "answer", value: "45" }];
    const result = await processTurn(
      { transcript: [], record: declined, repeatCounts: initRepeatCounts() },
      "actually, it's 45",
      { extract, ask: askStep, topics: TOPICS, fields: FIELDS },
    );
    expect(result.session.record.a).toEqual({ state: "answered", value: "45" });
  });

  it("throws and leaves the record untouched if any proposed action is invalid — never partially applied", async () => {
    const extract: ExtractFn = async () => [
      { fieldId: "a", type: "answer", value: "42" },
      { fieldId: "not-a-real-field", type: "answer", value: "x" },
    ];
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
    const extract: ExtractFn = async () => [{ fieldId: "c", type: "decline" }];
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
    const extract: ExtractFn = async () => [];
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
    const extract: ExtractFn = async () => [];
    const result = await processTurn(session, "no more", {
      extract,
      ask: askStep,
      topics: [g1, g2],
      fields: FIELDS,
    });
    expect(result.nextStep).toEqual({ kind: "done" });
  });
});
