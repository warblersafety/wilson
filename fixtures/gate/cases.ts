// The six round-gate cases, pinned verbatim (Issue #96 AC-2;
// docs/round-gate.md: "The verbatim inputs for all cases are pinned by
// the case-driver unit"). Before this file, C2's narrative existed only
// as prose inside docs/round-gate.md, quoted from Steve's 2026-08-26
// staging screenshot — so the case a gate run drove was whatever the
// running session retyped.
//
// **What a case is.** An ordered list of steps a clinician performs, and
// for each typed step, what the Extractor would propose from it. The two
// live together deliberately: a message and its extraction that drift
// apart are the failure mode this whole file exists to prevent, and
// src/lib/scripted-extract.ts refuses to run a message it has no script
// for rather than extracting nothing and walking on.
//
// **The extractions are proposals, not outcomes.** Every candidate here
// still faces the real validator — quote grounding against the
// clinician's own words, the current-turn citation pool, the
// legal-option check — and then the real classifier, lab-row gate,
// derive rules and sweep. A candidate whose quote is not really in its
// message is rejected exactly as a hallucinating model's would be. That
// is what makes a gate run evidence about this build. It is also why
// several cases deliberately propose LESS than a good model would: the
// point is to exercise the machinery's paths, not to simulate a
// perfect extraction.
//
// **What this cannot certify** (docs/round-gate.md "How it runs", and the
// verdict must say so in these words): copy, layout and screen fidelity
// are model-independent and are certified here; flow and length are NOT
// — under the fake driver they hold only *as exercised by the scripted
// extractions*. The real-model residual is the charter v1.2 live evals
// and Steve's own acceptance pass.
import type { ExtractionScript, ScriptedCandidate, ScriptedRepeatDecision } from "../../src/lib/scripted-extract";
import { REPEAT_COUNT_FOLLOW_THROUGH } from "../../src/lib/gate-simulate";

// A typed clinician turn. `expectAsk` is a distinctive fragment of the
// question the driver must be looking at when it sends this — not
// decoration: a case whose steps have slipped out of alignment with the
// walk would otherwise type a lot-number answer at the outcome question
// and still produce a green-looking run.
export interface GateTypeStep {
  kind: "type";
  expectAsk: string;
  message: string;
  candidates: ScriptedCandidate[];
  repeatDecision?: ScriptedRepeatDecision;
}

// A chip tap. `label` is the chip's visible text — "I don't have that",
// "Rather not say", "Yes", "No", or a repeat count like "3".
export { REPEAT_COUNT_FOLLOW_THROUGH };

export interface GateChipStep {
  kind: "chip";
  expectAsk?: string;
  label: string;
}

// Ready's "Start over", for C6.
export interface GateStartOverStep {
  kind: "start-over";
}

export type GateStep = GateTypeStep | GateChipStep | GateStartOverStep;

// design.md's "flow is six surfaces" (screen 02 Recording is n/a —
// wilson owns no microphone), plus the two things that are not surfaces
// but must still be seen: the report rail/chrome that runs alongside the
// walk, and a gate that opened.
export const GATE_SURFACES = [
  "start",
  "read-back",
  "follow-ups",
  "review",
  "review-paper-facsimile",
  "open-fields",
  "ready",
  "report-chrome",
  "gate-opened-device",
  "gate-opened-product-handling",
] as const;
export type GateSurface = (typeof GATE_SURFACES)[number];

export interface GateNarrative {
  text: string;
  candidates: ScriptedCandidate[];
  repeatDecisions?: { repeatGroup: "suspect-product" | "concomitant-medication"; count: number; quote: string }[];
}

export interface GateCase {
  id: string;
  title: string;
  // The docs/round-gate.md line this case implements, quoted. Kept here
  // so a case that stops matching its own specification is visible in
  // the diff that changes either one.
  spec: string;
  // Which checklist entries (docs/round-gate.md "The checklist") this
  // case is the evidence for. The driver writes these into each run's
  // manifest so the verdict can answer entries with cases rather than
  // with assertions.
  evidences: number[];
  // The surfaces this case must traverse (design.md's own enumeration,
  // plus the report chrome and any gate it opens). Declared per case
  // rather than inferred: a run that silently stopped reaching Read-back
  // would otherwise still exit green, which is exactly the "exits green
  // on a partial traversal" failure AC-3 names. The union across all six
  // must cover EVERY surface, and the driver checks that too.
  surfaces: GateSurface[];
  narrative?: GateNarrative;
  steps: GateStep[];
  // A second case run immediately after this one in the same browser
  // state — C6's whole shape. Named rather than inlined so the C2 and C3
  // definitions stay single-sourced.
  thenStartOver?: string;
}

