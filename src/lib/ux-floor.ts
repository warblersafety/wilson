// The UX floor (Issue #91): the defect classes Steve's 2026-08-26
// rejection named, turned into mechanical checks that run in the ordinary
// test job.
//
// docs/ask-copy.md, "Consequences for the machinery" item 7: the checks
// run "over an exhaustive enumeration of the pure copy helpers — every
// topic, both repeat instances, every gate state, and every voice pattern
// (Machinery copy and rule-9 frames included) with fixture values, never
// just the reference path". That last clause is the whole point. v1.1's
// suite was green the day Steve rejected the deployed build, because
// every test in it exercised one ask on one path; the copy a clinician
// actually read — 59 turns of "What's the yes (yes or no), the no (yes or
// no), and the doesn't apply (yes or no)?" — was never enumerated.
//
// **Why the checks are functions over data, not assertions.** Each check
// takes the strings (or the walk, or the rendered frames) as an argument
// and RETURNS its violations rather than asserting. That shape is what
// lets ux-floor.test.ts run every check twice: green over the real build,
// and red over an injected-violation fixture that reproduces the shipped
// defect (fixtures/ux-floor/violations.ts). A check nobody has watched
// fail is a check nobody knows is wired up — which is exactly what the
// v1.1 suite turned out to be.
//
// Pure and synchronous throughout except scriptedFrames(), which drives
// the real async Talker loop. No model call, no network, no DOM.
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import {
  askCopy,
  askDeterministic,
  DONE_MESSAGE,
  REPEAT_DECISION_COPY,
  REPEAT_GROUP_LABELS,
  VOLUNTEERED_REPEAT_HINT,
} from "./ask";
import { AUTHORED_ASKS, unresolvedAskFieldIds } from "./ask-inventory";
import { displayName } from "./display-names";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { GATED_OFF_RAIL_STATE } from "./gates";
import { describeFollowUpSweep, type FollowUpSweepResult } from "./followup-sweep";
import { OPEN_FIELD_REASONS, OPEN_FIELDS_COPY, openFieldsHeading } from "./open-fields";
import { READ_BACK_COPY } from "./read-back";
import { READY_COPY, START_OVER_CONFIRM_COPY } from "./ready";
import { GATED_OFF_RAIL_MARK } from "./report-chrome";
import { GATED_OFF_REVIEW_COPY, PDF_COPY, REVIEW_COPY, SIGN_OFF_CTA } from "./review";
import { START_COPY } from "./start-surface";
import { SESSION_EXPORT_COPY } from "./session-export";
import { initTalkSession, processTurn, startTalk, type ExtractFn, type TalkStep } from "./talk";
import { initRepeatCounts, nextStep, setRepeatCount, TOPICS, type NextStep, type RepeatGroup } from "./topics";
import { dismissAcknowledgment, widgetTurnText } from "./chip-grammar";

// A string a clinician can read, and where it came from. The source is
// what makes a violation actionable: "a manifest label reached a
// clinician" is a bug report; "ask:OC-1 carries the label 'Outcome
// Attributed to Adverse Event: Hospitalization'" is a fix.
export interface RenderedString {
  source: string;
  text: string;
}

export interface UxFloorViolation {
  check: string;
  source: string;
  text: string;
  detail: string;
}

// One rendered moment of the Follow-ups surface: every string on screen
// at once, in render order.
export type RenderedFrame = RenderedString[];

export interface WalkTurn {
  kind: "ask" | "repeat-decision";
  // The contract's own ask id ("SP-4"), or the repeat group's name — what
  // the turn IS, as distinct from what it currently says. A seeded gate
  // can leave part of an ask already answered, so the same ask renders as
  // rule 9's frame rather than its primary copy; identity is what stays
  // comparable across gate states.
  id: string;
  text: string;
}

// docs/ask-copy.md, "Counts": "The ungated single-product no-device walk
// contains exactly 21 authored asks... Hard ceiling: 24 — an amendment
// that pushes past it returns to a design conversation first." Both
// numbers live here so a contract amendment and a build change fail in
// the same place.
export const STATED_UNGATED_ASK_COUNT = 21;
export const ASK_COUNT_CEILING = 24;

