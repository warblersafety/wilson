// No live API calls in this file — a real Anthropic() client needs no key
// to construct, and its .messages.parse() is spied/stubbed on every test,
// matching lucy's keyless-dev-machine practice (docs/SECRETS-AND-COSTS.md).
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractionResponse } from "../prompts/extractor";
import { createExtractFn } from "./extract";
import type { FormFieldSpec } from "./form-3500-fields";
import { initAgenda, type AgendaRecord } from "./agenda";
import { initRepeatCounts, setRepeatCount, type Topic } from "./topics";
import type { TalkSession } from "./talk";

function field(id: string, type: FormFieldSpec["type"]): FormFieldSpec {
  return { id, section: "A", pdfFieldName: `f.${id}[0]`, label: id, type, required: false };
}

const FIELD_A = field("a", "text");
const FIELD_B = field("b", "text");
const FIELDS = [FIELD_A, FIELD_B];

const TOPIC: Topic = {
  id: "t1",
  section: "A",
  label: "Topic 1",
  fieldIds: ["a", "b"],
  repeatGroup: null,
  repeatInstance: null,
};

const REPEAT_TOPIC_1: Topic = {
  id: "g1",
  section: "D",
  label: "Group instance 1",
  fieldIds: ["a"],
  repeatGroup: "suspect-product",
  repeatInstance: 1,
};
const REPEAT_TOPIC_2: Topic = {
  id: "g2",
  section: "D",
  label: "Group instance 2",
  fieldIds: ["b"],
  repeatGroup: "suspect-product",
  repeatInstance: 2,
};

function unaskedRecordFor(fieldIds: string[]): AgendaRecord {
  const record: AgendaRecord = {};
  for (const id of fieldIds) record[id] = { state: "unasked" };
  return record;
}

function sessionWith(overrides: Partial<TalkSession> = {}): TalkSession {
  return {
    transcript: [{ role: "talker", text: "Anything to add?" }],
    record: unaskedRecordFor(["a", "b"]),
    repeatCounts: initRepeatCounts(),
    ...overrides,
  };
}

function fakeParsedResponse(parsed_output: ExtractionResponse | null) {
  return { parsed_output } as Awaited<ReturnType<Anthropic["messages"]["parse"]>>;
}

describe("createExtractFn", () => {
  let client: Anthropic;

  beforeEach(() => {
    client = new Anthropic({ apiKey: "test-key-not-real" });
  });

  it("accepts a field candidate whose quote is real, and returns it as a ProposedAction", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [
          { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "42 years old" } },
        ],
        repeatDecision: null,
      }),
    );
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const session = sessionWith();
    const result = await extract(session, "42 years old");
    expect(result.actions).toEqual([{ fieldId: "a", type: "answer", value: "42" }]);
    expect(result.repeatDecision).toBeUndefined();
  });

  it("drops a field candidate whose quote is not a real substring of the clinician's message", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [
          { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "fifty years old" } },
        ],
        repeatDecision: null,
      }),
    );
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42 years old");
    expect(result.actions).toEqual([]);
  });

  it("drops a candidate targeting a field id outside the given fields list", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [
          { fieldId: "not-real", kind: "value", value: "x", quote: { turnIndex: 1, text: "42" } },
        ],
        repeatDecision: null,
      }),
    );
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42");
    expect(result.actions).toEqual([]);
  });

  it("returns a repeatDecision when the model proposes one grounded in a real quote", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecision: {
          repeatGroup: "suspect-product",
          count: 2,
          quote: { turnIndex: 1, text: "yes, a second one" },
        },
      }),
    );
    const session = sessionWith({ record: unaskedRecordFor(["a"]) });
    const extract = createExtractFn(client, [REPEAT_TOPIC_1, REPEAT_TOPIC_2], [FIELD_A, FIELD_B]);
    const result = await extract(session, "yes, a second one");
    expect(result.repeatDecision).toEqual({ repeatGroup: "suspect-product", count: 2 });
  });

  it("drops a repeatDecision whose quote is not real, without dropping accompanying field actions", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } }],
        repeatDecision: {
          repeatGroup: "suspect-product",
          count: 2,
          quote: { turnIndex: 1, text: "a sentence never said" },
        },
      }),
    );
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42");
    expect(result.actions).toEqual([{ fieldId: "a", type: "answer", value: "42" }]);
    expect(result.repeatDecision).toBeUndefined();
  });

  it("fails closed (no actions, no repeatDecision) when structured output parsing fails", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(fakeParsedResponse(null));
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(sessionWith(), "42");
    expect(result).toEqual({ actions: [] });
  });

  it("short-circuits with no model call once every topic is already resolved", async () => {
    const parseSpy = vi.spyOn(client.messages, "parse");
    const record = initAgenda();
    const resolvedRecord: AgendaRecord = {};
    for (const [id] of Object.entries(record)) resolvedRecord[id] = { state: "declined" };
    // Every repeat group's count must also be decided (at its minimum), or
    // nextStep() stops at an unresolved "repeat-decision" step for
    // instance 2+ before ever reaching "done" — same walk order
    // topics.test.ts documents.
    let repeatCounts = initRepeatCounts();
    repeatCounts = setRepeatCount(repeatCounts, "suspect-product", 1);
    repeatCounts = setRepeatCount(repeatCounts, "concomitant-medication", 1);
    const extract = createExtractFn(client);
    const result = await extract(sessionWith({ record: resolvedRecord, repeatCounts }), "nothing more");
    expect(result).toEqual({ actions: [] });
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("includes the clinician's latest message in the transcript passed to grounding, at the correct index", async () => {
    const parseSpy = vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({ candidates: [], repeatDecision: null }),
    );
    const session = sessionWith(); // one prior turn, index 0
    const extract = createExtractFn(client, [TOPIC], FIELDS);
    await extract(session, "the new message");
    const call = parseSpy.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(call.messages[0].content).toContain("[1] CLINICIAN: the new message");
  });
});