const AGE = "Page1.SecA_Patient.AgeValue";
const IDENT = "Page1.SecA_Patient.PatientIdentifier";
const SEX_F = "Page1.SecA_Patient.SexF";
const SEX_M = "Page1.SecA_Patient.SexM";
const DESC = "Page2.SecB_Adverse.DescEvent";
const DATE_EVENT = "Page1.SecA_Patient.EventDate";
const LAB_1 = "Page3.TestDataTable.Row1.TestData1";
const HISTORY = "Page3.Sec6Data.OtherHistory";
const COMMENTS = "Page3.AdditionalComments";
const P1_NAME = "Page4.Prod1.Prod1Name";
const P1_STRENGTH = "Page4.Prod1.Prod1Strength";
const P1_DOSE = "Page4.Prod1.Prod1Dose";
const P1_START = "Page4.Prod1.Prod1TherapyStartDate";
const P1_STOP = "Page4.Prod1.Prod1TherapyStopDate";
const P2_NAME = "Page5.Prod2.Prod2Name";
const CM_1 = "Page6.SecF_Other.Table1.Row1.Prod1";
const DEVICE_BRAND = "Page6.SecE_Device.BrandName";

const value = (fieldId: string, val: string, quote: string): ScriptedCandidate => ({
  fieldId,
  kind: "value",
  value: val,
  quote,
});

// --- C1 -------------------------------------------------------------------

const C1: GateCase = {
  id: "C1",
  title: "reference case",
  spec: "the amoxicillin narrative from the design mockups, dictated once, follow-ups answered plainly",
  evidences: [1, 2, 3, 4],
  surfaces: ["start", "read-back", "follow-ups", "review", "review-paper-facsimile", "open-fields", "ready", "report-chrome"],
  narrative: {
    text:
      "61-year-old on amoxicillin-clavulanate for a dental abscess developed a diffuse " +
      "maculopapular rash and low-grade fever on day 4. Drug stopped, rash resolved over a week.",
    candidates: [
      value(AGE, "61", "61-year-old"),
      value(DESC, "diffuse maculopapular rash and low-grade fever", "diffuse maculopapular rash and low-grade fever"),
      value(P1_NAME, "amoxicillin-clavulanate", "amoxicillin-clavulanate"),
    ],
  },
  steps: [
    {
      kind: "type",
      // Amended 2026-08-28 (#125): AgeValue arrives pre-filled from the
      // opening narrative ("61-year-old"), and this is the FIRST turn of
      // the whole walk — PB-1's own first-ever utterance. Pre-#125 this
      // rendered the bare re-ask frame, "Got it. Still need: patient
      // identifier and sex." (gate run #1, entry 1's own quoted
      // example). The fix is the arrival frame: what's already held,
      // named, ahead of what's still needed.
      expectAsk: "I've got age. Still need: patient identifier and sex.",
      message: "MRN 44-1902, and she's female.",
      candidates: [value(IDENT, "MRN 44-1902", "MRN 44-1902"), value(SEX_F, "true", "she's female")],
    },
    { kind: "chip", expectAsk: "What's the patient's weight", label: "I don't have that" },
    { kind: "chip", expectAsk: "For FDA's demographics", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "When did it happen",
      message: "It started on 2026-08-14, and it's an adverse reaction.",
      candidates: [value(DATE_EVENT, "2026-08-14", "2026-08-14")],
    },
    { kind: "chip", expectAsk: "And the report type", label: "I don't have that" },
    { kind: "chip", expectAsk: "How serious was the outcome", label: "I don't have that" },
    { kind: "chip", expectAsk: "Any relevant history", label: "I don't have that" },
    { kind: "chip", expectAsk: "Any relevant tests or labs", label: "I don't have that" },
    { kind: "chip", expectAsk: "Anything else FDA should know", label: "I don't have that" },
    {
      kind: "type",
      // Amended 2026-08-28 (#125): same shape as PB-1 above, a second
      // instance of the same class — SP-1's ProdNName arrives pre-filled
      // ("amoxicillin-clavulanate"), and Section D is reached for the
      // first time here.
      expectAsk: "I've got product name. Still need: strength and manufacturer/compounder.",
      message: "875 mg tablets, made by Sandoz.",
      candidates: [value(P1_STRENGTH, "875 mg", "875 mg")],
    },
    { kind: "chip", expectAsk: "And the manufacturer/compounder", label: "I don't have that" },
    { kind: "chip", expectAsk: "Lot number", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "How was it taken",
      message: "One tablet twice daily by mouth.",
      candidates: [value(P1_DOSE, "one tablet twice daily", "One tablet twice daily")],
    },
    { kind: "chip", expectAsk: "Still need: frequency and route.", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "When did therapy start",
      message: "Started 2026-08-10 and stopped 2026-08-15.",
      candidates: [value(P1_START, "2026-08-10", "2026-08-10"), value(P1_STOP, "2026-08-15", "2026-08-15")],
    },
    { kind: "chip", expectAsk: "Still need: therapy status and dose reduce", label: "I don't have that" },
    { kind: "chip", expectAsk: "What was it prescribed or used for", label: "I don't have that" },
    { kind: "chip", expectAsk: "Anything notable about the product type", label: "I don't have that" },
    { kind: "chip", expectAsk: "After stopping or reducing it", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was it given again", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was there another suspect product", label: "No" },
    { kind: "chip", expectAsk: "Is the patient on other medications", label: "I don't have that" },
    { kind: "chip", expectAsk: "Is there another medication to add", label: "No" },
    { kind: "chip", expectAsk: "Your contact details for the report", label: "I don't have that" },
    // Amended 2026-08-28 (#125): RC-1 is dismissed here UNTOUCHED —
    // nothing of the contact-details fact is on the record yet. Rule 8's
    // record-following name says that state is named plainly, "your
    // contact details", not "the rest of your contact details" (gate run
    // #1, entry 1's dismiss-acknowledgment half — quoted verbatim as
    // this unit's own worked example). This is the reference case's own
    // instance of a pattern repeated at every bare RC-1 dismiss across
    // C1-C5.
    { kind: "chip", expectAsk: "Marked your contact details as not on hand. Are you reporting as a health professional", label: "I don't have that" },
    { kind: "chip", expectAsk: "Two housekeeping items", label: "I don't have that" },
  ],
};

