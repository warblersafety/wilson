// facsimileValue() is the report chrome's (Issue #67) half of design.md's
// "one mapping truth": scripts/fill-3500.py's render_value() decides what
// the PDF exporter writes; this decides what the HTML facsimile shows for
// the same (field, entry) pair. The two are independently tested here and
// in scripts/tests/test_report_chrome_reference_case.py against the SAME
// checked-in expectations file (report-chrome-reference-case.expected.json)
// — there is no runtime bridge between vitest and pytest, so that shared
// file, not a direct call, is the equality proof.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { initAgenda, type AgendaEntry, type AgendaRecord } from "./agenda";
import {
  doseWithUnitAndFrequency,
  facsimileValue,
  productIdentity,
  valueWithCheckedUnit,
} from "./form-3500-facsimile";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";

function textField(overrides: Partial<FormFieldSpec> = {}): FormFieldSpec {
  return {
    id: "F.text",
    section: "A",
    pdfFieldName: "form.F.text[0]",
    label: "Text field",
    type: "text",
    required: false,
    ...overrides,
  };
}

function dateField(overrides: Partial<FormFieldSpec> = {}): FormFieldSpec {
  return { ...textField(), id: "F.date", pdfFieldName: "form.F.date[0]", type: "date", ...overrides };
}

function checkboxField(overrides: Partial<FormFieldSpec> = {}): FormFieldSpec {
  return { ...textField(), id: "F.check", pdfFieldName: "form.F.check[0]", type: "checkbox", ...overrides };
}

function enumField(options: string[] = [" ", "A", "B"], overrides: Partial<FormFieldSpec> = {}): FormFieldSpec {
  return { ...textField(), id: "F.enum", pdfFieldName: "form.F.enum[0]", type: "enum", options, ...overrides };
}

describe("facsimileValue — text fields", () => {
  it("answered returns the value", () => {
    expect(facsimileValue(textField(), { state: "answered", value: "hi" })).toBe("hi");
  });

  it("unknown returns the sentinel", () => {
    expect(facsimileValue(textField(), { state: "unknown" })).toBe("Unknown");
  });

  // docs/ask-copy.md rule 7's text-ask negative (Issue #121): MH-1/LD-1/
  // AC-1's machinery-forced "None" reaches this renderer as an ordinary
  // answered value — pinned explicitly (not just covered incidentally by
  // "answered returns the value" above) because "None" is also Python's
  // null spelling, the exact collision rule 7 exists to prevent.
  it("a text-ask negative's answered 'None' renders as the literal word, never the unknown sentinel", () => {
    const rendered = facsimileValue(textField(), { state: "answered", value: "None" });
    expect(rendered).toBe("None");
    expect(rendered).not.toBe("Unknown");
  });

  it("declined returns the sentinel", () => {
    expect(facsimileValue(textField(), { state: "declined" })).toBe("Declined to answer");
  });

  it("unknown and declined sentinels differ", () => {
    expect(facsimileValue(textField(), { state: "unknown" })).not.toBe(
      facsimileValue(textField(), { state: "declined" }),
    );
  });

  it("unasked returns null", () => {
    expect(facsimileValue(textField(), { state: "unasked" })).toBeNull();
  });

  it("a field entirely absent from the record (undefined) returns null, same as unasked", () => {
    expect(facsimileValue(textField(), undefined)).toBeNull();
  });

  it("date fields behave like text", () => {
    expect(facsimileValue(dateField(), { state: "unknown" })).toBe("Unknown");
    expect(facsimileValue(dateField(), { state: "answered", value: "2026-08-19" })).toBe("2026-08-19");
  });

  it("answered with no value renders as unasked rather than throwing", () => {
    // fill-3500.py raises FillError here (a record that reaches export
    // must never claim "answered" with nothing to show) — the facsimile
    // is a live preview during active data entry, not an export gate, so
    // it degrades to blank instead of taking the whole surface down.
    expect(facsimileValue(textField(), { state: "answered" })).toBeNull();
    expect(facsimileValue(textField(), { state: "answered", value: "" })).toBeNull();
    expect(facsimileValue(textField(), { state: "answered", value: "   " })).toBeNull();
  });
});

