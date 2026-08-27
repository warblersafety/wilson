// No live API calls in this file — same keyless-dev-machine practice as
// extract.test.ts.
import Anthropic from "@anthropic-ai/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NarrativeExtractionResponse } from "../prompts/narrative-extractor";
import { applyNarrativeProposals, createNarrativeExtractFn } from "./narrative-extract";
import { initAgenda, type AgendaRecord } from "./agenda";
import type { FormFieldSpec } from "./form-3500-fields";
import { initRepeatCounts, type RepeatCounts, type Topic } from "./topics";
import { syntheticTopic } from "./synthetic-topic";

function field(id: string, type: FormFieldSpec["type"], options?: string[]): FormFieldSpec {
  return { id, section: "A", pdfFieldName: `f.${id}[0]`, label: id, type, required: false, options };
}

const FIELD_A = field("a", "text");
const FIELD_B = field("b", "text");
const CHECKBOX_FIELD = field("cb", "checkbox");
const ENUM_FIELD = field("en", "enum", [" ", "Alpha", "Beta"]);
const FIELDS = [FIELD_A, FIELD_B, CHECKBOX_FIELD, ENUM_FIELD];

const TOPIC: Topic = syntheticTopic({
  id: "t1",
  section: "A",
  label: "Topic 1",
  fieldIds: ["a", "b", "cb", "en"],
  repeatGroup: null,
  repeatInstance: null,
});

// Instance 2's own field ("p2") is never in the fields list any real
// caller would pass (narrativePassFields() already excludes it) — used
// below to prove a misbehaving model targeting it anyway is refused the
// same deterministic way an unknown field id already is.
const REPEAT_TOPIC_1: Topic = syntheticTopic({
  id: "g1",
  section: "D",
  label: "Group instance 1",
  fieldIds: ["p1"],
  repeatGroup: "suspect-product",
  repeatInstance: 1,
});
const FIELD_P1 = field("p1", "text");
const FIELD_C1 = field("c1", "text");

// Instance 2's own topic — never passed to narrativePassFields as an
// extraction target (it's still excluded by repeatInstance > 1 even when
// present in the topics list), but needed so isValidRepeatCount() sees the
// group's real max (2) instead of a synthetic single-instance max of 1.
const REPEAT_TOPIC_2: Topic = syntheticTopic({
  id: "g2",
  section: "D",
  label: "Group instance 2",
  fieldIds: ["p2"],
  repeatGroup: "suspect-product",
  repeatInstance: 2,
});
// concomitant-medication's real max is 10 (topics.test.ts) — three
// same-group topics here are enough for isValidRepeatCount(..., 3, ...) to
// see a max ≥ 3 without needing all ten.
const CONCOMITANT_TOPICS_UP_TO_3: Topic[] = [1, 2, 3].map((n) =>
  syntheticTopic({
    id: `c${n}`,
    section: "F",
    label: `Concomitant instance ${n}`,
    fieldIds: [`c${n}`],
    repeatGroup: "concomitant-medication",
    repeatInstance: n,
  }),
);

function unaskedRecordFor(fieldIds: string[]): AgendaRecord {
  const record: AgendaRecord = {};
  for (const id of fieldIds) record[id] = { state: "unasked" };
  return record;
}

function fakeParsedResponse(parsed_output: NarrativeExtractionResponse | null) {
  return { parsed_output } as Awaited<ReturnType<Anthropic["messages"]["parse"]>>;
}

