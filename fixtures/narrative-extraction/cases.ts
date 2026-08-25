// Fixture corpus for the narrative-extraction pass (Issue #41), consumed by
// `npm run eval:narrative-dry` (structural check + the full accepted/
// rejected proof, both API-free — no real model call anywhere in this file
// or its dry runner) and `npm run eval:narrative` (live sweep against
// wilson-evals, workflow_dispatch only). Each fixture pairs an opening
// narrative with a hand-scripted extraction response — standing in for
// what a real model call would return — so the actual, real validator
// (src/lib/extraction-validator.ts) can be proven correct against
// realistic and adversarial narrative-shaped input without ever calling
// the API, matching the charter's v1.1 end condition: "a scripted
// end-to-end flow test... against a fake model."
import type { ExtractionCandidate, RepeatCandidate, RejectionReason } from "../../src/lib/extraction-validator";
import type { ProposedAction } from "../../src/lib/talk";
import type { RepeatGroup } from "../../src/lib/topics";

export interface NarrativeExtractionFixture {
  id: string;
  description: string;
  narrative: string;
  scriptedCandidates: ExtractionCandidate[];
  scriptedRepeatDecisions: RepeatCandidate[];
  expected: {
    accepted: ProposedAction[];
    rejected: { fieldId: string; reason: RejectionReason }[];
    repeatDecisions: { repeatGroup: RepeatGroup; count: number }[];
  };
  // True for the two fixtures whose scripted response deliberately probes
  // the validator's mechanics (a fabricated quote, a real-but-unrelated
  // one) rather than standing in for a plausible real model response.
  // eval-narrative-extraction.ts's live mode skips these — comparing a
  // real model's own output against a hand-adversarial script would be
  // checking the wrong thing, not a weaker version of the right thing.
  adversarial?: boolean;
}