describe("facsimileValue — checkbox fields", () => {
  it("answered true returns true", () => {
    expect(facsimileValue(checkboxField(), { state: "answered", value: "true" })).toBe(true);
  });

  it("answered false returns false", () => {
    expect(facsimileValue(checkboxField(), { state: "answered", value: "false" })).toBe(false);
  });

  it("a non-boolean answered value renders as unasked rather than throwing", () => {
    expect(facsimileValue(checkboxField(), { state: "answered", value: "yes" })).toBeNull();
  });

  it("unknown returns null — a checkbox has no third visual state", () => {
    expect(facsimileValue(checkboxField(), { state: "unknown" })).toBeNull();
  });

  it("declined returns null", () => {
    expect(facsimileValue(checkboxField(), { state: "declined" })).toBeNull();
  });

  it("unasked returns null", () => {
    expect(facsimileValue(checkboxField(), { state: "unasked" })).toBeNull();
  });
});

describe("facsimileValue — enum fields", () => {
  it("answered with a legal option returns the value", () => {
    expect(facsimileValue(enumField(), { state: "answered", value: "A" })).toBe("A");
  });

  it("answered with a value outside options renders as unasked rather than throwing", () => {
    expect(facsimileValue(enumField(), { state: "answered", value: "Z" })).toBeNull();
  });

  it("unknown returns the sentinel", () => {
    expect(facsimileValue(enumField(), { state: "unknown" })).toBe("Unknown");
  });

  it("a disallowed override value is rejected even though options[] carries it", () => {
    // Mirrors Prod1StrengthUnit's real quirk (form-3500-fields.ts,
    // DISALLOWED_ENUM_VALUES) via legalEnumOptions() — the one shared
    // source every enum consumer in this codebase reads from.
    const field = enumField([" ", "AS NECESSARY - AN", "MILLIGRAM(S) - MG"], {
      id: "Page4.Prod1.Prod1StrengthUnit",
    });
    expect(facsimileValue(field, { state: "answered", value: "AS NECESSARY - AN" })).toBeNull();
    expect(facsimileValue(field, { state: "answered", value: "MILLIGRAM(S) - MG" })).toBe("MILLIGRAM(S) - MG");
  });
});

describe("facsimileValue — reference-case equality (design.md 'one mapping truth')", () => {
  const fixturesDir = join(__dirname, "..", "..", "scripts", "fixtures");
  const record: Record<string, AgendaEntry> = JSON.parse(
    readFileSync(join(fixturesDir, "report-chrome-reference-case.json"), "utf-8"),
  );
  const expected: Record<string, string | boolean | null> = JSON.parse(
    readFileSync(join(fixturesDir, "report-chrome-reference-case.expected.json"), "utf-8"),
  );

  // The real manifest, not a synthetic fixture — FORM_3500_FIELDS is the
  // "same field-mapping source the PDF exporter uses" design.md requires.
  const fieldsById = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));

  it("the real manifest has 227 fields", () => {
    expect(fieldsById.size).toBe(227);
  });

  for (const [fieldId, expectedValue] of Object.entries(expected)) {
    it(`${fieldId} matches the exporter's rendered value (expected ${JSON.stringify(expectedValue)})`, () => {
      const field = fieldsById.get(fieldId);
      expect(field, `${fieldId} is not a real manifest field`).toBeDefined();
      const actual = facsimileValue(field!, record[fieldId]);
      expect(actual).toEqual(expectedValue);
    });
  }
});

// Composition tests (reviewer pass, PR #75, finding F1 — a value field
// silently rendered without its paired unit/strength/manufacturer
// fields, even when those were answered and reach the real PDF).
function recordWith(overrides: Record<string, AgendaEntry>): AgendaRecord {
  return { ...initAgenda(), ...overrides };
}

