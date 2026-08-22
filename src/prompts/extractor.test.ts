import { describe, expect, it } from "vitest";
import type { FormFieldSpec } from "../lib/form-3500-fields";
import type { TalkTurn } from "../lib/talk";
import type { NextStep, Topic } from "../lib/topics";
import { EXTRACTION_RESPONSE_SCHEMA, buildExtractionUserContent } from "./extractor";

function field(id: string, type: FormFieldSpec["type"], label: string): FormFieldSpec {
  return { id, section: "A", pdfFieldName: `f.${id}[0]`, label, type, required: false };
}

const FIELD_A = field("a", "text", "Field A");
const FIELD_B = field("b", "date", "Field B");
const FIELD_C = field("c", "enum", "Field C");
const FIELDS = [FIELD_A, FIELD_B, FIELD_C];

const TOPIC: Topic = {
  id: "t1",
  section: "A",
  label: "Topic 1",
  fieldIds: ["a", "b"],
  repeatGroup: null,
  repeatInstance: null,
};

const TRANSCRIPT: TalkTurn[] = [
  { role: "talker", text: "Tell me about the patient." },
  { role: "clinician", text: "42 years old, born on 3/15." },
];

describe("buildExtractionUserContent", () => {
  it("for a topic step, lists only the step's open fields and excludes fields outside it", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a", "b"] };
    const content = buildExtractionUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toContain("a (text): Field A");
    expect(content).toContain("b (date): Field B");
    expect(content).not.toContain("Field C");
  });

  it("for a topic step, includes the numbered transcript with clinician/talker roles labeled", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a"] };
    const content = buildExtractionUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toContain("[0] TALKER: Tell me about the patient.");
    expect(content).toContain("[1] CLINICIAN: 42 years old, born on 3/15.");
  });

  it("for a topic step, tells the model this is not a repeat-group question", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a"] };
    const content = buildExtractionUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toMatch(/not a repeat-group question/i);
  });

  it("for a repeat-decision step, names the group and prior instance, with no open fields", () => {
    const step: NextStep = { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 };
    const content = buildExtractionUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toContain("suspect-product");
    expect(content).toContain("instance 1");
    expect(content).not.toContain("Open fields");
  });

  it("for a done step, tells the model to propose nothing", () => {
    const step: NextStep = { kind: "done" };
    const content = buildExtractionUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toMatch(/propose nothing/i);
  });
});

describe("EXTRACTION_RESPONSE_SCHEMA", () => {
  it("accepts a well-formed response with field candidates and a null repeatDecision", () => {
    const result = EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [
        { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 1, text: "42" } },
        { fieldId: "b", kind: "unknown", quote: { turnIndex: 1, text: "no idea" } },
      ],
      repeatDecision: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a response carrying a repeatDecision", () => {
    const result = EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [],
      repeatDecision: {
        repeatGroup: "suspect-product",
        count: 2,
        quote: { turnIndex: 1, text: "yes, a second one" },
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a candidate with an unrecognized kind", () => {
    const result = EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [{ fieldId: "a", kind: "bogus", quote: { turnIndex: 1, text: "x" } }],
      repeatDecision: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a repeatDecision with an unrecognized repeatGroup", () => {
    const result = EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [],
      repeatDecision: { repeatGroup: "not-a-real-group", count: 1, quote: { turnIndex: 0, text: "x" } },
    });
    expect(result.success).toBe(false);
  });
});
