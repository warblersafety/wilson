// No live API calls, no React rendering — same pure-logic practice as
// start-surface.test.ts. The Read-back component itself (Issue #43) stays
// untested directly; what's provable without a DOM lives here, including
// the quote-to-span mapping the issue itself names as the correctness risk.
import { describe, expect, it } from "vitest";
import { initTalkSession } from "./talk";
import type { FormFieldSpec } from "./form-3500-fields";
import type { NarrativeProposal, NarrativeExtractResult } from "./narrative-extract";
import type { ReadBackHandoff } from "./start-surface";
import {
  buildHighlightSegments,
  confirmReadBack,
  describeProposalValue,
  findQuoteSpan,
  groupProposalsByField,
  quoteReadings,
  READ_BACK_COPY,
  readingFraming,
  resolveConfirmReadiness,
  restoreSelections,
} from "./read-back";

function proposal(fieldId: string, value: string, quoteText: string, turnIndex = 0): NarrativeProposal {
  return { action: { fieldId, type: "answer", value }, quote: { turnIndex, text: quoteText } };
}

describe("findQuoteSpan", () => {
  it("finds a unique match and returns the exact original-text span", () => {
    const narrative = "Started amoxicillin, broke out in hives.";
    const result = findQuoteSpan(narrative, "amoxicillin");
    expect(result.status).toBe("unique");
    if (result.status !== "unique") throw new Error("expected unique");
    expect(narrative.slice(result.start, result.end)).toBe("amoxicillin");
  });

  it("is punctuation- and case-insensitive, matching the same normalization the grounding validator uses", () => {
    const narrative = "Patient said: “admitted overnight” after the reaction.";
    const result = findQuoteSpan(narrative, "Admitted Overnight!");
    expect(result.status).toBe("unique");
    if (result.status !== "unique") throw new Error("expected unique");
    expect(narrative.slice(result.start, result.end)).toBe("admitted overnight");
  });

  it("reports ambiguous when the quote occurs more than once", () => {
    const narrative = "Amoxicillin started Monday. Amoxicillin stopped Friday.";
    expect(findQuoteSpan(narrative, "Amoxicillin")).toEqual({ status: "ambiguous" });
  });

  it("reports not-found when the quote isn't in the narrative at all", () => {
    const narrative = "Started amoxicillin, broke out in hives.";
    expect(findQuoteSpan(narrative, "ibuprofen")).toEqual({ status: "not-found" });
  });

  it("reports not-found for a quote that normalizes to empty", () => {
    expect(findQuoteSpan("Started amoxicillin.", "...")).toEqual({ status: "not-found" });
  });

  it("stays aligned to the original text even where NFKC would change the character count", () => {
    // "…" (U+2026, one code point) expands to "..." (three) under NFKC —
    // exactly the case that used to shift every later span by two
    // characters, since the old map indexed into the NFKC'd string while
    // callers sliced the raw one (reviewer pass, finding).
    const narrative = "She felt fine… then started amoxicillin for the infection.";
    const result = findQuoteSpan(narrative, "started amoxicillin");
    expect(result.status).toBe("unique");
    if (result.status !== "unique") throw new Error("expected unique");
    expect(narrative.slice(result.start, result.end)).toBe("started amoxicillin");
  });
});

describe("buildHighlightSegments", () => {
  it("returns the whole narrative as one unhighlighted segment when there are no proposals", () => {
    expect(buildHighlightSegments("Started amoxicillin.", [])).toEqual([
      { text: "Started amoxicillin.", proposalIndexes: [] },
    ]);
  });

  it("splits into plain/highlighted/plain segments around one unique match", () => {
    const narrative = "Started amoxicillin, broke out in hives.";
    const segments = buildHighlightSegments(narrative, [proposal("a", "amoxicillin", "amoxicillin")]);
    expect(segments.map((s) => s.text).join("")).toBe(narrative);
    const highlighted = segments.filter((s) => s.proposalIndexes.length > 0);
    expect(highlighted).toEqual([{ text: "amoxicillin", proposalIndexes: [0] }]);
  });

  it("produces no highlight segment for an ambiguous or unlocatable quote", () => {
    const narrative = "Amoxicillin started Monday. Amoxicillin stopped Friday.";
    const segments = buildHighlightSegments(narrative, [proposal("a", "amoxicillin", "Amoxicillin")]);
    expect(segments.every((s) => s.proposalIndexes.length === 0)).toBe(true);
    expect(segments.map((s) => s.text).join("")).toBe(narrative);
  });

  it("marks a segment covered by two overlapping quotes with both proposal indexes", () => {
    const narrative = "She started amoxicillin last week.";
    const segments = buildHighlightSegments(narrative, [
      proposal("drug", "amoxicillin", "started amoxicillin"),
      proposal("desc", "amoxicillin", "amoxicillin"),
    ]);
    expect(segments.map((s) => s.text).join("")).toBe(narrative);
    const overlap = segments.find((s) => s.text === "amoxicillin");
    expect(overlap?.proposalIndexes.sort()).toEqual([0, 1]);
    // The non-overlapping prefix of the first quote is highlighted by
    // proposal 0 alone, proving the split isn't just "highlight everything
    // touched by either quote" but a real interval overlay.
    const prefix = segments.find((s) => s.text === "started ");
    expect(prefix?.proposalIndexes).toEqual([0]);
  });
});

