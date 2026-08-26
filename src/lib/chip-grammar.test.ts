// Pure logic for Issue #44's chip-driven follow-up loop — no React, no
// DOM. UI components (RepeatDecision.tsx, TopicFields.tsx, AskForm.tsx)
// stay thin wrappers, same convention as the rest of src/app/wizard.
import { describe, expect, it } from "vitest";
import { initAgenda } from "./agenda";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import type { Topic } from "./topics";
import { applyActionToFields, friendlyFailureMessage, repeatDecisionOptions, widgetTurnText } from "./chip-grammar";

const SUSPECT_PRODUCT_TOPICS: Topic[] = [
  { id: "p1", section: "D", label: "Suspect product 1", fieldIds: ["p1"], repeatGroup: "suspect-product", repeatInstance: 1 },
  { id: "p2", section: "D", label: "Suspect product 2", fieldIds: ["p2"], repeatGroup: "suspect-product", repeatInstance: 2 },
];

const CONCOMITANT_TOPICS: Topic[] = Array.from({ length: 10 }, (_, i) => ({
  id: `c${i + 1}`,
  section: "F",
  label: `Concomitant medication ${i + 1}`,
  fieldIds: [`c${i + 1}`],
  repeatGroup: "concomitant-medication" as const,
  repeatInstance: i + 1,
}));

describe("repeatDecisionOptions", () => {
  it("needs no count follow-through for a two-slot group — yes has only one possible meaning", () => {
    const options = repeatDecisionOptions(1, "suspect-product", SUSPECT_PRODUCT_TOPICS);
    expect(options).toEqual({ capacity: 2, needsCountFollowThrough: false, countChoices: [] });
  });

  it("needs a count follow-through for a ten-slot group, offering every total from 2 through 10", () => {
    const options = repeatDecisionOptions(1, "concomitant-medication", CONCOMITANT_TOPICS);
    expect(options.needsCountFollowThrough).toBe(true);
    expect(options.capacity).toBe(10);
    // Every count above the lossy yes/no floor must be reachable through
    // chips alone (reviewer pass on PR #46: a bare "yes" used to write 2
    // and silently drop medications 3-10) — this is the AC's own named
    // proof requirement.
    expect(options.countChoices).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("offers a shrinking range as afterInstance advances, never revisiting an already-passed total", () => {
    const options = repeatDecisionOptions(5, "concomitant-medication", CONCOMITANT_TOPICS);
    expect(options.countChoices).toEqual([6, 7, 8, 9, 10]);
  });
});

describe("widgetTurnText", () => {
  it("formats a chip-driven answer as question — answerLabel, never fabricated prose", () => {
    expect(widgetTurnText("Was there another concomitant medication?", "Yes, 5 in total")).toBe(
      "Was there another concomitant medication? — Yes, 5 in total",
    );
  });
});

describe("applyActionToFields", () => {
  it("applies the same action to every listed field in one pass", () => {
    const record = initAgenda();
    const result = applyActionToFields(record, ["Page1.SecA_Patient.PatientIdentifier"], { type: "mark_unknown" });
    expect(result["Page1.SecA_Patient.PatientIdentifier"]).toEqual({ state: "unknown", value: undefined });
  });

  it("leaves fields not listed untouched", () => {
    const record = initAgenda();
    const fieldIds = FORM_3500_FIELDS.slice(0, 2).map((f) => f.id);
    const result = applyActionToFields(record, fieldIds, { type: "decline" });
    for (const id of fieldIds) expect(result[id].state).toBe("declined");
    const untouchedId = FORM_3500_FIELDS[2].id;
    expect(result[untouchedId]).toEqual(record[untouchedId]);
  });
});

describe("friendlyFailureMessage", () => {
  it("never leaks the raw error text, regardless of what it says", () => {
    const raw = "Could not resolve authentication method. Expected one of apiKey...";
    const friendly = friendlyFailureMessage(raw);
    expect(friendly).not.toBe(raw);
    expect(friendly).not.toContain("apiKey");
    expect(friendly.length).toBeGreaterThan(0);
  });

  it("maps every input to the same friendly copy — one honest message, not a per-error guess", () => {
    expect(friendlyFailureMessage("network timeout")).toBe(friendlyFailureMessage("500 internal error"));
  });
});

// Issue #44's AC: "no raw manifest strings or /Opt codes are user-visible
// ... a coverage test asserting every surfaced option resolves to one."
// Mechanical, per the agreed scoping (not new friendlier-prose authoring):
// every checkbox/enum field's label, and every enum option, is non-empty
// and doesn't look like a raw PDF field path or /Opt index.
describe("checkbox/enum manifest coverage — no raw identifiers surfaced", () => {
  const RAW_FIELD_PATH = /^Page\d+\./;
  const RAW_OPT_CODE = /^\/?Opt\d*$/i;

  it("every checkbox/enum field has a non-empty, non-raw-path label", () => {
    const widgetFields = FORM_3500_FIELDS.filter((f) => f.type === "checkbox" || f.type === "enum");
    expect(widgetFields.length).toBeGreaterThan(0);
    for (const field of widgetFields) {
      expect(field.label.trim().length).toBeGreaterThan(0);
      expect(field.label).not.toMatch(RAW_FIELD_PATH);
    }
  });

  it("every enum field's options are non-empty, non-raw-code strings", () => {
    const enumFields = FORM_3500_FIELDS.filter((f) => f.type === "enum");
    expect(enumFields.length).toBeGreaterThan(0);
    for (const field of enumFields) {
      for (const option of field.options ?? []) {
        if (option.trim().length === 0) continue; // the manifest's own blank/unselected placeholder
        expect(option).not.toMatch(RAW_OPT_CODE);
      }
    }
  });
});
