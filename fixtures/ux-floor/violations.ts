// Injected violations for the UX floor's checks (Issue #91, AC-5: "an
// injected-violation fixture per check (the check goes red on it)
// committed alongside").
//
// Every fixture here reproduces something that ACTUALLY SHIPPED. v1.1
// generated question text from manifest labels — the text after the last
// ":", lowercased, plus "(yes or no)" for checkboxes, three fields joined
// per ask — and Steve rejected the deployed build on first contact
// (2026-08-26). What each fixture carries is that generator's real output
// for the ask it names, not a plausible-looking imitation, so a check
// going red here is a check that would have caught the rejection.
//
// The double-bubble class has no data fixture worth trusting on its own:
// its real injected violation is the pre-#89 render rule, driven over the
// same scripted walk in ux-floor.test.ts. The frames below are the
// belt-and-braces version — the class stated as data, so the check is
// provable without a walk.
import type { RenderedFrame, RenderedString, WalkTurn } from "../../src/lib/ux-floor";

// v1.1's OC-1: seven outcome checkboxes, each question built from its own
// manifest label. The label is spliced into a sentence, which is why the
// check tests for a label CONTAINED in a string rather than equal to one.
export const MANIFEST_LABEL_INVENTORY: RenderedString[] = [
  { source: "ask:PB-1", text: "Who is the patient — an identifier like an MRN or initials, their age, and sex?" },
  {
    source: "ask:OC-1",
    // The Hospital field's manifest label, verbatim, spliced into a
    // question the way v1.1's template spliced it.
    text: "What's the Outcome Attributed to Adverse Event: Hospitalization (Initial or prolonged)?",
  },
];

// The exact shape Steve was shown: a three-field checkbox ask with the
// template's option suffix on every slice. SP-7 is the one the handoff
// quotes; RA-1 is a second so the check is proven to find more than the
// first.
export const TEMPLATE_MARKER_INVENTORY: RenderedString[] = [
  { source: "ask:WH-1", text: "Describe what happened — the event, product problem, or medication error." },
  {
    source: "ask:SP-7",
    text: "What's the yes (yes or no), the no (yes or no), and the doesn't apply (yes or no)?",
  },
  { source: "ask:RA-1", text: "What's the health professional (Yes or No)?" },
];

// One violation per field-id shape item 7 names, so no shape is in the
// regex list untested. The middle one is the class rule 6 exists to
// prevent: a display name falling back to the raw id.
export const FIELD_ID_INVENTORY: RenderedString[] = [
  { source: "ask:SP-1", text: "What's the Page4.Prod1.Prod1Name — name, strength, and manufacturer?" },
  { source: "display-name:death", text: "Prod1.Death" },
  { source: "sweep:out-of-ask", text: "Also noted: SecA_Patient — 58." },
  { source: "ask:PB-2", text: "What's the patient's weight — and date of birth, if you record it?" },
];

// A dose unit read straight off the manifest's options[]. Legal as a
// stored value, never as something to say out loud.
export const OPTION_CODE_INVENTORY: RenderedString[] = [
  { source: "ask:SP-3", text: "How was it taken — dose, how often, and by what route?" },
  { source: "sweep:out-of-ask", text: "Also noted: dose unit — MILLIGRAM(S) - MG." },
];

// A re-ask that repeats the ask it follows, instead of naming what is
// still open. This is what rule 9's frames exist to prevent, and what the
// no-consecutive-duplicates check holds them to: "A frame is never
// byte-equal to the primary ask, so the no-consecutive-duplicates check
// holds across the pair."
// These walks exercise the count and duplicate checks, which say nothing
// about repeat groups — so the two repeat fields are filled with the
// "not a repeat instance" value rather than restated at every entry.
// Kept required on WalkTurn itself: scriptedWalk() must set them, and an
// optional field is one scriptedWalk could silently stop populating.
function nonRepeating<T extends { kind: WalkTurn["kind"]; id: string; text: string }>(turn: T): WalkTurn {
  return { ...turn, repeatGroup: null, repeatInstance: null };
}

export const TWICE_IN_A_ROW_WALK: WalkTurn[] = [
  nonRepeating({ kind: "ask", id: "PB-1", text: "Who is the patient — an identifier like an MRN or initials, their age, and sex?" }),
  nonRepeating({ kind: "ask", id: "PB-1", text: "Who is the patient — an identifier like an MRN or initials, their age, and sex?" }),
  nonRepeating({ kind: "ask", id: "PB-2", text: "What's the patient's weight — and date of birth, if you record it?" }),
];

// A walk that drifts off the stated count without breaking the ceiling —
// the quiet failure, and the one a ceiling alone would miss. Twenty asks
// where the contract states 21: an ask silently dropped out of the walk.
export const SHORT_WALK: WalkTurn[] = [
  ...Array.from({ length: 20 }, (_, i) => nonRepeating({ kind: "ask" as const, id: `A-${i + 1}`, text: `ask ${i + 1}` })),
  nonRepeating({ kind: "repeat-decision", id: "suspect-product", text: "Was there another suspect product?" }),
  nonRepeating({ kind: "repeat-decision", id: "concomitant-medication", text: "Is there another medication to add?" }),
];

// The walk Steve was actually shown: 58 asks where the contract states 21
// and caps at 24. Both halves of AC-3 fire on it.
export const OVER_CEILING_WALK: WalkTurn[] = Array.from({ length: 58 }, (_, i) =>
  nonRepeating({ kind: "ask" as const, id: `A-${i + 1}`, text: `ask ${i + 1}` }),
);

// The double bubble as data: the current ask, and the transcript turn
// that carries the same string, on screen at once. Steve's staging
// screenshot, in one frame.
const DOUBLE_BUBBLE_ASK = "Any relevant history — preexisting conditions, allergies, pregnancy, tobacco or alcohol use?";

export const DOUBLE_BUBBLE_FRAMES: RenderedFrame[] = [
  [
    { source: "transcript[0]", text: "Describe what happened — the event, product problem, or medication error, in your own words." },
    { source: "transcript[1]", text: "Rash across the trunk, 36 hours after the second dose." },
    { source: "transcript[2]", text: DOUBLE_BUBBLE_ASK },
    { source: "current-ask", text: DOUBLE_BUBBLE_ASK },
  ],
];

// The adjacency the CM-2-{n} amendment depends on, broken exactly the way
// #43 would break it: the concomitant group's repeat decision is gone
// (its count arrived from the opening narrative instead), so instance 2's
// ask lands directly after the last suspect-product ask. "What's the
// second medication?" then follows "Was it given again — and if so, did
// the event come back?", where a clinician reasonably answers about the
// second SUSPECT drug and the write lands on a concomitant row.
//
// Not a hypothetical shape: every turn here is the real authored copy,
// and the only thing removed is the repeat-decision turn between them.
export const REPEAT_INSTANCE_ORPHAN_WALK: WalkTurn[] = [
  // A legitimately-reached later instance, so the fixture isolates the
  // ONE orphan rather than also tripping on its own first turn.
  {
    kind: "repeat-decision",
    id: "suspect-product",
    text: "Was there another suspect product?",
    repeatGroup: "suspect-product",
    repeatInstance: null,
  },
  {
    kind: "ask",
    id: "SP-8-2",
    text: "Was it given again — and if so, did the event come back?",
    repeatGroup: "suspect-product",
    repeatInstance: 2,
  },
  {
    kind: "ask",
    id: "CM-2-2",
    text: "What's the second medication — its name, and rough start and stop dates?",
    repeatGroup: "concomitant-medication",
    repeatInstance: 2,
  },
];