// dismissAcknowledgment() takes a whole NextStep, so the enumeration
// needs each ask's own topic — the ask inventory carries only its id.
const TOPICS_BY_ID = Object.fromEntries(TOPICS.map((topic) => [topic.id, topic]));

// --- the enumeration ------------------------------------------------------

// Rule 8's "Patterns" list, rendered with fixture values. Four sentence
// kinds, each built by describeFollowUpSweep() from a result the
// classifier could really produce — reference-case vocabulary, so a
// violation reads like something a clinician would have seen.
const AGE_VALUE = "Page1.SecA_Patient.AgeValue";
const DOB = "Page1.SecA_Patient.DateBirth";

const SWEEP_FIXTURES: Array<[string, FollowUpSweepResult]> = [
  [
    "out-of-ask",
    {
      writes: [{ fieldId: AGE_VALUE, type: "answer", value: "58" }],
      outOfAskWrites: [{ fieldId: AGE_VALUE, type: "answer", value: "58" }],
      correctionOffers: [],
      collisions: [],
      volunteeredRepeatGroups: [],
    },
  ],
  [
    "correction-offer",
    {
      writes: [],
      outOfAskWrites: [],
      correctionOffers: [
        {
          fieldId: DOB,
          action: { fieldId: DOB, type: "answer", value: "1968-04-11" },
          currentState: "answered",
          currentValue: "1968-04-12",
        },
      ],
      collisions: [],
      volunteeredRepeatGroups: [],
    },
  ],
  [
    "collision",
    {
      writes: [],
      outOfAskWrites: [],
      correctionOffers: [],
      collisions: [{ fieldId: AGE_VALUE, values: ["58", "62"] }],
      volunteeredRepeatGroups: [],
    },
  ],
  [
    "volunteered-repeat",
    {
      writes: [],
      outOfAskWrites: [],
      correctionOffers: [],
      collisions: [],
      volunteeredRepeatGroups: ["suspect-product", "concomitant-medication"],
    },
  ],
];