describe("createNarrativeExtractFn", () => {
  let client: Anthropic;

  beforeEach(() => {
    client = new Anthropic({ apiKey: "test-key-not-real" });
  });

  it("accepts a grounded field candidate, paired with its quote", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 0, text: "42 years old" } }],
        repeatDecisions: [],
      }),
    );
    const extract = createNarrativeExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["a", "b", "cb", "en"]), repeatCounts: initRepeatCounts() },
      "42 years old",
    );
    expect(result.proposals).toEqual([
      { action: { fieldId: "a", type: "answer", value: "42" }, quote: { turnIndex: 0, text: "42 years old" } },
    ]);
    expect(result.rejected).toEqual([]);
  });

  it("drops a field candidate whose quote is not real, and surfaces why in rejected", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 0, text: "fifty" } }],
        repeatDecisions: [],
      }),
    );
    const extract = createNarrativeExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["a", "b", "cb", "en"]), repeatCounts: initRepeatCounts() },
      "42 years old",
    );
    expect(result.proposals).toEqual([]);
    expect(result.rejected).toEqual([
      { candidate: { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 0, text: "fifty" } }, reason: "quote_not_found" },
    ]);
  });

  it("accepts a checkbox candidate with a legal true/false value — fixed-choice fields are in scope for this pass", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "cb", kind: "value", value: "true", quote: { turnIndex: 0, text: "admitted overnight" } }],
        repeatDecisions: [],
      }),
    );
    const extract = createNarrativeExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["a", "b", "cb", "en"]), repeatCounts: initRepeatCounts() },
      "admitted overnight",
    );
    expect(result.proposals).toEqual([
      { action: { fieldId: "cb", type: "answer", value: "true" }, quote: { turnIndex: 0, text: "admitted overnight" } },
    ]);
  });

  it("drops a checkbox candidate whose value isn't literally \"true\" or \"false\"", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "cb", kind: "value", value: "yes", quote: { turnIndex: 0, text: "admitted overnight" } }],
        repeatDecisions: [],
      }),
    );
    const extract = createNarrativeExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["a", "b", "cb", "en"]), repeatCounts: initRepeatCounts() },
      "admitted overnight",
    );
    expect(result.proposals).toEqual([]);
    expect(result.rejected[0].reason).toBe("not_a_legal_option");
  });

  it("drops an enum candidate whose value isn't a legal option", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "en", kind: "value", value: "Gamma", quote: { turnIndex: 0, text: "picked gamma" } }],
        repeatDecisions: [],
      }),
    );
    const extract = createNarrativeExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["a", "b", "cb", "en"]), repeatCounts: initRepeatCounts() },
      "picked gamma",
    );
    expect(result.rejected[0].reason).toBe("not_a_legal_option");
  });

  it("refuses a candidate targeting a repeat-instance-2+ field the same way an unknown field id is refused — it's simply not in the offered fields", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [{ fieldId: "p2-name", kind: "value", value: "lisinopril", quote: { turnIndex: 0, text: "lisinopril" } }],
        repeatDecisions: [],
      }),
    );
    // Only instance 1's topic/field is ever passed in — narrativePassFields()
    // (exercised for real by createNarrativeExtractFn) would already exclude
    // a "p2-name" field even if it existed in a fuller manifest; this proves
    // the validator refuses a stray proposal for it too, defense in depth.
    const extract = createNarrativeExtractFn(client, [REPEAT_TOPIC_1], [FIELD_P1]);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["p1"]), repeatCounts: initRepeatCounts() },
      "lisinopril",
    );
    expect(result.proposals).toEqual([]);
    expect(result.rejected[0].reason).toBe("unknown_field");
  });

  it("returns a grounded repeat decision", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecisions: [
          { repeatGroup: "suspect-product", count: 2, quote: { turnIndex: 0, text: "two suspect products" } },
        ],
      }),
    );
    const extract = createNarrativeExtractFn(client, [REPEAT_TOPIC_1, REPEAT_TOPIC_2], [FIELD_P1]);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["p1"]), repeatCounts: initRepeatCounts() },
      "two suspect products, amoxicillin and a sulfa drug",
    );
    expect(result.repeatDecisions).toEqual([{ repeatGroup: "suspect-product", count: 2 }]);
  });

  it("drops a repeat decision whose count exceeds the group's real max instance count, even with a real grounding quote", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecisions: [
          { repeatGroup: "suspect-product", count: 3, quote: { turnIndex: 0, text: "three suspect drugs" } },
        ],
      }),
    );
    // suspect-product's real topics cap it at 2 instances — [REPEAT_TOPIC_1,
    // REPEAT_TOPIC_2] here mirrors that, same as the real TOPICS would.
    const extract = createNarrativeExtractFn(client, [REPEAT_TOPIC_1, REPEAT_TOPIC_2], [FIELD_P1]);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["p1"]), repeatCounts: initRepeatCounts() },
      "she was on three suspect drugs when it started",
    );
    // Not just "dropped from repeatDecisions" — proposals must stay intact
    // too: this is the exact scenario that used to throw inside
    // applyNarrativeProposals and discard a whole confirmed batch.
    expect(result.repeatDecisions).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it("drops a repeat decision whose quote is not real", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecisions: [
          { repeatGroup: "suspect-product", count: 2, quote: { turnIndex: 0, text: "a sentence never said" } },
        ],
      }),
    );
    const extract = createNarrativeExtractFn(client, [REPEAT_TOPIC_1], [FIELD_P1]);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["p1"]), repeatCounts: initRepeatCounts() },
      "just the one product",
    );
    expect(result.repeatDecisions).toEqual([]);
  });

  it("accepts more than one repeat decision from the same narrative, one per group", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecisions: [
          { repeatGroup: "suspect-product", count: 2, quote: { turnIndex: 0, text: "two suspects" } },
          { repeatGroup: "concomitant-medication", count: 3, quote: { turnIndex: 0, text: "three others" } },
        ],
      }),
    );
    const extract = createNarrativeExtractFn(
      client,
      [REPEAT_TOPIC_1, REPEAT_TOPIC_2, ...CONCOMITANT_TOPICS_UP_TO_3],
      [FIELD_P1, FIELD_C1],
    );
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["p1", "c1"]), repeatCounts: initRepeatCounts() },
      "two suspects, and three others",
    );
    expect(result.repeatDecisions).toEqual([
      { repeatGroup: "suspect-product", count: 2 },
      { repeatGroup: "concomitant-medication", count: 3 },
    ]);
  });

  it("keeps only the first accepted decision when the model proposes two for the same group", async () => {
    // concomitant-medication (real max 10), not suspect-product (real max
    // 2): both proposed counts need to be independently in-range so this
    // test proves dedup specifically, not the range check from the
    // previous test rejecting the second one before dedup ever sees it.
    vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({
        candidates: [],
        repeatDecisions: [
          { repeatGroup: "concomitant-medication", count: 2, quote: { turnIndex: 0, text: "two others" } },
          { repeatGroup: "concomitant-medication", count: 3, quote: { turnIndex: 0, text: "three others" } },
        ],
      }),
    );
    const extract = createNarrativeExtractFn(client, CONCOMITANT_TOPICS_UP_TO_3, [FIELD_C1]);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["c1"]), repeatCounts: initRepeatCounts() },
      "two others, or maybe three others",
    );
    expect(result.repeatDecisions).toEqual([{ repeatGroup: "concomitant-medication", count: 2 }]);
  });

  it("fails closed (nothing proposed) when structured output parsing fails", async () => {
    vi.spyOn(client.messages, "parse").mockResolvedValue(fakeParsedResponse(null));
    const extract = createNarrativeExtractFn(client, [TOPIC], FIELDS);
    const result = await extract(
      { transcript: [], record: unaskedRecordFor(["a", "b", "cb", "en"]), repeatCounts: initRepeatCounts() },
      "42",
    );
    expect(result).toEqual({ proposals: [], repeatDecisions: [], rejected: [] });
  });

  it("short-circuits with no model call once every field is already resolved", async () => {
    const parseSpy = vi.spyOn(client.messages, "parse");
    const record = initAgenda();
    const resolvedRecord: AgendaRecord = {};
    for (const [id] of Object.entries(record)) resolvedRecord[id] = { state: "declined" };
    const extract = createNarrativeExtractFn(client);
    const result = await extract(
      { transcript: [], record: resolvedRecord, repeatCounts: initRepeatCounts() },
      "nothing more to add",
    );
    expect(result).toEqual({ proposals: [], repeatDecisions: [], rejected: [] });
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("sends the narrative text as the sole clinician turn", async () => {
    const parseSpy = vi.spyOn(client.messages, "parse").mockResolvedValue(
      fakeParsedResponse({ candidates: [], repeatDecisions: [] }),
    );
    const extract = createNarrativeExtractFn(client, [TOPIC], FIELDS);
    await extract(
      { transcript: [], record: unaskedRecordFor(["a", "b", "cb", "en"]), repeatCounts: initRepeatCounts() },
      "the opening narrative",
    );
    const call = parseSpy.mock.calls[0][0] as { messages: Array<{ content: string }> };
    expect(call.messages[0].content).toContain("[0] CLINICIAN: the opening narrative");
  });
});

