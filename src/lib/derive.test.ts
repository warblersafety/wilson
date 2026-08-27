// docs/ask-copy.md rule 3's mechanical derives. Every rule here is
// asserted with its negative, which is what #90's AC asks for and what
// the rules are actually about: the interesting half of "a bare age
// defaults to years" is that a bare WEIGHT does not.
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import { AUTHORED_ASKS } from "./ask-inventory";
import { deriveCompanionWrites } from "./derive";
import type { ProposedAction } from "./talk";
import { TOPICS, type NextStep } from "./topics";

function stepFor(askId: string): NextStep {
  const ask = AUTHORED_ASKS.find((a) => a.id === askId)!;
  const topic = TOPICS.find((t) => t.id === ask.topicId)!;
  return { kind: "topic", topic, ask, fieldIds: ask.askFieldIds };
}

function answer(fieldId: string, value: string): ProposedAction {
  return { fieldId, type: "answer", value };
}

const AGE_VALUE = "Page1.SecA_Patient.AgeValue";
const AGE_YEARS = "Page1.SecA_Patient.AgeYears";
const AGE_MONTHS = "Page1.SecA_Patient.AgeMonths";
const WEIGHT_VALUE = "Page1.SecA_Patient.WeightValue";
const SEX_F = "Page1.SecA_Patient.SexF";
const SEX_M = "Page1.SecA_Patient.SexM";
const HOSPITAL = "Page1.SecA_Patient.Hospital";
const DEATH = "Page1.SecA_Patient.Death";

describe("group completion", () => {
  it("completes a one-hot pair — 'she's female' checks one box and unchecks the other", () => {
    const derived = deriveCompanionWrites(stepFor("PB-1"), initAgenda(), [answer(SEX_F, "true")]);
    expect(derived).toContainEqual(answer(SEX_M, "false"));
  });

  it("completes a multi-select group — answering the outcome question answers all seven boxes", () => {
    const derived = deriveCompanionWrites(stepFor("OC-1"), initAgenda(), [answer(HOSPITAL, "true")]);
    const oc1 = AUTHORED_ASKS.find((a) => a.id === "OC-1")!;
    expect(derived.map((d) => d.fieldId).sort()).toEqual(oc1.askFieldIds.filter((id) => id !== HOSPITAL).sort());
    for (const write of derived) expect(write).toEqual(answer(write.fieldId, "false"));
    // Including the one that matters most: an outcome answered as
    // hospitalization is an outcome that was not a death, and OC-1 voices
    // death out loud, so the box is not written false unheard (rule 7).
    expect(derived).toContainEqual(answer(DEATH, "false"));
  });

  it("resolves a whole group from a stated negative — rule 7's 'none of those'", () => {
    const oc1 = AUTHORED_ASKS.find((a) => a.id === "OC-1")!;
    const derived = deriveCompanionWrites(stepFor("OC-1"), initAgenda(), [answer(HOSPITAL, "false")]);
    expect([HOSPITAL, ...derived.map((d) => d.fieldId)].sort()).toEqual([...oc1.askFieldIds].sort());
  });

  // The negatives.
  it("completes nothing from an `unknown` — 'I don't know if she was hospitalized' is not an answer", () => {
    const derived = deriveCompanionWrites(stepFor("OC-1"), initAgenda(), [
      { fieldId: HOSPITAL, type: "mark_unknown" },
    ]);
    expect(derived).toEqual([]);
  });

  it("completes nothing from a `decline`", () => {
    const derived = deriveCompanionWrites(stepFor("PB-1"), initAgenda(), [{ fieldId: SEX_F, type: "decline" }]);
    expect(derived).toEqual([]);
  });

  // Rule 7's bound: a box is written false only where its own ask voiced
  // it. A checkbox volunteered during a different ask completes nothing.
  it("completes nothing for a group whose ask was not the one on screen", () => {
    const derived = deriveCompanionWrites(stepFor("PB-2"), initAgenda(), [answer(HOSPITAL, "true")]);
    expect(derived).toEqual([]);
  });

  it("never overwrites a member the clinician already resolved", () => {
    const record = applyAction(initAgenda(), DEATH, { type: "decline" });
    const derived = deriveCompanionWrites(stepFor("OC-1"), record, [answer(HOSPITAL, "true")]);
    expect(derived.map((d) => d.fieldId)).not.toContain(DEATH);
  });

  it("never overwrites a member this same turn wrote", () => {
    const derived = deriveCompanionWrites(stepFor("OC-1"), initAgenda(), [
      answer(HOSPITAL, "true"),
      answer(DEATH, "true"),
    ]);
    expect(derived.map((d) => d.fieldId)).not.toContain(DEATH);
  });

  it("never completes a text group — RC-1's nine contact fields are one fact, not a checkbox group", () => {
    const rc1 = AUTHORED_ASKS.find((a) => a.id === "RC-1")!;
    const derived = deriveCompanionWrites(stepFor("RC-1"), initAgenda(), [answer(rc1.askFieldIds[0], "Diteljan")]);
    expect(derived).toEqual([]);
  });
});

