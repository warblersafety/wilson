// The display-name module (docs/ask-copy.md rule 6). The point of this
// suite is coverage and non-leakage: every manifest field has an authored
// name, and no manifest label or PDF id can reach a clinician through it.
import { describe, expect, it } from "vitest";
import { displayName, displayNameFor, joinNames } from "./display-names";
import { FORM_3500_FIELDS } from "./form-3500-fields";

describe("displayName", () => {
  it("names all 227 manifest fields", () => {
    expect(FORM_3500_FIELDS).toHaveLength(227);
    for (const field of FORM_3500_FIELDS) {
      expect(() => displayName(field.id), field.id).not.toThrow();
      expect(displayName(field.id).length, field.id).toBeGreaterThan(0);
    }
  });

  it("gives every field a distinct name — a re-ask naming two facts must name two things", () => {
    const names = FORM_3500_FIELDS.map((f) => displayName(f.id));
    expect(new Set(names).size).toBe(names.length);
  });

  it("never renders a manifest label, a PDF id, or a template marker", () => {
    const labels = new Set(FORM_3500_FIELDS.map((f) => f.label));
    for (const field of FORM_3500_FIELDS) {
      const name = displayName(field.id);
      expect(labels.has(name), name).toBe(false);
      expect(name, name).not.toMatch(/Page\d|Prod\d\.|Sec[A-G]_/);
      expect(name, name).not.toContain("(yes or no)");
    }
  });

  it("keeps every name comma-free, so joining several stays unambiguous", () => {
    for (const field of FORM_3500_FIELDS) {
      expect(displayName(field.id), field.id).not.toContain(",");
    }
  });

  // Rule 6: "Checkbox facts render as fact phrases ('outcome:
  // hospitalization'), never as 'true/false'."
  it("names a checkbox as the fact it records", () => {
    expect(displayName("Page1.SecA_Patient.Hospital")).toBe("outcome: hospitalization");
    expect(displayName("Page1.SecA_Patient.SexF")).toBe("sex: female");
    expect(displayName("Page4.Prod1.Prod1AbatedNA")).toBe("improved after stopping: doesn't apply");
    for (const field of FORM_3500_FIELDS.filter((f) => f.type === "checkbox")) {
      expect(displayName(field.id).toLowerCase(), field.id).not.toMatch(/\btrue\b|\bfalse\b/);
    }
  });

  it("prefixes the second suspect product's names, and only those", () => {
    expect(displayName("Page4.Prod1.Prod1Name")).toBe("product name");
    expect(displayName("Page5.Prod2.Prod2Name")).toBe("product #2 product name");
    for (const field of FORM_3500_FIELDS) {
      expect(displayName(field.id).startsWith("product #2 "), field.id).toBe(
        field.id.startsWith("Page5.Prod2."),
      );
    }
  });

  // The two manifest id defects ask-copy.md records: rows 3-7's lab dates
  // and row 7's high range live under a `Row8.` path, and concomitant rows
  // 3-10 all spell their end-date leaf `Cell4`. Names come from the
  // reliable half of the id in each case.
  it("indexes the lab table from the leaf, past the Row8-prefixed date ids", () => {
    expect(displayName("Page3.TestDataTable.Row8.TDate3")).toBe("test 3 date");
    expect(displayName("Page3.TestDataTable.Row8.THighRange7")).toBe("test 7 result range (high)");
    expect(displayName("Page3.TestDataTable.Row1.TestData1")).toBe("test 1");
  });

  it("indexes the concomitant table from the row, past the shared Cell4 leaf", () => {
    expect(displayName("Page6.SecF_Other.Table1.Row1.End1")).toBe("other medication 1 stop");
    expect(displayName("Page6.SecF_Other.Table1.Row7.Cell4")).toBe("other medication 7 stop");
    expect(displayName("Page6.SecF_Other.Table1.Row10.Prod10")).toBe("other medication 10");
  });

  it("throws on an unnamed manifest field rather than falling back to its label", () => {
    expect(() => displayName("Page1.SecA_Patient.NoSuchField")).toThrow(/no authored display name/);
  });
});

describe("displayNameFor", () => {
  it("matches displayName for a real field", () => {
    expect(displayNameFor("Page1.SecA_Patient.AgeValue")).toBe("age");
  });

  // The shape the UI call sites need: a stored session can name a field a
  // later manifest no longer has, and a Read-back row is not the place to
  // crash.
  it("passes an id that is not a manifest field straight through", () => {
    expect(displayNameFor("not-a-field")).toBe("not-a-field");
  });
});

describe("joinNames", () => {
  it("joins one, two, and several", () => {
    expect(joinNames(["age"])).toBe("age");
    expect(joinNames(["age", "weight"])).toBe("age and weight");
    expect(joinNames(["age", "weight", "sex: male"])).toBe("age, weight, and sex: male");
  });

  it("refuses an empty list", () => {
    expect(() => joinNames([])).toThrow(/at least one/);
  });
});