// Every string the build can put in front of a clinician, enumerated.
//
// Asks come from the inventory rather than from a walk, deliberately: a
// walk shows only the asks its own gate state reaches, and item 7's
// enumeration covers "every gate state" — which for COPY means every
// authored ask, gated or not, conditional or not. The walk-driven checks
// below cover what a walk is for (order, count, repetition).
export function renderedCopyInventory(): RenderedString[] {
  const out: RenderedString[] = [];
  const record = initAgenda();

  for (const ask of AUTHORED_ASKS) {
    out.push({ source: `ask:${ask.id}`, text: ask.copy });
    // Rule 9's frames, at every partial state an ask can reach: one
    // resolved field at a time is where the most facts are still open,
    // and therefore where a frame is longest and most able to leak a
    // field list. The reference path renders none of these.
    for (const resolved of ask.askFieldIds) {
      const partial: AgendaRecord = { ...record, [resolved]: { state: "answered", value: "x" } };
      // An ask whose one answer settled every fact it waits on has
      // nothing left to ask, and askCopy() refuses to compose copy for it
      // (ask.ts). Asked of the same function askCopy() asks, rather than
      // caught from its throw: a catch here would also swallow "record
      // missing field id" — the inventory naming a field the manifest
      // does not have — and silently drop that ask's frames out of the
      // sweep. A floor that quietly stops checking is the failure this
      // whole unit exists to prevent, so the only thing skipped here is
      // the case that genuinely has no string to render.
      if (unresolvedAskFieldIds(ask, partial).length === 0) continue;
      out.push({ source: `re-ask:${ask.id}/${resolved}`, text: askCopy(ask, partial) });
    }
  }

  out.push({ source: "machinery:done", text: DONE_MESSAGE });
  out.push({ source: "machinery:volunteered-hint", text: VOLUNTEERED_REPEAT_HINT });
  for (const [group, copy] of Object.entries(REPEAT_DECISION_COPY)) {
    out.push({ source: `machinery:repeat-decision/${group}`, text: copy });
    // The hint's rendered form, not just its prefix — what a clinician
    // reads is the composed line.
    out.push({ source: `machinery:volunteered/${group}`, text: `${VOLUNTEERED_REPEAT_HINT}${copy}` });
  }
  for (const [group, label] of Object.entries(REPEAT_GROUP_LABELS)) {
    out.push({ source: `machinery:group-label/${group}`, text: label });
  }

  // Rule 6's names. Every field, not every asked field: the open-fields
  // dialog and Review rows name derive and write-target fields too, and
  // those are exactly the ones no ask ever voices — so a raw label would
  // survive there unseen.
  for (const field of FORM_3500_FIELDS) {
    out.push({ source: `display-name:${field.id}`, text: displayName(field.id) });
  }

  for (const [kind, result] of SWEEP_FIXTURES) {
    out.push({ source: `sweep:${kind}`, text: describeFollowUpSweep(result) });
  }

  // Rule 8's dismiss acknowledgment (#110), for EVERY ask and both
  // chips — not a fixture pair. The acknowledgment names an ask's facts,
  // so the asks most able to leak a field list are the ones with the most
  // fields per fact (DV-1's ten, RC-1's eight), and a hand-picked fixture
  // is exactly what would have left those out. Passes ask.askFieldIds
  // directly rather than a record's unresolved slice: an untouched ask
  // waits on all of them, so this is the longest sentence each one can
  // produce, and it is the state to check for a leaked field list.
  for (const ask of AUTHORED_ASKS) {
    const step: NextStep = { kind: "topic", topic: TOPICS_BY_ID[ask.topicId], ask, fieldIds: ask.askFieldIds };
    for (const action of ["mark_unknown", "decline"] as const) {
      const text = dismissAcknowledgment(step, action);
      if (text === undefined) continue;
      out.push({ source: `sweep:dismiss/${ask.id}/${action}`, text });
    }
  }

  for (const [key, copy] of Object.entries(OPEN_FIELDS_COPY)) {
    out.push({ source: `open-fields:${key}`, text: copy });
  }
  for (const [kind, copy] of Object.entries(OPEN_FIELD_REASONS)) {
    out.push({ source: `open-fields:reason/${kind}`, text: copy });
  }
  out.push({ source: "open-fields:heading/1", text: openFieldsHeading(1) });
  out.push({ source: "open-fields:heading/7", text: openFieldsHeading(7) });

  // The surrounding surfaces. A manifest label leaking onto Review or
  // Ready is the same defect as one leaking into an ask — rule 6 is
  // "every field has a short human name", not "every asked field".
  // ready.test.ts enumerates these same constants for a different rule
  // (design.md's no-submission-claims); the overlap is deliberate, and
  // neither list is derived from the other.
  const surfaces: Array<[string, Record<string, string>]> = [
    ["ready", READY_COPY],
    ["start-over", START_OVER_CONFIRM_COPY],
    ["review", REVIEW_COPY],
    ["pdf", PDF_COPY],
    ["read-back", READ_BACK_COPY],
    ["start", START_COPY],
    // Issue #92's downloads, on both closing surfaces.
    ["session-export", SESSION_EXPORT_COPY],
  ];
  for (const [name, copy] of surfaces) {
    for (const [key, text] of Object.entries(copy)) {
      out.push({ source: `surface:${name}/${key}`, text });
    }
  }
  out.push({ source: "surface:review/sign-off", text: SIGN_OFF_CTA });
  out.push({ source: "surface:review/gated-off", text: GATED_OFF_REVIEW_COPY });
  out.push({ source: "surface:rail/gated-off", text: GATED_OFF_RAIL_STATE });
  out.push({ source: "surface:rail/gated-mark", text: GATED_OFF_RAIL_MARK });

  return out;
}

// --- the string checks ----------------------------------------------------

