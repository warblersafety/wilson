// docs/ask-copy.md rule 3's mechanical derives. Every rule here is
// asserted with its negative, which is what #90's AC asks for and what
// the rules are actually about: the interesting half of "a bare age
// defaults to years" is that a bare WEIGHT does not.
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import { AUTHORED_ASKS, factCompletesFromOne, unresolvedAskFieldIds } from "./ask-inventory";
import { fieldById } from "./form-3500-fields";
import { deriveCompanionWrites, isClearTextAskNegative, textAskNegativeWrite } from "./derive";
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

describe("the bound on group completion (reviewer pass, PR #106, F1)", () => {
  it("completes nothing for a multi-select the ask does not enumerate — race/ethnicity", () => {
    // PB-3 asks for "race or ethnicity" without naming its seven boxes,
    // and they are not alternatives: Hispanic ethnicity is orthogonal to
    // race on this form, so "she's White" says NOTHING about
    // EthnicLatino, and writing it false would be wrong, not merely
    // unheard.
    const derived = deriveCompanionWrites(stepFor("PB-3"), initAgenda(), [
      answer("Page1.SecA_Patient.RaceWhite", "true"),
    ]);
    expect(derived).toEqual([]);
  });

  it("completes nothing for SP-6's product type, whose 'other' the ask never voices", () => {
    const derived = deriveCompanionWrites(stepFor("SP-6"), initAgenda(), [
      answer("Page4.Prod1.Prod1Brand", "true"),
    ]);
    expect(derived).toEqual([]);
  });

  it("still closes a non-completing group's ask from one answer, so it never re-asks forever", () => {
    const pb3 = AUTHORED_ASKS.find((a) => a.id === "PB-3")!;
    const answered = {
      ...initAgenda(),
      "Page1.SecA_Patient.RaceWhite": { state: "answered" as const, value: "true" },
    };
    expect(unresolvedAskFieldIds(pb3, answered)).toEqual([]);
  });

  it("makes every checkbox fact declare why it may or may not complete", () => {
    // Authoring has to decide, per fact — a checkbox group that declares
    // neither is treated as non-completing, and this asserts the two that
    // do so are the two we mean.
    const nonCompleting: string[] = [];
    for (const ask of AUTHORED_ASKS) {
      for (const fact of ask.facts ?? []) {
        if (!fact.fieldIds.every((id) => fieldById(id)?.type === "checkbox")) continue;
        if (!factCompletesFromOne(fact)) nonCompleting.push(`${ask.id}/${fact.name}`);
      }
    }
    expect(nonCompleting.filter((n) => !/^SP-\d-2|^CM-2/.test(n)).sort()).toEqual([
      "PB-3/race or ethnicity",
      "SP-6/product type",
    ]);
  });
});

describe("the bare-age default reaches the dictation path too", () => {
  it("fires on a confirmed narrative batch, not only on a follow-up turn", async () => {
    const { applyNarrativeProposals } = await import("./narrative-extract");
    const { initRepeatCounts } = await import("./topics");
    const { record } = applyNarrativeProposals(
      initAgenda(),
      initRepeatCounts(),
      [answer(AGE_VALUE, "61")],
      [],
    );
    expect(record[AGE_YEARS]).toEqual({ state: "answered", value: "true" });
    expect(record[AGE_MONTHS]).toEqual({ state: "answered", value: "false" });
  });

  it("still gives a dictated bare weight no default", async () => {
    const { applyNarrativeProposals } = await import("./narrative-extract");
    const { initRepeatCounts } = await import("./topics");
    const { record } = applyNarrativeProposals(
      initAgenda(),
      initRepeatCounts(),
      [answer(WEIGHT_VALUE, "80")],
      [],
    );
    expect(record["Page1.SecA_Patient.WeightLB"].state).toBe("unasked");
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

// Issue #121 / rule 7's other half: a clear "none"/"nothing" answer to
// MH-1, LD-1, or AC-1 writes the literal "None", answered — never
// mark_unknown. Paired both directions per #90's own convention (this
// file's header comment): a negative that matters as much as its
// positive.
const OTHER_HISTORY = "Page3.Sec6Data.OtherHistory";
const TEST_DATA_1 = "Page3.TestDataTable.Row1.TestData1";
const ADDITIONAL_COMMENTS = "Page3.AdditionalComments";

describe("the text-ask negative — rule 7's other half", () => {
  it("MH-1's clear negative writes the literal None, answered", () => {
    expect(textAskNegativeWrite(stepFor("MH-1"), "no relevant history")).toEqual({
      fieldId: OTHER_HISTORY,
      type: "answer",
      value: "None",
    });
  });

  it("LD-1's clear negative writes the literal None, answered", () => {
    expect(textAskNegativeWrite(stepFor("LD-1"), "none")).toEqual({
      fieldId: TEST_DATA_1,
      type: "answer",
      value: "None",
    });
  });

  it("AC-1's clear negative writes the literal None, answered", () => {
    expect(textAskNegativeWrite(stepFor("AC-1"), "nothing else to add")).toEqual({
      fieldId: ADDITIONAL_COMMENTS,
      type: "answer",
      value: "None",
    });
  });

  it("matches case- and punctuation-insensitively, the same normalization grounding already uses", () => {
    expect(textAskNegativeWrite(stepFor("AC-1"), "  Nothing Else To Add.  ")).toEqual({
      fieldId: ADDITIONAL_COMMENTS,
      type: "answer",
      value: "None",
    });
  });

  // Rule 7's own boundary: a mark_unknown on genuine "I don't have that
  // information" is a different statement from "none", and must still
  // resolve unknown — this function must stand aside, not force it.
  it("does not fire on ignorance phrasing — that stays unknown, not None", () => {
    expect(textAskNegativeWrite(stepFor("MH-1"), "I don't have that information")).toBeNull();
    expect(textAskNegativeWrite(stepFor("MH-1"), "I don't know")).toBeNull();
    expect(textAskNegativeWrite(stepFor("LD-1"), "not sure")).toBeNull();
  });

  // The boundary called out by name: content riding along with a
  // negative-shaped opener carries real information "None" would erase.
  // Full-string match only, never a substring/prefix match.
  it("does not fire on a negative that carries real content past it", () => {
    expect(textAskNegativeWrite(stepFor("MH-1"), "no relevant history of cardiac issues")).toBeNull();
  });

  it("is bounded to MH-1/LD-1/AC-1 — the same clear negative elsewhere does not fire", () => {
    expect(textAskNegativeWrite(stepFor("PB-1"), "none")).toBeNull();
  });

  it("does not fire outside a topic step", () => {
    expect(textAskNegativeWrite({ kind: "done" }, "none")).toBeNull();
  });
});

describe("isClearTextAskNegative", () => {
  it("matches the bounded set", () => {
    for (const text of ["none", "no", "nothing", "nothing else", "nothing to add"]) {
      expect(isClearTextAskNegative(text)).toBe(true);
    }
  });

  it("rejects ignorance and free text alike", () => {
    for (const text of ["I don't know", "not sure", "no relevant history of cardiac issues", "penicillin"]) {
      expect(isClearTextAskNegative(text)).toBe(false);
    }
  });
});
