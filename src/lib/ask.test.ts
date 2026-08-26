import { describe, expect, it } from "vitest";
import { initAgenda } from "./agenda";
import { FORM_3500_FIELDS, type FormFieldSpec } from "./form-3500-fields";
import { TOPICS, initRepeatCounts, type NextStep, type Topic } from "./topics";
import {
  ASK_OPTIONS_INLINE_MAX,
  REPEAT_GROUP_LABELS,
  askDeterministic,
  fieldPhrase,
  MAX_FIELDS_PER_ASK,
  PHRASING_OVERRIDES,
} from "./ask";
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

  it("covers exactly the thirteen fields identified as needing an override (six at filing, five more found by actually running the output before and after review, two more — Defects and IdentityNo — once Issue #44 started phrasing checkbox fields)", () => {
    expect(Object.keys(PHRASING_OVERRIDES).sort()).toEqual(
      [
        "Page1.SecA_Patient.Defects",
        "Page2.SecB_Adverse.DescEvent",
        "Page3.Sec6Data.OtherHistory",
        "Page3.TestDataTable.ReturnDate",
        "Page4.Prod1.Prod1FreqOther",
        "Page4.Prod1.Prod1RouteOther",
        "Page5.Prod2.Prod2FreqOther",
        "Page5.Prod2.Prod2RouteOther",
        "Page6.SecE_Device.ExplantDate",
        "Page6.SecE_Device.ImplantDate",
        "Page6.SecE_Device.ManuName",
        "Page6.SecE_Device.ReprocInfo",
        "Page7.SecG_Reporter.IdentityNo",
      ].sort(),
    );
  });

  it("smoke test: every real text/date field across all 34 topics phrases without throwing, without empty text, and without an embedded comma", async () => {
    // Asked alone (a single-field topic), a comma in the reply can only
    // have come from the field's own phrase — never from joinPhrases()'s
    // list-separator logic, which never runs for a single item. This is
    // what actually caught the generic-fallback comma bug a fresh-context
    // review found: the override-only check above didn't cover a field
    // with no override and a comma in its raw label (no ":" to split on).
    const fieldsById = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));
    for (const topic of TOPICS) {
      const textOrDateIds = topic.fieldIds.filter((id) => {
        const type = fieldsById.get(id)?.type;
        return type === "text" || type === "date";
      });
      for (const fieldId of textOrDateIds) {
        const reply = await askDeterministic(topicStep(topic, [fieldId]), STUB_SESSION);
        expect(reply.length, fieldId).toBeGreaterThan(0);
        expect(reply, fieldId).not.toContain(",");
      }
    }
  });

  it("throws rather than producing a broken 'What's , and undefined?' message for a topic step with no fieldIds", async () => {
    await expect(
      askDeterministic(topicStep(PATIENT_BASICS, []), STUB_SESSION),
    ).rejects.toThrow();
  });
});