describe("groupProposalsByField", () => {
  it("keeps single-proposal fields as one-element groups, in first-seen order", () => {
    const proposals = [proposal("a", "1", "one"), proposal("b", "2", "two")];
    expect(groupProposalsByField(proposals)).toEqual([
      { fieldId: "a", proposals: [proposals[0]] },
      { fieldId: "b", proposals: [proposals[1]] },
    ]);
  });

  it("groups two proposals for the same field together instead of treating them as independent", () => {
    const proposals = [proposal("a", "1", "one"), proposal("a", "one-ish", "sorta one")];
    const groups = groupProposalsByField(proposals);
    expect(groups).toEqual([{ fieldId: "a", proposals }]);
  });

  it("dedupes two proposals that agree on the same field's value, so agreeing evidence never blocks confirm", () => {
    // extraction-validator.ts's own documented case: "multiple pieces of
    // supporting context become multiple candidates, not one candidate
    // with a bag of evidence" — two quotes both supporting the SAME value
    // are corroboration, not a conflict (reviewer pass, finding).
    const proposals = [proposal("a", "hives", "broke out in hives"), proposal("a", "hives", "hives all over")];
    expect(groupProposalsByField(proposals)).toEqual([{ fieldId: "a", proposals: [proposals[0]] }]);
  });
});

describe("resolveConfirmReadiness", () => {
  it("is immediately ready when no field has a collision", () => {
    const proposals = [proposal("a", "1", "one"), proposal("b", "2", "two")];
    const readiness = resolveConfirmReadiness(groupProposalsByField(proposals), new Map());
    expect(readiness).toEqual({ ready: true, actions: [proposals[0].action, proposals[1].action] });
  });

  it("blocks confirm on an unresolved same-field collision, naming the pending field", () => {
    const proposals = [proposal("a", "1", "one"), proposal("a", "2", "two")];
    const readiness = resolveConfirmReadiness(groupProposalsByField(proposals), new Map());
    expect(readiness).toEqual({ ready: false, pendingFieldIds: ["a"] });
  });

  it("becomes ready once every colliding field has a selection, using the selected proposal's action", () => {
    const proposals = [proposal("a", "1", "one"), proposal("a", "2", "two")];
    const selections = new Map([["a", proposals[1]]]);
    const readiness = resolveConfirmReadiness(groupProposalsByField(proposals), selections);
    expect(readiness).toEqual({ ready: true, actions: [proposals[1].action] });
  });
});

describe("describeProposalValue", () => {
  it("shows the literal value for an answer action on a non-fixed-choice field", () => {
    expect(describeProposalValue({ fieldId: "a", type: "answer", value: "45" })).toBe("45");
  });

  it("describes mark_unknown and decline in plain language", () => {
    expect(describeProposalValue({ fieldId: "a", type: "mark_unknown" })).toBe("Unknown");
    expect(describeProposalValue({ fieldId: "a", type: "decline" })).toBe("Declined to answer");
  });

  it("shows a checkbox proposal as Yes/No, never the raw true/false the manifest requires internally", () => {
    const checkboxField: FormFieldSpec = {
      id: "cb",
      section: "A",
      pdfFieldName: "f.cb[0]",
      label: "cb",
      type: "checkbox",
      required: false,
    };
    expect(describeProposalValue({ fieldId: "cb", type: "answer", value: "true" }, checkboxField)).toBe("Yes");
    expect(describeProposalValue({ fieldId: "cb", type: "answer", value: "false" }, checkboxField)).toBe("No");
  });
});

