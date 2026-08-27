// Pure logic for Issue #44's chip-driven follow-up loop — no React, no
// DOM. UI components (RepeatDecision.tsx, AskForm.tsx) stay thin
// wrappers, same convention as the rest of src/app/wizard.
import { describe, expect, it } from "vitest";
import { initAgenda } from "./agenda";
import { MAX_FIELDS_PER_ASK } from "./ask";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import type { CorrectionOffer } from "./followup-sweep";
import { TOPICS, type NextStep, type Topic } from "./topics";
import {
  applyActionToFields,
  dismissableFieldIds,
  friendlyFailureMessage,
  remainingCorrectionOffers,
  repeatDecisionOptions,
  widgetTurnText,
} from "./chip-grammar";

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

// Issue #64 reviewer pass, finding 1 [High]: AskForm used to derive its
// dismiss chips' fieldIds straight from a topic step's own (uncapped)
// fieldIds, so one "Rather not say" tap on a bundled topic wrote
// declined/unknown to every unresolved field in it — up to 19 on
// patient-basics — even though askDeterministic() only ever asked about
// the first MAX_FIELDS_PER_ASK. dismissableFieldIds() is the fix; these
// tests cover both the pure cap and the actual dismiss write end to end.
describe("dismissableFieldIds", () => {
  it("caps a topic step's fieldIds to MAX_FIELDS_PER_ASK", () => {
    const step: NextStep = { kind: "topic", topic: TOPICS[0], fieldIds: ["a", "b", "c", "d", "e"] };
    expect(dismissableFieldIds(step)).toEqual(["a", "b", "c"]);
  });

  it("passes an already-short fieldIds list through unchanged", () => {
    const step: NextStep = { kind: "topic", topic: TOPICS[0], fieldIds: ["a"] };
    expect(dismissableFieldIds(step)).toEqual(["a"]);
  });

  it("returns no fields for a repeat-decision or done step", () => {
    expect(
      dismissableFieldIds({ kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 }),
    ).toEqual([]);
    expect(dismissableFieldIds({ kind: "done" })).toEqual([]);
  });

  it("against the real manifest: patient-basics bundles far more fields than the cap", () => {
    const patientBasics = TOPICS.find((t) => t.id === "patient-basics")!;
    // The real topic the bug was found on — proof this isn't a
    // synthetic-fixture-only guarantee.
    expect(patientBasics.fieldIds.length).toBeGreaterThan(MAX_FIELDS_PER_ASK);
    const step: NextStep = { kind: "topic", topic: patientBasics, fieldIds: patientBasics.fieldIds };
    const ids = dismissableFieldIds(step);
    expect(ids).toEqual(patientBasics.fieldIds.slice(0, MAX_FIELDS_PER_ASK));
    expect(ids.length).toBe(MAX_FIELDS_PER_ASK);
  });

  it("against the real manifest: a dismiss on patient-basics writes exactly the phrased fields and no more", () => {
    const patientBasics = TOPICS.find((t) => t.id === "patient-basics")!;
    const step: NextStep = { kind: "topic", topic: patientBasics, fieldIds: patientBasics.fieldIds };
    const record = initAgenda();
    const phrasedIds = dismissableFieldIds(step);

    const result = applyActionToFields(record, phrasedIds, { type: "decline" });

    for (const id of phrasedIds) expect(result[id].state).toBe("declined");
    // The other 16 of patient-basics's 19 fields — never shown to the
    // clinician this turn — must be untouched. This is the exact
    // regression: one tap used to decline all 19.
    const unphrasedIds = patientBasics.fieldIds.filter((id) => !phrasedIds.includes(id));
    expect(unphrasedIds).toHaveLength(patientBasics.fieldIds.length - MAX_FIELDS_PER_ASK);
    for (const id of unphrasedIds) expect(result[id]).toEqual(record[id]);
  });
});

// Issue #64 reviewer pass, finding 2 [Mod-high]: accepting one
// correction offer used to hand onSubmitted a TalkStep with no
// correctionOffers at all (stepForSession()'s fresh nextStep() computes
// none of its own), silently dropping every OTHER offer from the same
// turn even though neither was acted on.
describe("remainingCorrectionOffers", () => {
  function offer(fieldId: string): CorrectionOffer {
    return {
      fieldId,
      action: { fieldId, type: "answer", value: `value for ${fieldId}` },
      currentState: "answered",
      currentValue: `old value for ${fieldId}`,
    };
  }

  it("drops only the accepted offer, keeping every other offer from the same turn", () => {
    const offers = [offer("a"), offer("b"), offer("c")];
    expect(remainingCorrectionOffers(offers, "b")).toEqual([offer("a"), offer("c")]);
  });

  it("returns undefined, not an empty array, once accepting the offer empties the list", () => {
    expect(remainingCorrectionOffers([offer("a")], "a")).toBeUndefined();
  });

  it("returns undefined for an undefined input list (no offers this turn)", () => {
    expect(remainingCorrectionOffers(undefined, "a")).toBeUndefined();
  });

  it("is a no-op when the accepted id isn't among the given offers", () => {
    const offers = [offer("a"), offer("b")];
    expect(remainingCorrectionOffers(offers, "z")).toEqual(offers);
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