// One violation per string per check, naming the first thing it carries —
// not one per (string, pattern) pair. The unit of repair is the string: a
// question that splices in two manifest labels is one question to
// rewrite, and a field id matching both `Page\d` and `Prod\d.` is one
// leak, not two. Reporting per pattern buries a 50-ask regression under
// 200 lines of the same finding.
function firstMatchViolations(
  inventory: RenderedString[],
  check: string,
  match: (text: string) => string | undefined,
  describe: (hit: string) => string,
): UxFloorViolation[] {
  const out: UxFloorViolation[] = [];
  for (const entry of inventory) {
    const hit = match(entry.text);
    if (hit !== undefined) {
      out.push({ check, source: entry.source, text: entry.text, detail: describe(hit) });
    }
  }
  return out;
}

const MANIFEST_LABELS: string[] = FORM_3500_FIELDS.map((field) => field.label);

// "Contains", not "equals" — the stricter of the two readings AC-1 and
// item 7 give, and it holds today across all 337 rendered strings. v1.1's
// defect was never a bare label standing alone; it was a label spliced
// into a sentence ("What's the outcome attributed to adverse event:
// hospitalization?"), which an equality check would have passed.
export function manifestLabelViolations(inventory: RenderedString[]): UxFloorViolation[] {
  return firstMatchViolations(
    inventory,
    "manifest-label",
    (text) => MANIFEST_LABELS.find((label) => text.includes(label)),
    (label) => `carries the manifest label ${JSON.stringify(label)}`,
  );
}

// The option suffix v1.1's template appended to every checkbox, and its
// class. Written as a shape rather than a literal so a template that
// spelled it "(true or false)" is caught by the same check — the defect
// is machine-generated option text in a question, not one string.
const TEMPLATE_MARKERS: RegExp[] = [/\((?:yes|no|true|false)(?:\s*(?:or|\/)\s*(?:yes|no|true|false))+\)/i];

export function templateMarkerViolations(inventory: RenderedString[]): UxFloorViolation[] {
  return firstMatchViolations(
    inventory,
    "template-marker",
    (text) => TEMPLATE_MARKERS.map((marker) => text.match(marker)?.[0]).find((hit) => hit !== undefined),
    (hit) => `carries the template marker ${JSON.stringify(hit)}`,
  );
}

// The three shapes a Form 3500 field id takes (item 7's own list). Not a
// full id match: the defect to catch is a FRAGMENT of an id surfacing,
// which is how a half-formatted name reaches a clinician.
const FIELD_ID_SHAPES: RegExp[] = [/Page\d/, /Prod\d\./, /Sec[A-G]_/];

export function fieldIdShapedViolations(inventory: RenderedString[]): UxFloorViolation[] {
  return firstMatchViolations(
    inventory,
    "field-id-shaped",
    (text) => FIELD_ID_SHAPES.map((shape) => text.match(shape)?.[0]).find((hit) => hit !== undefined),
    (hit) => `carries the field-id fragment ${JSON.stringify(hit)}`,
  );
}

// A PDF option string that carries an export code — "MILLIGRAM(S) - MG",
// "PERCENT - %". Item 7 names these alongside labels and field ids, and
// they are the likeliest of the three to reach a clinician by accident:
// a dose unit or a frequency read straight off the manifest's options[]
// is a legal value, so nothing else would object to it.
//
// Code-bearing options only. Plain ones ("Oral", "Nurse", "Unknown") are
// ordinary English a sentence may legitimately contain.
const OPTION_CODES: string[] = [
  ...new Set(
    FORM_3500_FIELDS.flatMap((field) => field.options ?? []).filter((option) => / - [A-Z%/][A-Z%/. ]*$/.test(option)),
  ),
];

export function optionCodeViolations(inventory: RenderedString[]): UxFloorViolation[] {
  return firstMatchViolations(
    inventory,
    "option-code",
    (text) => OPTION_CODES.find((option) => text.includes(option)),
    (option) => `carries the PDF option code ${JSON.stringify(option)}`,
  );
}

// --- the walk checks ------------------------------------------------------

// Marks every field an ask waits on as unknown — the "I don't have that"
// chip's own write path, and the only way to walk past an ask without
// inventing manifest-valid values.
function dismiss(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
  return fieldIds.reduce((rec, id) => applyAction(rec, id, { type: "mark_unknown" }), record);
}