describe("confirmReadBack", () => {
  function handoffWith(result: NarrativeExtractResult): ReadBackHandoff {
    const session = initTalkSession();
    return {
      session: { ...session, record: { a: { state: "unasked" }, b: { state: "unasked" } } },
      narrative: "Started amoxicillin, broke out in hives.",
      result,
    };
  }

  it("leaves the original handoff's record untouched — nothing is written until this is called", () => {
    const handoff = handoffWith({
      proposals: [proposal("a", "42", "42")],
      repeatDecisions: [],
      rejected: [],
    });
    const before = handoff.session.record;
    // Exercise the read-only helpers first, the way a real render would.
    groupProposalsByField(handoff.result.proposals);
    buildHighlightSegments(handoff.narrative, handoff.result.proposals);
    resolveConfirmReadiness(groupProposalsByField(handoff.result.proposals), new Map());
    expect(handoff.session.record).toBe(before);
    expect(handoff.session.record.a).toEqual({ state: "unasked" });
  });

  it("applies the confirmed actions through the real Agenda write path and appends the narrative as a clinician turn", () => {
    const handoff = handoffWith({ proposals: [], repeatDecisions: [], rejected: [] });
    const result = confirmReadBack(handoff, [{ fieldId: "a", type: "answer", value: "42" }]);
    expect(result.record.a).toEqual({ state: "answered", value: "42" });
    expect(result.record.b).toEqual({ state: "unasked" });
    expect(result.transcript).toEqual([{ role: "clinician", text: handoff.narrative }]);
    // The original session is a different object — confirmReadBack never
    // mutates its input.
    expect(result).not.toBe(handoff.session);
    expect(handoff.session.record.a).toEqual({ state: "unasked" });
  });

  it("never applies repeat decisions from the narrative pass, even when the extraction result carries them", () => {
    // Issue #43's amended AC: repeat decisions are out of scope for this
    // surface — Follow-ups' existing loop asks normally regardless of
    // what the narrative implied. confirmReadBack must ignore
    // handoff.result.repeatDecisions entirely, not just happen to be
    // called with an empty batch in every other test here.
    const handoff = handoffWith({
      proposals: [],
      repeatDecisions: [{ repeatGroup: "suspect-product", count: 2 }],
      rejected: [],
    });
    const result = confirmReadBack(handoff, []);
    expect(result.repeatCounts).toEqual(handoff.session.repeatCounts);
  });
});

describe("restoreSelections", () => {
  // The property this whole store-by-index scheme exists for, and the one
  // a store-by-value implementation silently breaks: ReadBack checks a
  // radio with `selections.get(fieldId) === proposal`, where `proposal`
  // comes from groupProposalsByField(). An equal-but-different object
  // renders unchecked while the choice is really held — the app looking
  // like it lost an answer it hadn't (reviewer pass, PR #80, finding 5:
  // this was previously asserted only where it couldn't fail).
  const AGE = "Page1.SecA_Patient.AgeValue";
  const NAME = "Page4.Prod1.Prod1Name";

  function handoffWith(proposals: NarrativeProposal[]): ReadBackHandoff {
    return {
      session: initTalkSession(),
      narrative: "42-year-old, chart says forty-three, amoxicillin",
      result: { proposals, repeatDecisions: [], rejected: [] },
    };
  }

  const AGE_42 = proposal(AGE, "42", "42-year-old");
  const AGE_43 = proposal(AGE, "43", "forty-three");
  const PRODUCT = proposal(NAME, "amoxicillin", "amoxicillin");

  it("returns the very object the panel renders, not an equal copy", () => {
    const handoff = handoffWith([AGE_42, AGE_43, PRODUCT]);
    const selections = restoreSelections(handoff, { [AGE]: 1 });
    const ageGroup = groupProposalsByField(handoff.result.proposals).find((g) => g.fieldId === AGE)!;
    expect(selections.get(AGE)).toBe(ageGroup.proposals[1]);
    // …which is what makes the restored choice actually confirmable.
    const readiness = resolveConfirmReadiness(groupProposalsByField(handoff.result.proposals), selections);
    expect(readiness.ready).toBe(true);
    if (!readiness.ready) throw new Error("expected ready");
    expect(readiness.actions).toContainEqual({ fieldId: AGE, type: "answer", value: "43" });
  });

  it("ignores an index pointing at another field's proposal", () => {
    const handoff = handoffWith([AGE_42, AGE_43, PRODUCT]);
    const selections = restoreSelections(handoff, { [AGE]: 2 });
    expect(selections.has(AGE)).toBe(false);
    // The collision therefore reads as unresolved, which is the safe
    // direction — the clinician re-picks rather than confirming a value
    // they never chose.
    const readiness = resolveConfirmReadiness(groupProposalsByField(handoff.result.proposals), selections);
    expect(readiness.ready).toBe(false);
  });

  it("ignores an out-of-range index, and an absent map", () => {
    const handoff = handoffWith([AGE_42, AGE_43]);
    expect(restoreSelections(handoff, { [AGE]: 9 }).size).toBe(0);
    expect(restoreSelections(handoff, undefined).size).toBe(0);
  });
});

