import { describe, expect, it } from "vitest";
import {
  DISALLOWED_ENUM_VALUES,
  FORM_3500_FIELDS,
  FORM_3500_SECTIONS,
  legalEnumOptions,
  type FormFieldType,
  type FormSection,
} from "./form-3500-fields";

const VALID_TYPES: FormFieldType[] = ["text", "date", "checkbox", "enum"];
const VALID_SECTIONS = Object.keys(FORM_3500_SECTIONS) as FormSection[];

describe("FORM_3500_FIELDS", () => {
  it("has no duplicate ids", () => {
    const ids = FORM_3500_FIELDS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate pdfFieldNames", () => {
    const names = FORM_3500_FIELDS.map((f) => f.pdfFieldName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("gives every field a non-empty label and pdfFieldName", () => {
    for (const f of FORM_3500_FIELDS) {
      expect(f.label.trim().length).toBeGreaterThan(0);
      expect(f.pdfFieldName.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives every field a valid section", () => {
    for (const f of FORM_3500_FIELDS) {
      expect(VALID_SECTIONS).toContain(f.section);
    }
  });

  it("gives every field a valid type", () => {
    for (const f of FORM_3500_FIELDS) {
      expect(VALID_TYPES).toContain(f.type);
    }
  });

  it("gives every field a boolean required flag", () => {
    for (const f of FORM_3500_FIELDS) {
      expect(typeof f.required).toBe("boolean");
    }
  });

  it("carries non-empty options if and only if the field is an enum", () => {
    for (const f of FORM_3500_FIELDS) {
      if (f.type === "enum") {
        expect(f.options?.length).toBeGreaterThan(0);
      } else {
        expect(f.options).toBeUndefined();
      }
    }
  });

  it("represents every section from the real form", () => {
    const seen = new Set(FORM_3500_FIELDS.map((f) => f.section));
    for (const section of VALID_SECTIONS) {
      expect(seen.has(section)).toBe(true);
    }
  });

  // Regression guard: this count comes from the current authoritative FDA PDF
  // (fda.gov/media/76299/download). A change here means the extraction or its
  // filtering changed and needs re-examination, not a silent bump.
  it("has exactly 227 fields", () => {
    expect(FORM_3500_FIELDS.length).toBe(227);
  });

  // id is meant to be mechanically derived from pdfFieldName (strip the
  // "topmostSubform[0]." prefix and every "[N]" index), not hand-typed
  // independently — this guards against the two drifting apart.
  it("derives every id from its own pdfFieldName", () => {
    for (const f of FORM_3500_FIELDS) {
      const derived = f.pdfFieldName
        .replace(/^topmostSubform\[0\]\./, "")
        .replace(/\[\d+\]/g, "");
      expect(f.id).toBe(derived);
    }
  });

  // Regression guard for a transcription bug caught in review: several
  // TestDataTable rows got labeled with the wrong row number because the
  // PDF's own "RowN[0]" subform containers don't reliably match the row a
  // field actually belongs to (rows 5-8 are scattered across containers).
  // The field's own trailing digit (TestData5, TDate8, ...) is the
  // reliable row number — labels must agree with it, not the container.
  it("labels every TestDataTable row field with its own field-name row number", () => {
    const rowFieldPattern =
      /\.(?:TestData|TLowRange|THighRange|TDate)(\d+)\[0\]$/;
    for (const f of FORM_3500_FIELDS) {
      const match = f.pdfFieldName.match(rowFieldPattern);
      if (!match) continue;
      expect(f.label).toContain(`Row ${match[1]} —`);
    }
  });
});

// The single shared source for "which enum options are actually legal to
// propose or offer" (this file's own DISALLOWED_ENUM_VALUES comment names
// the intent: "one TS definition, not three") — extraction-validator.ts's
// isLegalFixedChoiceValue(), src/prompts/narrative-extractor.ts's prompt
// rendering, and src/lib/ask.ts's option-aware phrasing (Issue #44) all
// call this instead of each re-deriving the blank-placeholder-and-
// disallowed-value filter independently.
describe("legalEnumOptions", () => {
  it("strips the manifest's own blank placeholder", () => {
    const field = FORM_3500_FIELDS.find((f) => f.id === "Page7.SecG_Reporter.Occupation")!;
    expect(field.options).toContain(" ");
    expect(legalEnumOptions(field)).not.toContain(" ");
    expect(legalEnumOptions(field).every((o) => o.trim().length > 0)).toBe(true);
  });

  it("strips a field's disallowed values, even though they're real members of options[]", () => {
    const field = FORM_3500_FIELDS.find((f) => f.id === "Page4.Prod1.Prod1StrengthUnit")!;
    expect(field.options).toContain("AS NECESSARY - AN");
    expect(legalEnumOptions(field)).not.toContain("AS NECESSARY - AN");
  });

  it("leaves every other real option untouched, in manifest order", () => {
    const field = FORM_3500_FIELDS.find((f) => f.id === "Page7.SecG_Reporter.Occupation")!;
    const expected = (field.options ?? []).filter((o) => o.trim().length > 0);
    expect(legalEnumOptions(field)).toEqual(expected);
  });

  it("returns an empty array for a field with no options at all (never thrown)", () => {
    const textField = FORM_3500_FIELDS.find((f) => f.type === "text")!;
    expect(legalEnumOptions(textField)).toEqual([]);
  });

  it("against the real manifest: every disallowed value named in DISALLOWED_ENUM_VALUES is actually excluded", () => {
    for (const [fieldId, disallowed] of Object.entries(DISALLOWED_ENUM_VALUES)) {
      const field = FORM_3500_FIELDS.find((f) => f.id === fieldId)!;
      const legal = legalEnumOptions(field);
      for (const value of disallowed) {
        expect(legal).not.toContain(value);
      }
    }
  });
});