// What the clinician answers to a repeat decision: the new total for the
// group. Returning `afterInstance` is "no, that was the last one".
export type RepeatChoice = (group: RepeatGroup, afterInstance: number) => number;

// The reference path: every group declined. This is what the contract's
// stated ask count describes, and — until this parameter existed — it was
// the ONLY walk any check ran over.
const DECLINE_REPEATS: RepeatChoice = (_group, afterInstance) => afterInstance;

// Every turn the walk actually voices, in order, from a fresh session
// dismissed straight through to done. `seed` opens gates: an empty record
// is rule 5's ungated single-product no-device walk, which is what the
// contract's stated count describes. `choose` decides each repeat group's
// total, so a walk with three concomitant medications is reachable —
// see REPEAT_COUNT_CHOICES for why that matters.
export function scriptedWalk(
  seed: AgendaRecord = initAgenda(),
  choose: RepeatChoice = DECLINE_REPEATS,
): WalkTurn[] {
  let record = seed;
  let counts = initRepeatCounts();
  const turns: WalkTurn[] = [];
  for (let guard = 0; guard < 200; guard += 1) {
    const step = nextStep(record, counts);
    if (step.kind === "done") return turns;
    if (step.kind === "repeat-decision") {
      turns.push({
        kind: "repeat-decision",
        id: step.repeatGroup,
        text: REPEAT_DECISION_COPY[step.repeatGroup],
      });
      counts = setRepeatCount(counts, step.repeatGroup, choose(step.repeatGroup, step.afterInstance));
      continue;
    }
    turns.push({ kind: "ask", id: step.ask.id, text: askCopy(step.ask, record) });
    record = dismiss(record, step.fieldIds);
  }
  throw new Error("scriptedWalk: the walk never reached done");
}

// Item 7's "every gate state", for the walk-driven checks. Each seed
// opens a gate the way rule 5 says it opens — by the record saying so,
// never by a flag.
export const GATE_STATE_SEEDS: Array<[string, () => AgendaRecord]> = [
  ["ungated", () => initAgenda()],
  [
    "product-handling",
    () => applyAction(initAgenda(), "Page1.SecA_Patient.Defects", { type: "answer" }, "true"),
  ],
  [
    "device",
    () => applyAction(initAgenda(), "Page6.SecE_Device.BrandName", { type: "answer" }, "InfusePro 400"),
  ],
  [
    "product-handling-and-device",
    () =>
      applyAction(
        applyAction(initAgenda(), "Page1.SecA_Patient.Defects", { type: "answer" }, "true"),
        "Page6.SecE_Device.BrandName",
        { type: "answer" },
        "InfusePro 400",
      ),
  ],
  [
    "death-recorded",
    () => applyAction(initAgenda(), "Page1.SecA_Patient.Death", { type: "answer" }, "true"),
  ],
];

// The second dimension of "never just the reference path", and the one
// the first cut of this file missed: how many instances a repeat group
// has. Gate state changes WHICH asks the walk reaches; repeat count
// changes how many times it reaches the same one — and a group's later
// instances share one authored string, so that is where a walk can
// repeat itself without any ask being wrong.
//
// Suspect products stop at 2 and their copy distinguishes the second
// ("the second suspect product"). Concomitant medications go to 10 and
// theirs does not — see the departure ux-floor.test.ts pins, and #111.
export const REPEAT_COUNT_CHOICES: Array<[string, RepeatChoice]> = [
  ["declined", DECLINE_REPEATS],
  ["two-suspect-products", (group, after) => (group === "suspect-product" ? 2 : after)],
  ["three-concomitant-medications", (group, after) => (group === "concomitant-medication" ? 3 : after)],
  [
    "every-group-at-capacity",
    (group, after) => {
      if (group === "suspect-product") return 2;
      if (group === "concomitant-medication") return 10;
      return after;
    },
  ],
];