// --- C2 -------------------------------------------------------------------

// Steve's own 2026-08-26 staging input, character for character. The
// point of this case is what wilson does NOT ask: minimal data,
// non-serious, and "mostly not asking is the correct behavior".
const C2: GateCase = {
  id: "C2",
  title: "Steve's case",
  spec:
    'verbatim from his 2026-08-26 staging test — minimal data, non-serious; mostly *not* asking is the ' +
    'correct behavior. The clinician also states "no relevant history" and "nothing else to add" ' +
    "(exercises the text-ask negatives and the sentinel check, entry 5).",
  evidences: [1, 2, 5],
  surfaces: ["start", "read-back", "follow-ups", "review", "review-paper-facsimile", "open-fields", "ready", "report-chrome"],
  narrative: {
    text:
      "patient developed nagging cough while on lisinopril. reported yesterday, cough is " +
      "non-serious but ongoing",
    candidates: [
      value(DESC, "nagging cough", "nagging cough"),
      value(P1_NAME, "lisinopril", "lisinopril"),
    ],
  },
  steps: [
    { kind: "chip", expectAsk: "Who is the patient", label: "I don't have that" },
    { kind: "chip", expectAsk: "What's the patient's weight", label: "I don't have that" },
    { kind: "chip", expectAsk: "For FDA's demographics", label: "I don't have that" },
    { kind: "chip", expectAsk: "When did it happen", label: "I don't have that" },
    { kind: "chip", expectAsk: "How serious was the outcome", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "relevant history",
      message: "no relevant history",
      candidates: [{ fieldId: HISTORY, kind: "unknown", quote: "no relevant history" }],
    },
    { kind: "chip", expectAsk: "Any relevant tests or labs", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "Anything else",
      message: "nothing else to add",
      candidates: [{ fieldId: COMMENTS, kind: "unknown", quote: "nothing else to add" }],
    },
    { kind: "chip", expectAsk: "Still need: strength and manufacturer/comp", label: "I don't have that" },
    { kind: "chip", expectAsk: "Lot number", label: "I don't have that" },
    { kind: "chip", expectAsk: "NDC or unique ID as not on hand. How was i", label: "I don't have that" },
    { kind: "chip", expectAsk: "When did therapy start and stop", label: "I don't have that" },
    { kind: "chip", expectAsk: "What was it prescribed or used for", label: "I don't have that" },
    { kind: "chip", expectAsk: "Anything notable about the product type", label: "I don't have that" },
    { kind: "chip", expectAsk: "After stopping or reducing it", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was it given again", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was there another suspect product", label: "No" },
    { kind: "chip", expectAsk: "Is the patient on other medications", label: "I don't have that" },
    { kind: "chip", expectAsk: "Is there another medication to add", label: "No" },
    { kind: "chip", expectAsk: "Your contact details for the report", label: "I don't have that" },
    { kind: "chip", expectAsk: "Are you reporting as a health professional", label: "I don't have that" },
    { kind: "chip", expectAsk: "Two housekeeping items", label: "I don't have that" },
  ],
};