describe("quoteReadings", () => {
  // Issue #60 / design.md: the read-back confirm "is the correspondence
  // check", and a value paired with a quote "must present it as a reading
  // of the quote". The panel showed values with no quotes at all, and
  // rendered an ambiguous-quote proposal identically to a cleanly grounded
  // one — so the surface whose whole job is letting a clinician verify
  // wilson read them correctly withheld the evidence they'd check against.
  const NARRATIVE = "42-year-old woman, amoxicillin 875 twice daily. Admitted her overnight. Rash on day 7, rash resolving.";

  it("marks a quote found exactly once as grounded", () => {
    const readings = quoteReadings(NARRATIVE, [proposal("f1", "42", "42-year-old")]);
    expect(readings[0].status).toBe("grounded");
    expect(readings[0].quoteText).toBe("42-year-old");
    expect(readings[0].note).toBeNull();
  });

  it("marks a quote appearing more than once as ambiguous, and says why", () => {
    // Distinct from unlocatable, and it must be: "it appears twice" and
    // "I can't find it" mean different things about how much to trust the
    // reading (AC: distinguished from grounded AND from each other).
    const readings = quoteReadings(NARRATIVE, [proposal("f1", "x", "rash")]);
    expect(readings[0].status).toBe("ambiguous");
    expect(readings[0].note).toBe(READ_BACK_COPY.ambiguousNote);
  });

  it("marks a quote it cannot locate as unlocatable, and says why", () => {
    const readings = quoteReadings(NARRATIVE, [proposal("f1", "x", "penicillin allergy")]);
    expect(readings[0].status).toBe("unlocatable");
    expect(readings[0].note).toBe(READ_BACK_COPY.unlocatableNote);
  });

  it("agrees with the highlight above: exactly the grounded ones are highlighted", () => {
    // The panel and the highlighting must not tell different stories —
    // buildHighlightSegments renders only "unique" spans, so a proposal
    // shown as grounded here and unhighlighted above (or the reverse)
    // would be the surface contradicting itself.
    const proposals = [
      proposal("f1", "42", "42-year-old"),
      proposal("f2", "x", "rash"),
      proposal("f3", "x", "penicillin allergy"),
    ];
    const readings = quoteReadings(NARRATIVE, proposals);
    const highlighted = new Set(
      buildHighlightSegments(NARRATIVE, proposals).flatMap((segment) => segment.proposalIndexes),
    );
    readings.forEach((reading, i) => {
      expect(highlighted.has(i)).toBe(reading.status === "grounded");
    });
  });

  it("matches under the same normalization the grounding validator used", () => {
    // Case and punctuation differences are not the clinician's problem:
    // findQuoteSpan already normalizes, and this must not be stricter, or
    // a quote the validator accepted would show as unlocatable.
    const readings = quoteReadings("Admitted her overnight for observation.", [
      proposal("f1", "x", "admitted her OVERNIGHT"),
    ]);
    expect(readings[0].status).toBe("grounded");
  });

  it("returns one reading per proposal, in order, and handles none", () => {
    expect(quoteReadings(NARRATIVE, [])).toEqual([]);
    const readings = quoteReadings(NARRATIVE, [proposal("f1", "1", "woman"), proposal("f2", "2", "sinusitis")]);
    expect(readings).toHaveLength(2);
    expect(readings.map((r) => r.status)).toEqual(["grounded", "unlocatable"]);
  });
});

describe("readingFraming", () => {
  // AC: the pairing is presented as a READING of the quote, "including
  // referential phrasings ('admitted her overnight' → Outcome:
  // Hospitalization) — never as if the value appeared in the prose".
  // "Hospitalization" appears nowhere in that sentence; copy that implied
  // it did would be a false claim about the clinician's own words.
  it("frames the value as read FROM the quote, never as quoted text", () => {
    expect(readingFraming("admitted her overnight")).toBe("read from “admitted her overnight”");
  });

  it("keeps the clinician's words verbatim inside the framing", () => {
    expect(readingFraming("875 twice daily")).toContain("875 twice daily");
  });
});