export function consecutiveDuplicateViolations(turns: WalkTurn[]): UxFloorViolation[] {
  const out: UxFloorViolation[] = [];
  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i].text === turns[i - 1].text) {
      out.push({
        check: "consecutive-duplicate",
        source: `turn:${i} (${turns[i].id})`,
        text: turns[i].text,
        detail: `turn ${i} repeats the turn before it`,
      });
    }
  }
  return out;
}

// AC-3, both halves. The stated count and the ceiling are separate
// failures on purpose: drifting off 21 is a contract disagreement someone
// has to reconcile, while crossing 24 is the thing the contract says
// returns to a design conversation.
export function askCountViolations(turns: WalkTurn[]): UxFloorViolation[] {
  const asks = turns.filter((turn) => turn.kind === "ask").length;
  const out: UxFloorViolation[] = [];
  if (asks !== STATED_UNGATED_ASK_COUNT) {
    out.push({
      check: "ask-count",
      source: "scripted-walk",
      text: `${asks} asks`,
      detail: `the walk asks ${asks}; docs/ask-copy.md states ${STATED_UNGATED_ASK_COUNT}`,
    });
  }
  if (asks > ASK_COUNT_CEILING) {
    out.push({
      check: "ask-ceiling",
      source: "scripted-walk",
      text: `${asks} asks`,
      detail: `the walk asks ${asks}, past the contract's hard ceiling of ${ASK_COUNT_CEILING}`,
    });
  }
  return out;
}

// --- the rendered-frame check ---------------------------------------------

// Dismisses whatever the visible question named, and answers each repeat
// decision "no" — the same path scriptedWalk() takes, driven through the
// real async Talker so the frames are what the surface would actually
// render.
const dismissWhatWasAsked: ExtractFn = async (session) => {
  const step = nextStep(session.record, session.repeatCounts);
  if (step.kind === "repeat-decision") {
    return { actions: [], repeatDecision: { repeatGroup: step.repeatGroup, count: step.afterInstance } };
  }
  if (step.kind !== "topic") return { actions: [] };
  return { actions: step.fieldIds.map((fieldId) => ({ fieldId, type: "mark_unknown" as const })) };
};

// Every step of a scripted walk, start to done, through the real async
// Talker. Exported because more than one thing needs a real session
// rather than a hand-built one: the frames below, and #92's export
// equality tests, which must compare a bundle against a session the
// actual machinery produced.
export async function scriptedSteps(): Promise<TalkStep[]> {
  let step: TalkStep = await startTalk(initTalkSession(), { ask: askDeterministic });
  const steps: TalkStep[] = [];
  for (let guard = 0; guard < 200; guard += 1) {
    steps.push(step);
    if (step.nextStep.kind === "done") return steps;
    step = await processTurn(step.session, widgetTurnText(step.reply, "I don't have that"), {
      ask: askDeterministic,
      extract: dismissWhatWasAsked,
    });
  }
  throw new Error("scriptedSteps: the walk never reached done");
}

// The frames that walk puts on the Follow-ups surface, one per turn.
// `render` is injected rather than hardcoded so the test can drive the
// SAME walk through the pre-#89 render rule and watch the check go red —
// the injected-violation fixture for the double-bubble class is the real
// defect, not an imitation of it.
export async function scriptedFrames(render: (step: TalkStep) => RenderedFrame): Promise<RenderedFrame[]> {
  return (await scriptedSteps()).map(render);
}

// AC-4. One violation per (frame, repeated string), attributed to the
// LATER occurrence — the second bubble is the one that shouldn't be
// there, and naming it is what points at the render rule rather than at
// the session.
export function frameDuplicateViolations(frames: RenderedFrame[]): UxFloorViolation[] {
  const out: UxFloorViolation[] = [];
  for (const [index, frame] of frames.entries()) {
    const seen = new Set<string>();
    const reported = new Set<string>();
    for (const entry of frame) {
      if (!seen.has(entry.text)) {
        seen.add(entry.text);
        continue;
      }
      if (reported.has(entry.text)) continue;
      reported.add(entry.text);
      out.push({
        check: "frame-duplicate",
        source: entry.source,
        text: entry.text,
        detail: `renders twice in the same frame (turn ${index})`,
      });
    }
  }
  return out;
}
