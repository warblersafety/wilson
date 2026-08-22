import { describe, expect, it } from "vitest";
import { initAgenda } from "./agenda";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import { TOPICS, initRepeatCounts, type NextStep, type Topic } from "./topics";
import { askDeterministic, MAX_FIELDS_PER_ASK, PHRASING_OVERRIDES } from "./ask";
import type { TalkSession } from "./talk";

const STUB_SESSION: TalkSession = {
  transcript: [],
  record: initAgenda(),
  repeatCounts: initRepeatCounts(),
};

const PATIENT_BASICS = TOPICS.find((t) => t.id === "patient-basics")!;

function topicStep(topic: Topic, fieldIds: string[]): NextStep {
  return { kind: "topic", topic, fieldIds };
}

describe("askDeterministic", () => {
  it("returns a fixed, non-empty closing message for done", async () => {
    const reply = await askDeterministic({ kind: "done" }, STUB_SESSION);
    expect(reply.length).toBeGreaterThan(0);
  });

  it("phrases a repeat-decision for suspect-product", async () => {
    const reply = await askDeterministic(
      { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 },
      STUB_SESSION,
    );
    expect(reply).toBe("Was there another suspect product?");
  });

  it("phrases a repeat-decision for concomitant-medication", async () => {
    const reply = await askDeterministic(
      { kind: "repeat-decision", repeatGroup: "concomitant-medication", afterInstance: 1 },
      STUB_SESSION,
    );
    expect(reply).toBe("Was there another concomitant medication?");
  });

  it("phrases a single-field topic as one clause", async () => {
    const reply = await askDeterministic(
      topicStep(PATIENT_BASICS, ["Page1.SecA_Patient.PatientIdentifier"]),
      STUB_SESSION,
    );
    expect(reply).toBe("What's the patient identifier?");
  });

  it("joins a two-field topic with 'and', no Oxford comma needed", async () => {
    const reply = await askDeterministic(
      topicStep(PATIENT_BASICS, [
        "Page1.SecA_Patient.PatientIdentifier",
        "Page1.SecA_Patient.AgeValue",
      ]),
      STUB_SESSION,
    );
    expect(reply).toBe("What's the patient identifier and the age?");
  });

  it("joins a three-field topic with an Oxford comma", async () => {
    const reply = await askDeterministic(
      topicStep(PATIENT_BASICS, [
        "Page1.SecA_Patient.PatientIdentifier",
        "Page1.SecA_Patient.AgeValue",
        "Page1.SecA_Patient.DateBirth",
      ]),
      STUB_SESSION,
    );
    expect(reply).toBe("What's the patient identifier, the age, and the date of birth?");
  });

  it("caps a topic with more fields than the cap to the first MAX_FIELDS_PER_ASK", async () => {
    const allFour = [
      "Page1.SecA_Patient.PatientIdentifier",
      "Page1.SecA_Patient.AgeValue",
      "Page1.SecA_Patient.DateBirth",
      "Page1.SecA_Patient.WeightValue",
    ];
    expect(MAX_FIELDS_PER_ASK).toBe(3);
    const reply = await askDeterministic(topicStep(PATIENT_BASICS, allFour), STUB_SESSION);
    // Identical to the three-field case above — the 4th field never enters
    // the phrase, and stays unresolved for a later turn (nextStep() will
    // surface it again on its own; no new machinery needed here).
    expect(reply).toBe("What's the patient identifier, the age, and the date of birth?");
  });

  it("phrases a 'Row N — X' field as row N's X, not the raw compound label", async () => {
    const labData = TOPICS.find((t) => t.id === "event-lab-data")!;
    const reply = await askDeterministic(
      topicStep(labData, ["Page3.TestDataTable.Row1.TestData1"]),
      STUB_SESSION,
    );
    expect(reply).toBe("What's row 1's test/lab data?");
  });

  it("uses the override table for a field whose generic phrase would be broken, instead of the generic rule", async () => {
    const deviceHistory = TOPICS.find((t) => t.id === "device-history")!;
    const reply = await askDeterministic(
      topicStep(deviceHistory, ["Page6.SecE_Device.ReprocInfo"]),
      STUB_SESSION,
    );
    expect(reply).not.toMatch(/item 7a/i);
    expect(reply).toBe(`What's ${PHRASING_OVERRIDES["Page6.SecE_Device.ReprocInfo"]}?`);
  });

  it("every override key is a real field id in FORM_3500_FIELDS", () => {
    const realIds = new Set(FORM_3500_FIELDS.map((f) => f.id));
    for (const id of Object.keys(PHRASING_OVERRIDES)) {
      expect(realIds.has(id)).toBe(true);
    }
  });

  it("no override phrase contains a comma — a comma inside one item is indistinguishable from the multi-field join's own separators", () => {
    for (const [id, phrase] of Object.entries(PHRASING_OVERRIDES)) {
      expect(phrase, `override for ${id}`).not.toContain(",");
    }
  });

  it("bundling an override next to a generic phrase stays a clean, unambiguous list — regression for the original Other Frequency/Route overrides, which each carried a comma and produced a run-on", async () => {
    const dosing = TOPICS.find((t) => t.id === "suspect-product-1-dosing")!;
    const reply = await askDeterministic(
      topicStep(dosing, [
        "Page4.Prod1.Prod1Dose",
        "Page4.Prod1.Prod1FreqOther",
        "Page4.Prod1.Prod1RouteOther",
      ]),
      STUB_SESSION,
    );
    expect(reply).toBe(
      "What's the dose or amount, the other frequency you had in mind, and the other route you had in mind?",
    );
  });

  it("covers exactly the nine fields identified as needing an override (six at filing, three more found by spot-checking real output before commit)", () => {
    expect(Object.keys(PHRASING_OVERRIDES).sort()).toEqual(
      [
        "Page2.SecB_Adverse.DescEvent",
        "Page3.TestDataTable.ReturnDate",
        "Page4.Prod1.Prod1FreqOther",
        "Page4.Prod1.Prod1RouteOther",
        "Page5.Prod2.Prod2FreqOther",
        "Page5.Prod2.Prod2RouteOther",
        "Page6.SecE_Device.ExplantDate",
        "Page6.SecE_Device.ImplantDate",
        "Page6.SecE_Device.ReprocInfo",
      ].sort(),
    );
  });

  it("smoke test: every real text/date field across all 34 topics phrases without throwing or producing empty text", async () => {
    const fieldsById = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));
    for (const topic of TOPICS) {
      const textOrDateIds = topic.fieldIds.filter((id) => {
        const type = fieldsById.get(id)?.type;
        return type === "text" || type === "date";
      });
      for (const fieldId of textOrDateIds) {
        const reply = await askDeterministic(topicStep(topic, [fieldId]), STUB_SESSION);
        expect(reply.length).toBeGreaterThan(0);
      }
    }
  });
});