// --- C3 -------------------------------------------------------------------

// The case the pre-gate queue was sequenced around: it hits the collision
// reply, the correction offer, and the concomitant repeat group at once.
const C3: GateCase = {
  id: "C3",
  title: "messy multi-drug",
  spec:
    "two suspect products, three concomitants, labs, information volunteered out of ask order, one " +
    'cross-turn correction ("actually the 19th, not the 20th") **and one same-turn contradictory pair ' +
    '("500 mg — no, 875 mg") to force a collision** (entry 7).',
  evidences: [1, 2, 6, 7],
  surfaces: ["start", "read-back", "follow-ups", "review", "review-paper-facsimile", "open-fields", "ready", "report-chrome"],
  narrative: {
    text:
      "58-year-old man on amoxicillin and metformin developed a rash on the 20th. He also takes " +
      "lisinopril, atorvastatin and metformin. ALT was 402.",
    candidates: [
      value(AGE, "58", "58-year-old"),
      value(SEX_M, "true", "58-year-old man"),
      value(DESC, "rash", "developed a rash"),
      value(P1_NAME, "amoxicillin", "amoxicillin"),
    ],
  },
  steps: [
    { kind: "chip", expectAsk: "Still need: patient identifier and sex.", label: "I don't have that" },
    { kind: "chip", expectAsk: "What's the patient's weight", label: "I don't have that" },
    { kind: "chip", expectAsk: "For FDA's demographics", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "When did it happen",
      message: "The rash was on the 20th. ALT came back at 402, by the way.",
      candidates: [value(DATE_EVENT, "2026-08-20", "the 20th"), value(LAB_1, "ALT 402", "ALT came back at 402")],
    },
    { kind: "chip", expectAsk: "ALT 402. And the report type", label: "I don't have that" },
    { kind: "chip", expectAsk: "How serious was the outcome", label: "I don't have that" },
    { kind: "chip", expectAsk: "Any relevant history", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "Anything else",
      message: "Actually the rash was the 19th, not the 20th.",
      candidates: [value(DATE_EVENT, "2026-08-19", "the 19th")],
    },
    { kind: "chip", expectAsk: "Replace it", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "Still need: strength and manufacturer",
      message: "It was 500 mg \u2014 no, 875 mg.",
      candidates: [value(P1_STRENGTH, "500 mg", "500 mg"), value(P1_STRENGTH, "875 mg", "875 mg")],
    },
    { kind: "chip", expectAsk: "I write", label: "I don't have that" },
    { kind: "chip", expectAsk: "Lot number", label: "I don't have that" },
    { kind: "chip", expectAsk: "NDC or unique ID as not on hand. How was i", label: "I don't have that" },
    { kind: "chip", expectAsk: "When did therapy start and stop", label: "I don't have that" },
    { kind: "chip", expectAsk: "What was it prescribed or used for", label: "I don't have that" },
    { kind: "chip", expectAsk: "Anything notable about the product type", label: "I don't have that" },
    { kind: "chip", expectAsk: "After stopping or reducing it", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was it given again", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was there another suspect product", label: "Yes" },
    {
      kind: "type",
      expectAsk: "What's the second suspect product",
      message: "The second one was metformin.",
      candidates: [value(P2_NAME, "metformin", "metformin")],
    },
    { kind: "chip", expectAsk: "I'll ask about that once we get to additio", label: "I don't have that" },
    { kind: "chip", expectAsk: "Lot number", label: "I don't have that" },
    { kind: "chip", expectAsk: "NDC or unique ID as not on hand. How was i", label: "I don't have that" },
    { kind: "chip", expectAsk: "When did therapy start and stop", label: "I don't have that" },
    { kind: "chip", expectAsk: "What was it prescribed or used for", label: "I don't have that" },
    { kind: "chip", expectAsk: "Anything notable about the product type", label: "I don't have that" },
    { kind: "chip", expectAsk: "After stopping or reducing it", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was it given again", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "other medications",
      message: "Lisinopril, started years ago.",
      candidates: [value(CM_1, "lisinopril", "Lisinopril")],
    },
    { kind: "chip", expectAsk: "Is there another medication to add", label: "Yes" },
    // The count follow-through: "Yes" alone would write 2 and drop the
    // third, so RepeatDecision offers count chips and commits on one of
    // them. Three concomitants is what round-gate.md's C3 specifies, and
    // it is also what makes #111's per-instance CM-2 copy visible on
    // consecutive turns.
    { kind: "chip", expectAsk: REPEAT_COUNT_FOLLOW_THROUGH, label: "3" },
    { kind: "chip", expectAsk: "What's the second medication", label: "I don't have that" },
    { kind: "chip", expectAsk: "What's the third medication", label: "I don't have that" },
    { kind: "chip", expectAsk: "Your contact details for the report", label: "I don't have that" },
    { kind: "chip", expectAsk: "Are you reporting as a health professional", label: "I don't have that" },
    { kind: "chip", expectAsk: "Two housekeeping items", label: "I don't have that" },
  ],
};