describe("valueWithCheckedUnit", () => {
  const AGE_UNITS = [
    ["Page1.SecA_Patient.AgeYears", "yr"],
    ["Page1.SecA_Patient.AgeMonths", "mo"],
    ["Page1.SecA_Patient.AgeWeeks", "wk"],
    ["Page1.SecA_Patient.AgeDays", "day"],
  ] as const;

  it("composes the checked unit onto an answered value", () => {
    const record = recordWith({
      "Page1.SecA_Patient.AgeValue": { state: "answered", value: "42" },
      "Page1.SecA_Patient.AgeYears": { state: "answered", value: "true" },
    });
    expect(valueWithCheckedUnit(record, "Page1.SecA_Patient.AgeValue", AGE_UNITS)).toEqual({
      text: "42 yr",
      muted: false,
    });
  });

  it("uses whichever unit checkbox is actually answered true, not just the first in the list", () => {
    const record = recordWith({
      "Page1.SecA_Patient.AgeValue": { state: "answered", value: "7" },
      "Page1.SecA_Patient.AgeMonths": { state: "answered", value: "true" },
    });
    expect(valueWithCheckedUnit(record, "Page1.SecA_Patient.AgeValue", AGE_UNITS)).toEqual({
      text: "7 mo",
      muted: false,
    });
  });

  it("renders the bare value when no unit has been answered yet — never invents one", () => {
    const record = recordWith({ "Page1.SecA_Patient.AgeValue": { state: "answered", value: "42" } });
    expect(valueWithCheckedUnit(record, "Page1.SecA_Patient.AgeValue", AGE_UNITS)).toEqual({
      text: "42",
      muted: false,
    });
  });

  it("passes through the sentinel untouched when the value itself is unknown — never 'Unknown yr'", () => {
    const record = recordWith({
      "Page1.SecA_Patient.AgeValue": { state: "unknown" },
      "Page1.SecA_Patient.AgeYears": { state: "answered", value: "true" },
    });
    expect(valueWithCheckedUnit(record, "Page1.SecA_Patient.AgeValue", AGE_UNITS)).toEqual({
      text: "Unknown",
      muted: true,
    });
  });

  it("renders nothing when the value is unasked, regardless of the unit", () => {
    const record = recordWith({ "Page1.SecA_Patient.AgeYears": { state: "answered", value: "true" } });
    expect(valueWithCheckedUnit(record, "Page1.SecA_Patient.AgeValue", AGE_UNITS)).toEqual({
      text: null,
      muted: false,
    });
  });
});

describe("doseWithUnitAndFrequency", () => {
  it("composes dose, unit, and frequency into one value", () => {
    const record = recordWith({
      "Page4.Prod1.Prod1Dose": { state: "answered", value: "875" },
      "Page4.Prod1.Prod1DoseUnit": { state: "answered", value: "MILLIGRAM(S) - MG" },
      "Page4.Prod1.Prod1Freq": { state: "answered", value: "BID" },
    });
    expect(doseWithUnitAndFrequency(record)).toEqual({ text: "875 MILLIGRAM(S) - MG BID", muted: false });
  });

  it("renders the bare dose when unit and frequency aren't answered yet", () => {
    const record = recordWith({ "Page4.Prod1.Prod1Dose": { state: "answered", value: "875" } });
    expect(doseWithUnitAndFrequency(record)).toEqual({ text: "875", muted: false });
  });

  it("renders the dose's own sentinel when the dose is declined, ignoring a separately-answered unit", () => {
    const record = recordWith({
      "Page4.Prod1.Prod1Dose": { state: "declined" },
      "Page4.Prod1.Prod1DoseUnit": { state: "answered", value: "MILLIGRAM(S) - MG" },
    });
    expect(doseWithUnitAndFrequency(record)).toEqual({ text: "Declined to answer", muted: true });
  });
});

describe("productIdentity", () => {
  it("composes name, strength, unit, and manufacturer into one value", () => {
    const record = recordWith({
      "Page4.Prod1.Prod1Name": { state: "answered", value: "Amoxicillin" },
      "Page4.Prod1.Prod1Strength": { state: "answered", value: "875" },
      "Page4.Prod1.Prod1StrengthUnit": { state: "answered", value: "MILLIGRAM(S) - MG" },
      "Page4.Prod1.Prod1ManuComp": { state: "answered", value: "Aurobindo Pharma" },
    });
    expect(productIdentity(record)).toEqual({
      text: "Amoxicillin 875 MILLIGRAM(S) - MG — Aurobindo Pharma",
      muted: false,
    });
  });

  it("renders the bare name when nothing else has been answered", () => {
    const record = recordWith({ "Page4.Prod1.Prod1Name": { state: "answered", value: "Amoxicillin" } });
    expect(productIdentity(record)).toEqual({ text: "Amoxicillin", muted: false });
  });

  it("composes strength without a unit when only strength is answered", () => {
    const record = recordWith({
      "Page4.Prod1.Prod1Name": { state: "answered", value: "Amoxicillin" },
      "Page4.Prod1.Prod1Strength": { state: "answered", value: "875" },
    });
    expect(productIdentity(record)).toEqual({ text: "Amoxicillin 875", muted: false });
  });

  it("renders the name's own sentinel when the name is unknown, ignoring an answered manufacturer", () => {
    const record = recordWith({
      "Page4.Prod1.Prod1Name": { state: "unknown" },
      "Page4.Prod1.Prod1ManuComp": { state: "answered", value: "Aurobindo Pharma" },
    });
    expect(productIdentity(record)).toEqual({ text: "Unknown", muted: true });
  });
});
