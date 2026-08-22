import { describe, expect, it } from "vitest";
import {
  FORM_3500_FIELDS,
  FORM_3500_SECTIONS,
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
});