describe("the bare-age default", () => {
  it("defaults a bare age to years, and unchecks the other three units", () => {
    const derived = deriveCompanionWrites(stepFor("PB-1"), initAgenda(), [answer(AGE_VALUE, "61")]);
    expect(derived).toContainEqual(answer(AGE_YEARS, "true"));
    expect(derived).toContainEqual(answer(AGE_MONTHS, "false"));
  });

  // The negative that matters: an infant age is always qualified, and
  // the model proposes the unit, so the default must stand aside.
  it("stands aside when the turn already stated a unit", () => {
    const derived = deriveCompanionWrites(stepFor("PB-1"), initAgenda(), [
      answer(AGE_VALUE, "6"),
      answer(AGE_MONTHS, "true"),
    ]);
    expect(derived.map((d) => d.fieldId)).not.toContain(AGE_YEARS);
  });

  it("stands aside when the record already carries a unit", () => {
    const record = applyAction(initAgenda(), AGE_MONTHS, { type: "answer" }, "true");
    const derived = deriveCompanionWrites(stepFor("PB-1"), record, [answer(AGE_VALUE, "6")]);
    expect(derived.map((d) => d.fieldId)).not.toContain(AGE_YEARS);
  });

  it("does not fire when the age was not answered this turn", () => {
    const derived = deriveCompanionWrites(stepFor("PB-1"), initAgenda(), [answer(SEX_F, "true")]);
    expect(derived.map((d) => d.fieldId)).not.toContain(AGE_YEARS);
  });

  it("does not fire on an unknown or declined age", () => {
    for (const action of [{ type: "mark_unknown" as const }, { type: "decline" as const }]) {
      const derived = deriveCompanionWrites(stepFor("PB-1"), initAgenda(), [{ fieldId: AGE_VALUE, ...action }]);
      expect(derived.map((d) => d.fieldId), action.type).not.toContain(AGE_YEARS);
    }
  });

  // Rule 3's stated-only rule, and the whole reason weight is not in
  // this module: lb/kg is genuinely ambiguous, so a bare weight writes
  // its value and leaves the unit open, visible at Review.
  it("gives a bare WEIGHT no default at all", () => {
    const derived = deriveCompanionWrites(stepFor("PB-2"), initAgenda(), [answer(WEIGHT_VALUE, "80")]);
    expect(derived).toEqual([]);
  });
});

describe("what the derive pass leaves to the model", () => {
  // Recorded so the division of labour is legible, and so a future
  // change that quietly moves one of these here has to change a test.
  it("derives no unit from a stated strength, dose, or duration", () => {
    const derived = deriveCompanionWrites(stepFor("SP-1"), initAgenda(), [
      answer("Page4.Prod1.Prod1Strength", "875"),
    ]);
    expect(derived).toEqual([]);
  });

  it("derives no Freq/Route 'Other' companion", () => {
    const derived = deriveCompanionWrites(stepFor("SP-3"), initAgenda(), [
      answer("Page4.Prod1.Prod1Freq", "Once daily"),
    ]);
    expect(derived).toEqual([]);
  });

  it("writes neither sex box for an answer outside the form's M/F vocabulary", () => {
    // The model proposes nothing for either box (nothing legal to
    // propose), so nothing completes, and PB-1's sex fact stays open.
    // warblersafety/wilson#102 is the open question about whether that
    // resting place is honest; this test pins the behaviour meanwhile.
    const derived = deriveCompanionWrites(stepFor("PB-1"), initAgenda(), [
      answer("Page1.SecA_Patient.PatientIdentifier", "MRN 1"),
    ]);
    expect(derived.map((d) => d.fieldId)).not.toContain(SEX_M);
    expect(derived.map((d) => d.fieldId)).not.toContain(SEX_F);
  });
});
