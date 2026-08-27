// Pure logic for Issue #44's chip-driven follow-up loop — no React, no
// DOM. UI components (RepeatDecision.tsx, AskForm.tsx) stay thin
// wrappers, same convention as the rest of src/app/wizard.
import { describe, expect, it } from "vitest";
import { initAgenda } from "./agenda";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import type { CorrectionOffer } from "./followup-sweep";
import { initRepeatCounts, nextStep, TOPICS, type NextStep, type Topic } from "./topics";
import {
  applyActionToFields,
  dismissAcknowledgment,
  dismissableFieldIds,
  friendlyFailureMessage,
  remainingCorrectionOffers,
  repeatDecisionOptions,
  widgetTurnText,
} from "./chip-grammar";
import { syntheticTopic } from "./synthetic-topic";

const SUSPECT_PRODUCT_TOPICS: Topic[] = [
  syntheticTopic({ id: "p1", section: "D", label: "Suspect product 1", fieldIds: ["p1"], repeatGroup: "suspect-product", repeatInstance: 1 }),
  syntheticTopic({ id: "p2", section: "D", label: "Suspect product 2", fieldIds: ["p2"], repeatGroup: "suspect-product", repeatInstance: 2 }),
];

const CONCOMITANT_TOPICS: Topic[] = Array.from({ length: 10 }, (_, i) =>
  syntheticTopic({
    id: `c${i + 1}`,
    section: "F",
    label: `Concomitant medication ${i + 1}`,
    fieldIds: [`c${i + 1}`],
    repeatGroup: "concomitant-medication" as const,
    repeatInstance: i + 1,
  }),
);

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
// the first three. Authored asks close that at the source — a topic step's
// fieldIds IS the ask's own unresolved askFieldIds — and
// dismissableFieldIds() is what keeps the two the same list; these tests
// cover both the pure pass-through and the actual dismiss write end to end.
describe("dismissableFieldIds", () => {
  it("passes a topic step's fieldIds through whole — the ask IS the dismiss set now", () => {
    const step: NextStep = { kind: "topic", topic: TOPICS[0], ask: TOPICS[0].asks[0], fieldIds: ["a", "b", "c", "d", "e"] };
    expect(dismissableFieldIds(step)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("passes an already-short fieldIds list through unchanged", () => {
    const step: NextStep = { kind: "topic", topic: TOPICS[0], ask: TOPICS[0].asks[0], fieldIds: ["a"] };
    expect(dismissableFieldIds(step)).toEqual(["a"]);
  });

  it("returns no fields for a repeat-decision or done step", () => {
    expect(
      dismissableFieldIds({ kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 }),
    ).toEqual([]);
    expect(dismissableFieldIds({ kind: "done" })).toEqual([]);
  });

  it("against the real manifest: a dismiss can never reach patient-basics' 19 fields", () => {
    // The real topic the bug was found on. The authored ask PB-1 waits on
    // four of the topic's nineteen fields — the four the question names —
    // and its derive companions (the age-unit checkboxes) are not among
    // them, so no dismiss can write them (ask-copy.md rule 2).
    const patientBasics = TOPICS.find((t) => t.id === "patient-basics")!;
    expect(patientBasics.fieldIds.length).toBe(19);
    const pb1 = patientBasics.asks[0];
    const step: NextStep = { kind: "topic", topic: patientBasics, ask: pb1, fieldIds: pb1.askFieldIds };
    expect(dismissableFieldIds(step)).toEqual(pb1.askFieldIds);
    expect(dismissableFieldIds(step)).toHaveLength(4);
    for (const companion of pb1.companionFieldIds) {
      expect(dismissableFieldIds(step)).not.toContain(companion);
    }
  });

  it("against the real manifest: a dismiss on patient-basics writes exactly the asked fields and no more", () => {
    const patientBasics = TOPICS.find((t) => t.id === "patient-basics")!;
    const step: NextStep = { kind: "topic", topic: patientBasics, ask: patientBasics.asks[0], fieldIds: patientBasics.asks[0].askFieldIds };
    const record = initAgenda();
    const phrasedIds = dismissableFieldIds(step);

    const result = applyActionToFields(record, phrasedIds, { type: "decline" });

    for (const id of phrasedIds) expect(result[id].state).toBe("declined");
    // The other 15 of patient-basics's 19 fields — PB-1's derive
    // companions and the facts PB-2 and PB-3 ask for, none of them shown
    // this turn — must be untouched. This is the exact regression: one
    // tap used to decline all 19.
    const unphrasedIds = patientBasics.fieldIds.filter((id) => !phrasedIds.includes(id));
    expect(unphrasedIds).toHaveLength(15);
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

// Issue #110: rule 8 authors an acknowledgment for a dismiss tap, and
// before this unit the build rendered nothing — the clinician saw their
// own "…question… — I don't have that" line and then the next question,
// with no statement that anything had been recorded. Design.md's "no
// widened write is ever invisible" holds for the sweep's writes; a tap
// writes MORE fields at once than the sweep usually does.
describe("dismissAcknowledgment", () => {
  it("names the facts the visible question asked for, not its fields", () => {
    // RA-2 is the ask #110 names: five fields, two facts.
    const reporterAboutYou = TOPICS.find((t) => t.id === "reporter-about-you")!;
    const ra2 = reporterAboutYou.asks.find((a) => a.id === "RA-2")!;
    const record = initAgenda();
    const step: NextStep = { kind: "topic", topic: reporterAboutYou, ask: ra2, fieldIds: ra2.askFieldIds };
    expect(dismissableFieldIds(step)).toHaveLength(5);
    expect(dismissAcknowledgment(step, "mark_unknown")).toBe(
      "Marked other reports and identity-withholding choice as not on hand.",
    );
  });

  it("names only what is still open, so a tap on a re-ask acknowledges the re-ask", () => {
    // The real step, from nextStep(), not a hand-built one: the narrowing
    // this asserts IS nextStep()'s own unresolvedAskFieldIds() slice, and
    // a fixture that re-listed every field would assert nothing.
    const record = { ...initAgenda(), "Page1.SecA_Patient.PatientIdentifier": { state: "answered" as const, value: "MRN 41" } };
    const step = nextStep(record, initRepeatCounts());
    expect(step.kind).toBe("topic");
    expect(dismissAcknowledgment(step, "decline")).toBe("Marked age and sex as declined.");
  });

  // Reviewer pass: the guard used to count field ids while the throw it
  // guards counts composed names. A step whose fieldIds belong to no fact
  // of its own ask passes the first and trips the second — which reaches
  // the clinician as AskForm's generic failure message, after the tap's
  // record write has already been made.
  it("returns undefined, never throws, when a step's fields name nothing in its ask", () => {
    const patientBasics = TOPICS.find((t) => t.id === "patient-basics")!;
    const step: NextStep = {
      kind: "topic",
      topic: patientBasics,
      ask: patientBasics.asks[0],
      fieldIds: ["Page6.SecE_Device.BrandName"],
    };
    expect(dismissAcknowledgment(step, "mark_unknown")).toBeUndefined();
  });

  it("has nothing to acknowledge on a step with no dismissable fields", () => {
    expect(dismissAcknowledgment({ kind: "done" }, "mark_unknown")).toBeUndefined();
    expect(
      dismissAcknowledgment({ kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 }, "mark_unknown"),
    ).toBeUndefined();
  });
});
