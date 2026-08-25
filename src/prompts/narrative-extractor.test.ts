import { describe, expect, it } from "vitest";
import { FORM_3500_FIELDS, type FormFieldSpec } from "../lib/form-3500-fields";
import { NARRATIVE_EXTRACTION_RESPONSE_SCHEMA, buildNarrativeExtractionUserContent } from "./narrative-extractor";

function field(
  id: string,
  type: FormFieldSpec["type"],
  label: string,
  options?: string[],
): FormFieldSpec {
  return { id, section: "A", pdfFieldName: `f.${id}[0]`, label, type, required: false, options };
}

const TEXT_FIELD = field("t", "text", "Field T");
const DATE_FIELD = field("d", "date", "Field D");
const CHECKBOX_FIELD = field("cb", "checkbox", "Field CB");
const ENUM_FIELD = field("en", "enum", "Field EN", [" ", "Alpha", "Beta"]);

describe("buildNarrativeExtractionUserContent", () => {
  it("includes the narrative text as the sole, index-0 clinician turn", () => {
    const content = buildNarrativeExtractionUserContent("42-year-old woman on amoxicillin.", [TEXT_FIELD]);
    expect(content).toContain("[0] CLINICIAN: 42-year-old woman on amoxicillin.");
  });

  it("lists a text/date field's id and label with no legal-value enumeration", () => {
    const content = buildNarrativeExtractionUserContent("narrative", [TEXT_FIELD, DATE_FIELD]);
    expect(content).toContain("t (text): Field T");
    expect(content).toContain("d (date): Field D");
  });

  it("tells the model a checkbox field's only two legal values", () => {
    const content = buildNarrativeExtractionUserContent("narrative", [CHECKBOX_FIELD]);
    expect(content).toMatch(/cb \(checkbox.*"true".*"false"/);
    expect(content).toContain("Field CB");
  });

  it("lists an enum field's exact legal options, excluding the blank placeholder", () => {
    const content = buildNarrativeExtractionUserContent("narrative", [ENUM_FIELD]);
    expect(content).toContain('"Alpha"');
    expect(content).toContain('"Beta"');
    expect(content).not.toMatch(/"\s*"/); // the blank " " option never rendered as a quoted legal value
  });

  it("excludes a disallowed enum value from the legal-options list, even though it's a real manifest option", () => {
    const disallowedField = FORM_3500_FIELDS.find((f) => f.id === "Page4.Prod1.Prod1StrengthUnit")!;
    const content = buildNarrativeExtractionUserContent("narrative", [disallowedField]);
    expect(content).not.toContain("AS NECESSARY - AN");
  });

  it("excludes a field entirely absent from the given open-fields list", () => {
    const content = buildNarrativeExtractionUserContent("narrative", [TEXT_FIELD]);
    expect(content).not.toContain("Field D");
  });

  it("names every repeat group the model may detect", () => {
    const content = buildNarrativeExtractionUserContent("narrative", [TEXT_FIELD]);
    expect(content).toContain("suspect-product");
    expect(content).toContain("concomitant-medication");
  });

  it("tells the model instance-2+ fields are never a valid target, even for a group it may detect", () => {
    const content = buildNarrativeExtractionUserContent("narrative", [TEXT_FIELD]);
    expect(content).toMatch(/never propose a field candidate for a second or later instance/i);
  });
});

describe("NARRATIVE_EXTRACTION_RESPONSE_SCHEMA", () => {
  it("accepts a well-formed response with field candidates and no repeat decisions", () => {
    const result = NARRATIVE_EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [
        { fieldId: "a", kind: "value", value: "42", quote: { turnIndex: 0, text: "42" } },
        { fieldId: "b", kind: "unknown", quote: { turnIndex: 0, text: "no idea" } },
      ],
      repeatDecisions: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts a response carrying more than one repeat decision", () => {
    const result = NARRATIVE_EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [],
      repeatDecisions: [
        { repeatGroup: "suspect-product", count: 2, quote: { turnIndex: 0, text: "two suspects" } },
        { repeatGroup: "concomitant-medication", count: 3, quote: { turnIndex: 0, text: "three others" } },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a candidate with an unrecognized kind", () => {
    const result = NARRATIVE_EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [{ fieldId: "a", kind: "bogus", quote: { turnIndex: 0, text: "x" } }],
      repeatDecisions: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a repeatDecision with an unrecognized repeatGroup", () => {
    const result = NARRATIVE_EXTRACTION_RESPONSE_SCHEMA.safeParse({
      candidates: [],
      repeatDecisions: [{ repeatGroup: "not-a-real-group", count: 1, quote: { turnIndex: 0, text: "x" } }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a response missing repeatDecisions entirely — an empty array must be explicit, not omitted", () => {
    const result = NARRATIVE_EXTRACTION_RESPONSE_SCHEMA.safeParse({ candidates: [] });
    expect(result.success).toBe(false);
  });
});