describe("applyNarrativeProposals", () => {
  it("writes actions through the same Agenda write path processTurn() uses", () => {
    const record = unaskedRecordFor(["a", "b"]);
    const result = applyNarrativeProposals(
      record,
      initRepeatCounts(),
      [{ fieldId: "a", type: "answer", value: "42" }],
      [],
    );
    expect(result.record.a).toEqual({ state: "answered", value: "42" });
    expect(result.record.b).toEqual({ state: "unasked" });
  });

  it("applies a repeat decision via setRepeatCount", () => {
    const result = applyNarrativeProposals({}, initRepeatCounts(), [], [{ repeatGroup: "suspect-product", count: 2 }], [
      REPEAT_TOPIC_1,
      { ...REPEAT_TOPIC_1, id: "g2", fieldIds: ["p2"], repeatInstance: 2 },
    ]);
    expect(result.repeatCounts).toEqual({ "suspect-product": 2 });
  });

  it("applies multiple repeat decisions across different groups in one batch", () => {
    const topics: Topic[] = [
      REPEAT_TOPIC_1,
      { ...REPEAT_TOPIC_1, id: "c1", repeatGroup: "concomitant-medication", fieldIds: ["c1"] },
    ];
    const result = applyNarrativeProposals(
      {},
      initRepeatCounts(),
      [],
      [
        { repeatGroup: "suspect-product", count: 1 },
        { repeatGroup: "concomitant-medication", count: 1 },
      ],
      topics,
    );
    expect(result.repeatCounts).toEqual({ "suspect-product": 1, "concomitant-medication": 1 });
  });

  it("leaves the record and repeatCounts untouched given empty batches", () => {
    const record = unaskedRecordFor(["a"]);
    const repeatCounts: RepeatCounts = {};
    const result = applyNarrativeProposals(record, repeatCounts, [], []);
    expect(result.record).toEqual(record);
    expect(result.repeatCounts).toEqual(repeatCounts);
  });
});