export const NARRATIVE_EXTRACTION_FIXTURES: NarrativeExtractionFixture[] = [
  {
    // The mockups' reference case (Wilson voice reporting UI mockups.zip,
    // also the charter's own v1.1 end-condition case) — a rich narrative
    // that should ground candidates spanning several sections in one pass,
    // fixed-choice fields included.
    id: "amoxicillin-reference-case",
    description: "the mockups' reference narrative — spans sections A, B, and D, including checkbox/enum fields",
    narrative:
      "42-year-old woman, amoxicillin 875 twice daily for sinusitis, started the 12th. About a week in she came up in a diffuse urticarial rash with facial and periorbital angioedema. No airway compromise, but she went to the ED and we admitted her overnight for observation. Stopped the amoxicillin on admission, treated with IV diphenhydramine and methylprednisolone, rash was resolving at 48 hours.",
    scriptedCandidates: [
      { fieldId: "Page1.SecA_Patient.AgeValue", kind: "value", value: "42", quote: { turnIndex: 0, text: "42-year-old" } },
      { fieldId: "Page1.SecA_Patient.AgeYears", kind: "value", value: "true", quote: { turnIndex: 0, text: "42-year-old" } },
      { fieldId: "Page1.SecA_Patient.SexF", kind: "value", value: "true", quote: { turnIndex: 0, text: "woman" } },
      {
        fieldId: "Page2.SecB_Adverse.DescEvent",
        kind: "value",
        value: "diffuse urticarial rash with facial and periorbital angioedema",
        quote: { turnIndex: 0, text: "diffuse urticarial rash with facial and periorbital angioedema" },
      },
      {
        fieldId: "Page1.SecA_Patient.RepAdverse",
        kind: "value",
        value: "true",
        quote: { turnIndex: 0, text: "came up in a diffuse urticarial rash" },
      },
      {
        fieldId: "Page1.SecA_Patient.Hospital",
        kind: "value",
        value: "true",
        quote: { turnIndex: 0, text: "admitted her overnight for observation" },
      },
      { fieldId: "Page4.Prod1.Prod1Name", kind: "value", value: "amoxicillin", quote: { turnIndex: 0, text: "amoxicillin" } },
      { fieldId: "Page4.Prod1.Prod1Strength", kind: "value", value: "875", quote: { turnIndex: 0, text: "875" } },
      {
        fieldId: "Page4.Prod1.Prod1StrengthUnit",
        kind: "value",
        value: "MILLIGRAM(S) - MG",
        quote: { turnIndex: 0, text: "875" },
      },
      { fieldId: "Page4.Prod1.Prod1Freq", kind: "value", value: "BID", quote: { turnIndex: 0, text: "twice daily" } },
    ],
    scriptedRepeatDecisions: [],
    expected: {
      accepted: [
        { fieldId: "Page1.SecA_Patient.AgeValue", type: "answer", value: "42" },
        { fieldId: "Page1.SecA_Patient.AgeYears", type: "answer", value: "true" },
        { fieldId: "Page1.SecA_Patient.SexF", type: "answer", value: "true" },
        {
          fieldId: "Page2.SecB_Adverse.DescEvent",
          type: "answer",
          value: "diffuse urticarial rash with facial and periorbital angioedema",
        },
        { fieldId: "Page1.SecA_Patient.RepAdverse", type: "answer", value: "true" },
        { fieldId: "Page1.SecA_Patient.Hospital", type: "answer", value: "true" },
        { fieldId: "Page4.Prod1.Prod1Name", type: "answer", value: "amoxicillin" },
        { fieldId: "Page4.Prod1.Prod1Strength", type: "answer", value: "875" },
        { fieldId: "Page4.Prod1.Prod1StrengthUnit", type: "answer", value: "MILLIGRAM(S) - MG" },
        { fieldId: "Page4.Prod1.Prod1Freq", type: "answer", value: "BID" },
      ],
      rejected: [],
      repeatDecisions: [],
    },
  },
  {
    // AC-3: repeat-group handling. suspect-product instance 1's own field
    // gets proposed normally; a candidate for instance 2 (never offered as
    // a target) is refused the same deterministic way an unknown field id
    // already is — proving "never silently mis-attributed" rather than
    // just asserting it. The repeat decision itself is still detected,
    // since that reuses the already-proven per-turn mechanism.
    id: "multi-product-narrative",
    description: "narrative names two suspect products — instance 1 extracted, instance 2 explicitly refused, repeat decision detected",
    narrative:
      "A woman came in with a severe rash. She'd been taking both amoxicillin and a sulfa antibiotic together when it started, so we're reporting both as suspect products.",
    scriptedCandidates: [
      { fieldId: "Page4.Prod1.Prod1Name", kind: "value", value: "amoxicillin", quote: { turnIndex: 0, text: "amoxicillin" } },
      // A misbehaving model reaching for instance 2's own field anyway —
      // Prod2Name is never in this pass's open-fields list.
      {
        fieldId: "Page5.Prod2.Prod2Name",
        kind: "value",
        value: "a sulfa antibiotic",
        quote: { turnIndex: 0, text: "a sulfa antibiotic" },
      },
    ],
    scriptedRepeatDecisions: [
      {
        repeatGroup: "suspect-product",
        count: 2,
        quote: { turnIndex: 0, text: "reporting both as suspect products" },
      },
    ],
    expected: {
      accepted: [{ fieldId: "Page4.Prod1.Prod1Name", type: "answer", value: "amoxicillin" }],
      rejected: [{ fieldId: "Page5.Prod2.Prod2Name", reason: "unknown_field" }],
      repeatDecisions: [{ repeatGroup: "suspect-product", count: 2 }],
    },
  },
  {
    // A narrative with little concrete, groundable detail should yield few
    // proposals, not hallucinated ones for everything it doesn't actually
    // say — including a clean explicit-negative checkbox case (Hospital
    // "false"), complementing the reference case's "true" one.
    id: "sparse-narrative",
    description: "vague narrative — only what's actually grounded gets proposed",
    narrative: "Elderly man, had some dizziness after starting a new blood pressure pill a few days ago. Not hospitalized.",
    scriptedCandidates: [
      { fieldId: "Page1.SecA_Patient.Hospital", kind: "value", value: "false", quote: { turnIndex: 0, text: "Not hospitalized" } },
    ],
    scriptedRepeatDecisions: [],
    expected: {
      accepted: [{ fieldId: "Page1.SecA_Patient.Hospital", type: "answer", value: "false" }],
      rejected: [],
      repeatDecisions: [],
    },
  },
  {
    // Adversarial: a value with no real supporting quote at all — the
    // ordinary, already-proven quote_not_found path, exercised here
    // against a full-narrative-shaped input rather than a single-turn one.
    id: "adversarial-unsupported-value",
    description: "a candidate whose quote is fabricated, not a real substring of the narrative — rejected",
    narrative: "Patient developed a rash after starting a new antibiotic.",
    scriptedCandidates: [
      {
        fieldId: "Page4.Prod1.Prod1Name",
        kind: "value",
        value: "amoxicillin",
        quote: { turnIndex: 0, text: "took amoxicillin daily" },
      },
    ],
    scriptedRepeatDecisions: [],
    expected: {
      accepted: [],
      rejected: [{ fieldId: "Page4.Prod1.Prod1Name", reason: "quote_not_found" }],
      repeatDecisions: [],
    },
    adversarial: true,
  },
  {
    // Adversarial: design.md "Extraction scope" — the validator can only
    // confirm a quote is REAL, never that it's topically related to the
    // value cited for it. This is accepted BY DESIGN (the mechanical check
    // passes), and must surface as a proposal for read-back — the
    // clinician's confirmation, not this validator, is what catches a
    // genuinely wrong mapping. If this fixture ever starts failing because
    // the candidate got rejected, that's the validator's authority
    // silently growing beyond what design.md scopes it to, not a bug fix.
    id: "adversarial-real-quote-fabricated-value",
    description: "a real quote cited for an unrelated, fabricated value — mechanically accepted, must surface for read-back",
    narrative: "Patient takes metoprolol for her heart condition and was fine until yesterday.",
    scriptedCandidates: [
      { fieldId: "Page4.Prod1.Prod1Name", kind: "value", value: "ibuprofen", quote: { turnIndex: 0, text: "metoprolol" } },
    ],
    scriptedRepeatDecisions: [],
    expected: {
      accepted: [{ fieldId: "Page4.Prod1.Prod1Name", type: "answer", value: "ibuprofen" }],
      rejected: [],
      repeatDecisions: [],
    },
    adversarial: true,
  },
];