// --- C4 -------------------------------------------------------------------

// Rule 5's device gate opens by the record saying so, never by a flag —
// so this case has to actually name a device and then be asked Section
// E's questions. If the gate does not open, the walk is short and the
// driver's own surface-coverage check fails the run.
const C4: GateCase = {
  id: "C4",
  title: "device involved",
  spec: "an EpiPen-class combination product — the Section E gate must open and its asks must run",
  evidences: [1, 2, 4],
  // The only case that opens Section E's gate, so it is the only one that
  // can evidence "gate-opened-device" for the union check — and it opens
  // the product-handling gate too, because gates.ts's
  // involvesProductHandling() falls through to isDeviceReport(). Both are
  // declared: a surface a case reaches but does not declare is one the
  // union check would depend on by accident.
  surfaces: [
    "start",
    "read-back",
    "follow-ups",
    "review",
    "review-paper-facsimile",
    "open-fields",
    "ready",
    "report-chrome",
    "gate-opened-device",
    "gate-opened-product-handling",
  ],
  narrative: {
    text:
      "Patient used an EpiPen auto-injector for anaphylaxis and the needle failed to deploy. " +
      "No epinephrine was delivered.",
    candidates: [
      value(DESC, "the needle failed to deploy", "the needle failed to deploy"),
      value(DEVICE_BRAND, "EpiPen", "EpiPen"),
    ],
  },
  steps: [
    { kind: "chip", expectAsk: "Who is the patient", label: "I don't have that" },
    { kind: "chip", expectAsk: "What's the patient's weight", label: "I don't have that" },
    { kind: "chip", expectAsk: "For FDA's demographics", label: "I don't have that" },
    { kind: "chip", expectAsk: "When did it happen", label: "I don't have that" },
    { kind: "chip", expectAsk: "How serious was the outcome", label: "I don't have that" },
    { kind: "chip", expectAsk: "Any relevant history", label: "I don't have that" },
    { kind: "chip", expectAsk: "Any relevant tests or labs", label: "I don't have that" },
    { kind: "chip", expectAsk: "Anything else FDA should know", label: "I don't have that" },
    { kind: "chip", expectAsk: "Is the product itself still available", label: "I don't have that" },
    { kind: "chip", expectAsk: "What's the suspect product", label: "I don't have that" },
    { kind: "chip", expectAsk: "Lot number", label: "I don't have that" },
    { kind: "chip", expectAsk: "NDC or unique ID as not on hand. How was i", label: "I don't have that" },
    { kind: "chip", expectAsk: "When did therapy start and stop", label: "I don't have that" },
    { kind: "chip", expectAsk: "What was it prescribed or used for", label: "I don't have that" },
    { kind: "chip", expectAsk: "Anything notable about the product type", label: "I don't have that" },
    { kind: "chip", expectAsk: "After stopping or reducing it", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was it given again", label: "I don't have that" },
    { kind: "chip", expectAsk: "Where and when was it purchased", label: "I don't have that" },
    // Amended 2026-08-28 (#125): SP-9 (purchase, gated) is dismissed here
    // UNTOUCHED, same rule-8 pattern as RC-1's own dismiss in C1 above —
    // the plain name, not "the rest of the purchase details".
    { kind: "chip", expectAsk: "Marked the purchase details as not on hand. Was there another suspect product", label: "No" },
    // Amended 2026-08-28 (#125): DV-1 arrives on this walk already
    // partially resolved (the narrative's own "EpiPen" fills BrandName),
    // and Section E's gate opens it only once — this IS DV-1's first-ever
    // utterance. Pre-#125 this rendered the bare re-ask frame, "And the
    // rest of the device details?", eight identifiers the clinician never
    // saw (gate run #1, entry 1). The fix is the arrival frame: the held
    // field named, then the bulk ask's own authored arrival line.
    { kind: "chip", expectAsk: "I've got device brand name. What are the rest of the device details?", label: "I don't have that" },
    { kind: "chip", expectAsk: "Who was operating the device", label: "I don't have that" },
    { kind: "chip", expectAsk: "Two device-history checks", label: "I don't have that" },
    { kind: "chip", expectAsk: "Is the patient on other medications", label: "I don't have that" },
    { kind: "chip", expectAsk: "Is there another medication to add", label: "No" },
    { kind: "chip", expectAsk: "Your contact details for the report", label: "I don't have that" },
    { kind: "chip", expectAsk: "Are you reporting as a health professional", label: "I don't have that" },
    { kind: "chip", expectAsk: "Two housekeeping items", label: "I don't have that" },
  ],
};

// --- C5 -------------------------------------------------------------------

// The reluctant reporter. Both dismiss chips, and — the part that
// matters — PARTIAL answers, which are what force rule 9's re-ask frames
// to render. An all-chips walk never sees one.
const C5: GateCase = {
  id: "C5",
  title: "reluctant reporter",
  spec:
    'heavy "I don\'t have that" / "rather not say", partial answers forcing rule-9 re-asks, a repeat ' +
    'decision answered "no"',
  evidences: [1, 2, 3],
  // The Start surface requires a dictation (validateNarrative rejects an
  // empty one), so a reluctant reporter still opens with something — and
  // theirs grounds NOTHING, which is the only case that renders
  // Read-back's empty panel. The walk below is therefore identical to one
  // entered with no narrative at all.
  surfaces: ["start", "read-back", "follow-ups", "review", "review-paper-facsimile", "open-fields", "ready", "report-chrome"],
  narrative: {
    text: "Patient had a reaction. I would rather not go into detail beyond what you ask for.",
    candidates: [],
  },
  steps: [
    {
      kind: "type",
      expectAsk: "Who is the patient",
      message: "MRN 51-7788.",
      candidates: [value(IDENT, "MRN 51-7788", "MRN 51-7788")],
    },
    { kind: "chip", expectAsk: "Still need: age and sex.", label: "Rather not say" },
    { kind: "chip", expectAsk: "What's the patient's weight", label: "Rather not say" },
    { kind: "chip", expectAsk: "For FDA's demographics", label: "Rather not say" },
    {
      kind: "type",
      expectAsk: "Describe what happened",
      message: "Hives after the first dose.",
      candidates: [value(DESC, "Hives after the first dose", "Hives after the first dose")],
    },
    {
      kind: "type",
      expectAsk: "When did it happen",
      message: "2026-07-30.",
      candidates: [value(DATE_EVENT, "2026-07-30", "2026-07-30")],
    },
    { kind: "chip", expectAsk: "And the report type", label: "I don't have that" },
    { kind: "chip", expectAsk: "How serious was the outcome", label: "I don't have that" },
    { kind: "chip", expectAsk: "Any relevant history", label: "Rather not say" },
    { kind: "chip", expectAsk: "Any relevant tests or labs", label: "Rather not say" },
    { kind: "chip", expectAsk: "Anything else FDA should know", label: "I don't have that" },
    {
      kind: "type",
      expectAsk: "suspect product",
      message: "Cephalexin.",
      candidates: [value(P1_NAME, "Cephalexin", "Cephalexin")],
    },
    { kind: "chip", expectAsk: "Still need: strength and manufacturer/comp", label: "I don't have that" },
    { kind: "chip", expectAsk: "Lot number", label: "I don't have that" },
    { kind: "chip", expectAsk: "NDC or unique ID as not on hand. How was i", label: "I don't have that" },
    { kind: "chip", expectAsk: "When did therapy start and stop", label: "I don't have that" },
    { kind: "chip", expectAsk: "What was it prescribed or used for", label: "Rather not say" },
    { kind: "chip", expectAsk: "Anything notable about the product type", label: "I don't have that" },
    { kind: "chip", expectAsk: "After stopping or reducing it", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was it given again", label: "I don't have that" },
    { kind: "chip", expectAsk: "Was there another suspect product", label: "No" },
    { kind: "chip", expectAsk: "Is the patient on other medications", label: "I don't have that" },
    { kind: "chip", expectAsk: "Is there another medication to add", label: "No" },
    { kind: "chip", expectAsk: "Your contact details for the report", label: "Rather not say" },
    { kind: "chip", expectAsk: "Are you reporting as a health professional", label: "Rather not say" },
    { kind: "chip", expectAsk: "Two housekeeping items", label: "Rather not say" },
  ],
};

// --- C6 -------------------------------------------------------------------

// Not a walk of its own: C2 driven to Ready, then C3 started through
// Ready's own "Start over" in the SAME browser state. The pass bar is
// about what does NOT survive that transition.
const C6: GateCase = {
  id: "C6",
  title: "second run",
  spec:
    'complete C2 to Ready, start C3 via Ready\'s "Start over", in the same browser state. Pass bar ' +
    "while #93 is undecided: no C2 data bleeds into C3 and no dishonest claims; the known " +
    "mid-interview-resume gap (#93) is *reported* in the verdict as standing intake, never " +
    "verdict-bearing, until its design lands.",
  evidences: [1, 8],
  // Twice through, so every surface is seen on BOTH sides of a Start
  // over — which is the only way "no C2 data bleeds into C3" is visible.
  surfaces: ["start", "read-back", "follow-ups", "review", "review-paper-facsimile", "open-fields", "ready", "report-chrome"],
  narrative: C2.narrative,
  steps: C2.steps,
  thenStartOver: "C3",
};

export const GATE_CASES: GateCase[] = [C1, C2, C3, C4, C5, C6];

export function gateCase(id: string): GateCase {
  const found = GATE_CASES.find((c) => c.id === id);
  if (!found) {
    throw new Error(`gate: no such case ${id} (have: ${GATE_CASES.map((c) => c.id).join(", ")})`);
  }
  return found;
}

// The extraction script for a case — what src/lib/scripted-extract.ts
// consumes, derived from the case rather than maintained beside it, so a
// message and its extraction cannot disagree.
//
// For C6 the two runs share one process, so the script must carry BOTH
// walks' turns; the scripted proposer keys on message text, not on which
// run is in progress, and the two cases share no message.
export function scriptFor(gateCase: GateCase): ExtractionScript {
  const cases = [gateCase, ...(gateCase.thenStartOver ? [findFor(gateCase.thenStartOver)] : [])];
  const turns = cases.flatMap((c) =>
    c.steps
      .filter((step): step is GateTypeStep => step.kind === "type")
      .map((step) => ({
        message: step.message,
        candidates: step.candidates,
        ...(step.repeatDecision ? { repeatDecision: step.repeatDecision } : {}),
      })),
  );
  const narratives = cases
    .filter((c) => c.narrative !== undefined)
    .map((c) => ({
      narrative: c.narrative!.text,
      candidates: c.narrative!.candidates,
      ...(c.narrative!.repeatDecisions ? { repeatDecisions: c.narrative!.repeatDecisions } : {}),
    }));
  return { caseId: gateCase.id, ...(narratives.length > 0 ? { narratives } : {}), turns };
}

// Separate from gateCase() only to keep scriptFor()'s recursion obvious:
// a case's follow-on is looked up by id, and a follow-on that itself had
// a follow-on would be a chain this deliberately does not build.
function findFor(id: string): GateCase {
  const found = GATE_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`gate: case ${id} names a follow-on that does not exist`);
  if (found.thenStartOver) throw new Error(`gate: case ${id} is a follow-on and may not have one of its own`);
  return found;
}
