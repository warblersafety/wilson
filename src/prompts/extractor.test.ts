import { describe, expect, it } from "vitest";
import { FORM_3500_FIELDS, type FormFieldSpec } from "../lib/form-3500-fields";
import type { TalkTurn } from "../lib/talk";
import type { NextStep, Topic } from "../lib/topics";
import {
  EXTRACTION_RESPONSE_SCHEMA,
  buildExtractionUserContent,
  buildFollowUpExtractorSystem,
  buildFollowUpUserContent,
} from "./extractor";

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

// Issue #44's widened per-turn sweep: unlike buildExtractionUserContent()
// above (scoped to a single step's ≤3 fields, kept unchanged for the
// pre-widening "narrow" baseline scripts/cost-widened-turn.ts compares
// against), the system prompt itself now carries the FULL field manifest
// — design.md's cost posture: "the cached prefix carries the full
// manifest and option lists, invariant across the session."
describe("buildFollowUpExtractorSystem", () => {
  const FIELDS: FormFieldSpec[] = [
    { id: "a", section: "A", pdfFieldName: "f.a[0]", label: "Field A", type: "text", required: false },
    {
      id: "en",
      section: "A",
      pdfFieldName: "f.en[0]",
      label: "Field Enum",
      type: "enum",
      required: false,
      options: [" ", "X", "Y"],
    },
  ];

  it("lists every given field's id, type, and label", () => {
    const system = buildFollowUpExtractorSystem(FIELDS);
    expect(system).toContain("a (text): Field A");
    expect(system).toContain("en (enum");
    expect(system).toContain("Field Enum");
  });

  it("includes an enum field's legal options, excluding the blank placeholder", () => {
    const system = buildFollowUpExtractorSystem(FIELDS);
    expect(system).toContain('"X"');
    expect(system).toContain('"Y"');
    expect(system).not.toMatch(/"\s*"/); // the blank option never rendered as a quoted choice
  });

  it("marks a repeat-instance-2+ field distinctly from instance 1", () => {
    const topics: Topic[] = [
      { id: "g1", section: "D", label: "g1", fieldIds: ["p1"], repeatGroup: "suspect-product", repeatInstance: 1 },
      { id: "g2", section: "D", label: "g2", fieldIds: ["p2"], repeatGroup: "suspect-product", repeatInstance: 2 },
    ];
    const system = buildFollowUpExtractorSystem(
      [
        { id: "p1", section: "D", pdfFieldName: "f.p1[0]", label: "Product 1 Name", type: "text", required: false },
        { id: "p2", section: "D", pdfFieldName: "f.p2[0]", label: "Product 2 Name", type: "text", required: false },
      ],
      topics,
    );
    const p1Line = system.split("\n").find((line) => line.includes(" p1 "));
    const p2Line = system.split("\n").find((line) => line.includes(" p2 "));
    expect(p1Line).not.toMatch(/later repeat instance/i);
    expect(p2Line).toMatch(/later repeat instance/i);
  });

  it("against the real manifest: renders all 227 fields, is deterministic across calls (the invariant cache prefix)", () => {
    const first = buildFollowUpExtractorSystem(FORM_3500_FIELDS);
    const second = buildFollowUpExtractorSystem(FORM_3500_FIELDS);
    expect(first).toBe(second);
    for (const f of FORM_3500_FIELDS.slice(0, 5).concat(FORM_3500_FIELDS.slice(-5))) {
      expect(first).toContain(f.id);
    }
  });

  it("against the real manifest: never surfaces a raw PDF /Opt code", () => {
    const system = buildFollowUpExtractorSystem(FORM_3500_FIELDS);
    expect(system).not.toMatch(/\/Opt\d/i);
  });
});

describe("buildFollowUpUserContent", () => {
  const FIELDS: FormFieldSpec[] = [
    { id: "a", section: "A", pdfFieldName: "f.a[0]", label: "Field A", type: "text", required: false },
    { id: "b", section: "A", pdfFieldName: "f.b[0]", label: "Field B", type: "date", required: false },
  ];
  const TOPIC: Topic = { id: "t1", section: "A", label: "Topic 1", fieldIds: ["a", "b"], repeatGroup: null, repeatInstance: null };
  const TRANSCRIPT: TalkTurn[] = [
    { role: "talker", text: "Tell me about the patient." },
    { role: "clinician", text: "42 years old, born on 3/15." },
  ];

  it("for a topic step, includes the numbered transcript", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a"] };
    const content = buildFollowUpUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toContain("[0] TALKER: Tell me about the patient.");
    expect(content).toContain("[1] CLINICIAN: 42 years old, born on 3/15.");
  });

  it("for a topic step, instructs the model to cite only the current (last) turn", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a"] };
    const content = buildFollowUpUserContent(step, FIELDS, TRANSCRIPT);
    expect(content.toLowerCase()).toMatch(/current turn|last turn|latest message/);
  });

  it("for a topic step, lists the given open fields by id", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a"] };
    const content = buildFollowUpUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toContain("a");
    expect(content).toContain("b");
  });

  it("for a topic step, names which fields this turn's own ask covered", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a"] };
    const content = buildFollowUpUserContent(step, [FIELDS[0]], TRANSCRIPT);
    expect(content).toContain("a");
  });

  it("for a topic step, tells the model this is not a repeat-group question", () => {
    const step: NextStep = { kind: "topic", topic: TOPIC, fieldIds: ["a"] };
    const content = buildFollowUpUserContent(step, FIELDS, TRANSCRIPT);
    expect(content).toMatch(/not a repeat-group question/i);
  });

  it("for a repeat-decision step, names the group and prior instance", () => {
    const step: NextStep = { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 };
    const content = buildFollowUpUserContent(step, [], TRANSCRIPT);
    expect(content).toContain("suspect-product");
    expect(content).toContain("instance 1");
  });

  it("for a repeat-decision step, still allows ordinary field candidates alongside the repeatDecision", () => {
    const step: NextStep = { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 };
    const content = buildFollowUpUserContent(step, [], TRANSCRIPT);
    expect(content.toLowerCase()).toMatch(/also propose|ordinary field candidates/);
  });

  it("for a done step, tells the model to propose nothing", () => {
    const step: NextStep = { kind: "done" };
    const content = buildFollowUpUserContent(step, [], TRANSCRIPT);
    expect(content).toMatch(/propose nothing/i);
  });
});