// Issue #44 AC: fixed-choice (checkbox/enum) fields are ordinary
// conversational asks now, answered by typed/dictated text rather than a
// widget — so the ask itself must carry their legal options, or a
// clinician has no way to know the vocabulary that will actually
// validate.
describe("fieldPhrase — checkbox/enum option-aware phrasing (Issue #44)", () => {
  it("appends a yes/no suffix to a checkbox field's phrase", () => {
    const field: FormFieldSpec = {
      id: "cb",
      section: "B",
      pdfFieldName: "f.cb[0]",
      label: "Outcome: Hospitalization",
      type: "checkbox",
      required: false,
    };
    expect(fieldPhrase(field)).toBe("the hospitalization (yes or no)");
  });

  it("appends a slash-joined option list to a small enum field's phrase", () => {
    const field: FormFieldSpec = {
      id: "en",
      section: "D",
      pdfFieldName: "f.en[0]",
      label: "Frequency",
      type: "enum",
      required: false,
      options: [" ", "BID", "Daily", "Other"],
    };
    expect(fieldPhrase(field)).toBe("the frequency (BID / Daily / Other)");
  });

  it("never lets an enum's blank placeholder or a disallowed value leak into the phrased options", () => {
    const field = FORM_3500_FIELDS.find((f) => f.id === "Page4.Prod1.Prod1StrengthUnit")!;
    const phrase = fieldPhrase(field);
    expect(phrase).not.toMatch(/\(\s*\/|\/\s*\)/); // no leading/trailing empty slot from the blank option
    expect(phrase).not.toContain("AS NECESSARY - AN");
  });

  it("omits the option suffix entirely for an enum field past ASK_OPTIONS_INLINE_MAX options", () => {
    // Country (~275 legal options): spelling out every one would replace
    // the question with a wall of text nobody could answer from. The
    // clinician answers in plain text either way — the Extractor performs
    // the same referential mapping it already does for ordinary text
    // fields ("the water pill" -> furosemide), checked mechanically
    // against the full legal list regardless of what's shown here.
    const field = FORM_3500_FIELDS.find((f) => f.id === "Page4.Prod1.Prod1Country")!;
    expect((field.options?.length ?? 0)).toBeGreaterThan(ASK_OPTIONS_INLINE_MAX);
    expect(fieldPhrase(field)).not.toContain("(");
  });

  it("no field's phrase — including the new option suffix — contains a comma, checkbox/enum included", () => {
    for (const f of FORM_3500_FIELDS) {
      if (f.type !== "checkbox" && f.type !== "enum") continue;
      expect(fieldPhrase(f), f.id).not.toContain(",");
    }
  });

  it("smoke test: every real checkbox/enum field across all 34 topics phrases without throwing, non-empty, no embedded comma, no raw manifest identifier", async () => {
    const RAW_FIELD_PATH = /^Page\d+\./;
    const RAW_OPT_CODE = /\/Opt\d/i;
    const fieldsById = new Map<string, FormFieldSpec>(FORM_3500_FIELDS.map((f) => [f.id, f]));
    for (const topic of TOPICS) {
      const fixedChoiceIds = topic.fieldIds.filter((id) => {
        const type = fieldsById.get(id)?.type;
        return type === "checkbox" || type === "enum";
      });
      for (const fieldId of fixedChoiceIds) {
        const reply = await askDeterministic(topicStep(topic, [fieldId]), STUB_SESSION);
        expect(reply.length, fieldId).toBeGreaterThan(0);
        expect(reply, fieldId).not.toContain(",");
        expect(reply, fieldId).not.toMatch(RAW_FIELD_PATH);
        expect(reply, fieldId).not.toMatch(RAW_OPT_CODE);
      }
    }
  });

  it("against the real manifest: the dechallenge/rechallenge topic (all checkbox, unreachable before Issue #44) phrases cleanly", async () => {
    const responseTopic = TOPICS.find((t) => t.id === "suspect-product-1-response")!;
    const reply = await askDeterministic(topicStep(responseTopic, responseTopic.fieldIds), STUB_SESSION);
    expect(reply).toContain("yes or no");
  });
});

describe("REPEAT_GROUP_LABELS", () => {
  it("is exported for reuse (Issue #44's sweep-acknowledgment phrasing)", () => {
    expect(REPEAT_GROUP_LABELS["suspect-product"]).toBe("suspect product");
    expect(REPEAT_GROUP_LABELS["concomitant-medication"]).toBe("concomitant medication");
  });
});

// Issue #44: a repeat-decision ask surfaces a hint when the clinician
// already volunteered a later instance earlier in the conversation
// (recorded on session.volunteeredRepeats by processTurn() — see
// talk.test.ts and followup-sweep.test.ts for how it gets there).
describe("askDeterministic — volunteered-later-instance hint on a repeat-decision ask (Issue #44)", () => {
  it("adds a hint when the session recorded a volunteered later instance for this group", async () => {
    const session: TalkSession = { ...STUB_SESSION, volunteeredRepeats: { "suspect-product": true } };
    const reply = await askDeterministic(
      { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 },
      session,
    );
    expect(reply).toContain("Was there another suspect product?");
    expect(reply.length).toBeGreaterThan("Was there another suspect product?".length);
  });

  it("adds no hint when nothing was volunteered for this group", async () => {
    const reply = await askDeterministic(
      { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 },
      STUB_SESSION,
    );
    expect(reply).toBe("Was there another suspect product?");
  });

  it("adds no hint for a DIFFERENT group's volunteered mention", async () => {
    const session: TalkSession = { ...STUB_SESSION, volunteeredRepeats: { "concomitant-medication": true } };
    const reply = await askDeterministic(
      { kind: "repeat-decision", repeatGroup: "suspect-product", afterInstance: 1 },
      session,
    );
    expect(reply).toBe("Was there another suspect product?");
  });
});
