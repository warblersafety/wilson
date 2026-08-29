// Pure logic for Issue #44's chip-driven follow-up loop — no React, no
// DOM. UI components (RepeatDecision.tsx, AskForm.tsx) stay thin
// wrappers, same convention as the rest of src/app/wizard.
import { describe, expect, it } from "vitest";
import { initAgenda, type AgendaRecord } from "./agenda";
import { exclusiveFactContaining, type AskFact } from "./ask-inventory";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import type { CorrectionOffer, FieldCollision } from "./followup-sweep";
import { applyProposedActions } from "./talk";
import { initRepeatCounts, nextStep, TOPICS, type NextStep, type Topic } from "./topics";
import {
  applyActionToFields,
  collisionTapResult,
  dismissAcknowledgment,
  dismissableFieldIds,
  friendlyFailureMessage,
  remainingCollisions,
  remainingCorrectionOffers,
  repeatDecisionOptions,
  resolveCollisionTap,
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
  // Issue #123: no question folded in — the talker turn asking it is
  // already the preceding entry in the transcript, both bubbles on
  // screen at once, so the clinician's own turn is just the chip's words.
  it("renders exactly the chip's own label, never the question it answers", () => {
    expect(widgetTurnText("Yes, 5 in total")).toBe("Yes, 5 in total");
    expect(widgetTurnText("I don't have that")).toBe("I don't have that");
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

// Issue #124: the same same-turn-siblings concern remainingCorrectionOffers
// solves above, for collisions — accepting one field's colliding value
// must not silently drop another field's still-pending collision from the
// same turn (stepForSession()'s fresh TalkStep carries neither kind of
// its own).
describe("remainingCollisions", () => {
  function collision(fieldId: string): FieldCollision {
    return {
      fieldId,
      values: [`${fieldId}-1`, `${fieldId}-2`],
      actions: [
        { fieldId, type: "answer", value: `${fieldId}-1` },
        { fieldId, type: "answer", value: `${fieldId}-2` },
      ],
    };
  }

  it("drops only the resolved field's collision, keeping every other one from the same turn", () => {
    const collisions = [collision("a"), collision("b"), collision("c")];
    expect(remainingCollisions(collisions, "b")).toEqual([collision("a"), collision("c")]);
  });

  it("returns undefined, not an empty array, once resolving it empties the list", () => {
    expect(remainingCollisions([collision("a")], "a")).toBeUndefined();
  });

  it("returns undefined for an undefined input list (no collisions this turn)", () => {
    expect(remainingCollisions(undefined, "a")).toBeUndefined();
  });

  it("is a no-op when the resolved id isn't among the given collisions", () => {
    const collisions = [collision("a"), collision("b")];
    expect(remainingCollisions(collisions, "z")).toEqual(collisions);
  });
});

// Reviewer pass on PR #142, finding 2 (SHOULD-FIX): both pending-offer
// channels can be live in the same turn, and AskForm.tsx's three
// handlers (accept-correction, accept-collision, dismiss) must each
// carry BOTH forward — the one they just resolved (via the remaining*
// helper above) AND the other, untouched. Before this fix each handler
// spread only its own channel, so accepting one silently dropped
// whatever was pending on the other — worst case, a same-turn
// correction offer's chip vanishing while its field stayed answered at
// the wrong value, which the walk then never re-asks about (it's
// `answered`, not `unasked`). AskForm.tsx has no test harness (this repo
// has no component tests at all), so this pins the composition at the
// level reachable without one: the exact shape each handler now builds,
// proving the two helpers never interfere with each other's list.
describe("remainingCorrectionOffers and remainingCollisions carried together (Issue #142 reviewer pass, finding 2)", () => {
  function offer(fieldId: string): CorrectionOffer {
    return {
      fieldId,
      action: { fieldId, type: "answer", value: `value for ${fieldId}` },
      currentState: "answered",
      currentValue: `old value for ${fieldId}`,
    };
  }

  function collision(fieldId: string): FieldCollision {
    return {
      fieldId,
      values: [`${fieldId}-1`, `${fieldId}-2`],
      actions: [
        { fieldId, type: "answer", value: `${fieldId}-1` },
        { fieldId, type: "answer", value: `${fieldId}-2` },
      ],
    };
  }

  it("accepting a correction offer (handleAcceptCorrection's shape) leaves a same-turn collision fully intact", () => {
    const correctionOffers = [offer("a")];
    const collisions = [collision("b"), collision("c")];
    const next = {
      correctionOffers: remainingCorrectionOffers(correctionOffers, "a"),
      collisions, // carried forward untouched — the fix under test
    };
    expect(next).toEqual({ correctionOffers: undefined, collisions: [collision("b"), collision("c")] });
  });

  it("accepting a collision (handleAcceptCollision's shape) leaves a same-turn correction offer fully intact", () => {
    const correctionOffers = [offer("a"), offer("b")];
    const collisions = [collision("c")];
    const next = {
      collisions: remainingCollisions(collisions, "c"),
      correctionOffers, // carried forward untouched — the fix under test
    };
    expect(next).toEqual({ collisions: undefined, correctionOffers: [offer("a"), offer("b")] });
  });

  it("dismissing (handleDismiss's shape) carries both channels forward untouched — a dismiss resolves neither", () => {
    const correctionOffers = [offer("a")];
    const collisions = [collision("b")];
    const next = { correctionOffers, collisions };
    expect(next).toEqual({ correctionOffers: [offer("a")], collisions: [collision("b")] });
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

  // Rule 9's arrival frame (#125): "Dismiss chips on an arrival frame
  // cover exactly its open side — the named still-need facts, or the
  // bulk remainder — never facts already on the record: the same
  // scoping this rule gives re-asks." dismissableFieldIds() and
  // dismissAcknowledgment() both take their fieldIds from step.fieldIds
  // — nextStep()'s own unresolved slice — which is computed identically
  // regardless of which COPY (primary/arrival/re-ask) askDeterministic
  // composes for the same step; this pins that no code path exists for
  // "which frame is showing" to leak into which fields a chip can touch.
  it("scopes a dismiss on an arrival-eligible step to exactly its open side, never the held fields", () => {
    // PatientIdentifier resolved (as narrative extraction would from an
    // MRN mentioned up front) — PB-1 arrives with one fact already held,
    // two still open, on what would be its first (arrival) voicing.
    const pb1 = TOPICS.find((t) => t.id === "patient-basics")!.asks.find((a) => a.id === "PB-1")!;
    const record = {
      ...initAgenda(),
      [pb1.askFieldIds[0]]: { state: "answered" as const, value: "MRN 1" },
    };
    const step = nextStep(record, initRepeatCounts());
    expect(step.kind).toBe("topic");
    const fieldIds = dismissableFieldIds(step);
    // The held fact (patient identifier) is untouched by the chip.
    expect(fieldIds).not.toContain(pb1.askFieldIds[0]);
    // Exactly the still-open facts — age and sex — nothing more.
    expect(fieldIds).toEqual(pb1.askFieldIds.slice(1));
    expect(dismissAcknowledgment(step, "mark_unknown")).toBe("Marked age and sex as not on hand.");
  });
});

// Issue #154 (urgent): a collision chip tap on a one-hot (`exclusive`)
// member used to reach applyProposedActions() with its raw tapped action
// alone — classifyFollowUpActions() (followup-sweep.ts) splits a turn's
// candidates into collisions BEFORE the exclusive-fact branch that gives
// every OTHER grounded "true" write its atomic-completion/conflict-check
// treatment, so a one-hot member with 2+ candidates in one turn never
// reached it. Two concrete repros this pins: a tap that CONFLICTS with an
// already-answered sibling used to write both sex boxes true; a tap on a
// fresh record used to leave the untapped sibling `unasked` (the phantom
// sibling, #126's original defect verbatim, reachable again through the
// collision door). Real manifest ids throughout (Page1.SecA_Patient.SexM/
// SexF are ask-inventory.ts's real PB-1 "sex" exclusive fact) — no
// hand-rolled stand-in for the fact inventory, since the machinery under
// test (exclusiveFactContaining, conflictingExclusiveSibling) is keyed
// off the real, module-level AUTHORED_ASKS and cannot be parameterized
// with a synthetic one.
describe("resolveCollisionTap (#154)", () => {
  const SEX_M = "Page1.SecA_Patient.SexM";
  const SEX_F = "Page1.SecA_Patient.SexF";
  const sexFact: AskFact = exclusiveFactContaining(SEX_M)!;

  // The invariant AC-4 actually pins: a COUNT over the fact's own
  // fieldIds, not two separate per-field assertions that could both be
  // satisfied by an unrelated bug (e.g. both members false).
  function trueMemberCount(record: AgendaRecord, fact: AskFact): number {
    return fact.fieldIds.filter((id) => record[id]?.state === "answered" && record[id]?.value === "true").length;
  }

  it("AC-4 conflict case: a tap conflicting with an already-answered sibling is caught, not silently applied", () => {
    // record: SexM answered "true", SexF answered "false" — sex resolved
    // as male, exactly the brief's first repro.
    const record: AgendaRecord = {
      ...initAgenda(),
      [SEX_M]: { state: "answered", value: "true" },
      [SEX_F]: { state: "answered", value: "false" },
    };
    // Two grounded candidates for SexF this turn: "true" and mark_unknown.
    const collision: FieldCollision = {
      fieldId: SEX_F,
      values: ["true", "unknown"],
      actions: [
        { fieldId: SEX_F, type: "answer", value: "true" },
        { fieldId: SEX_F, type: "mark_unknown" },
      ],
    };

    const result = resolveCollisionTap(record, collision, 0); // tap "true"

    // Never applied: the record comes back the SAME reference, not an
    // equal copy — the strongest form of "unchanged" this codebase pins
    // elsewhere (direct-step.ts's own hydration-safety contract).
    expect(result.record).toBe(record);
    expect(result.record[SEX_F].value).not.toBe("true");
    expect(trueMemberCount(result.record, sexFact)).toBe(1);

    expect(result.correctionOffer).toBeDefined();
    expect(result.correctionOffer!.exclusiveFact).toBeDefined();
    expect(result.correctionOffer!.exclusiveFact!.name).toBe("sex");
    expect(result.correctionOffer!.exclusiveFact!.currentFieldId).toBe(SEX_M);

    // The clinician's actual path to a female-recorded sex: tap the
    // "Replace sex" chip this offer becomes, which applies
    // exclusiveFact.writes atomically (AskForm.tsx's
    // handleAcceptCorrection, already tested since #126) — exactly one
    // true member, SexF, never both.
    const corrected = applyProposedActions(record, result.correctionOffer!.exclusiveFact!.writes);
    expect(trueMemberCount(corrected, sexFact)).toBe(1);
    expect(corrected[SEX_F]).toEqual({ state: "answered", value: "true" });
  });

  it("AC-4 fresh-record case: a clean one-hot tap writes the whole fact atomically, not just its own field", () => {
    // SexM/SexF both `unasked` — #126's original defect verbatim,
    // reached this time through a collision tap rather than an in-ask
    // answer.
    const record = initAgenda();
    // Two grounded candidates for SexM this turn: "true" and "unknown".
    const collision: FieldCollision = {
      fieldId: SEX_M,
      values: ["true", "unknown"],
      actions: [
        { fieldId: SEX_M, type: "answer", value: "true" },
        { fieldId: SEX_M, type: "mark_unknown" },
      ],
    };

    const result = resolveCollisionTap(record, collision, 0); // tap "true"

    expect(result.correctionOffer).toBeUndefined();
    expect(result.record[SEX_M]).toEqual({ state: "answered", value: "true" });
    // The phantom-sibling defect: SexF must be WRITTEN false, not left
    // `unasked` beside an answered SexM.
    expect(result.record[SEX_F]).toEqual({ state: "answered", value: "false" });
    expect(trueMemberCount(result.record, sexFact)).toBe(1);
  });

  it("a non-exclusive field's collision tap is unchanged: applies the tapped action alone", () => {
    const record = initAgenda();
    // A plain text field with no exclusive fact of its own (SP-2's lot
    // number — followup-sweep.test.ts's own LOT fixture).
    const LOT = "Page4.Prod1.Prod1LotNum";
    expect(exclusiveFactContaining(LOT)).toBeUndefined();
    const collision: FieldCollision = {
      fieldId: LOT,
      values: ["8834", "8835"],
      actions: [
        { fieldId: LOT, type: "answer", value: "8834" },
        { fieldId: LOT, type: "answer", value: "8835" },
      ],
    };

    const result = resolveCollisionTap(record, collision, 1); // tap "8835"

    expect(result.correctionOffer).toBeUndefined();
    expect(result.record[LOT]).toEqual({ state: "answered", value: "8835" });
  });

  // Issue #155 (still open, deliberately out of #154's scope): rule 7's
  // amendment covers "the named member true" only, so a tap that resolves
  // to anything else on a one-hot member — mark_unknown, decline, or
  // "false" — stays on the ordinary field-level path. Pinned here so a
  // future widening to this shape is a deliberate edit to this test, not
  // a silent side effect of some unrelated change.
  it("a mark_unknown tap on a one-hot member still takes the field-level path (#155's boundary)", () => {
    const record = initAgenda();
    const collision: FieldCollision = {
      fieldId: SEX_M,
      values: ["true", "unknown"],
      actions: [
        { fieldId: SEX_M, type: "answer", value: "true" },
        { fieldId: SEX_M, type: "mark_unknown" },
      ],
    };

    const result = resolveCollisionTap(record, collision, 1); // tap "unknown"

    expect(result.correctionOffer).toBeUndefined();
    expect(result.record[SEX_M]).toEqual({ state: "unknown", value: undefined });
    // #155's boundary: SexF is untouched, not completed false — this
    // unit's atomic completion is scoped to answer "true" only.
    expect(result.record[SEX_F]).toEqual({ state: "unasked" });
  });
});

// Reviewer pass on PR #167 (SHOULD-FIX): AskForm.tsx's handleAcceptCollision
// used to compose the correctionOffers append and the replyPrefix inline,
// where this repo's lack of a component test harness meant neither was
// pinned — mutation testing found dropping EITHER one left the whole
// suite green. collisionTapResult() pulls that composition down to where
// it can be tested directly, the same reason remainingCorrectionOffers/
// remainingCollisions above were extracted after PR #142. Each mutation
// was hand-applied to collisionTapResult() and confirmed to fail one of
// the tests below, then reverted — a one-time check, not something this
// file re-runs; see the PR description for the actual red-run output.
describe("collisionTapResult (#154 reviewer pass — SHOULD-FIX)", () => {
  const SEX_M = "Page1.SecA_Patient.SexM";
  const SEX_F = "Page1.SecA_Patient.SexF";

  function offer(fieldId: string): CorrectionOffer {
    return {
      fieldId,
      action: { fieldId, type: "answer", value: `value for ${fieldId}` },
      currentState: "answered",
      currentValue: `old value for ${fieldId}`,
    };
  }

  // Catches a dropped correctionOffers append: if collisionTapResult()
  // silently discarded resolveCollisionTap()'s offer instead of adding it,
  // this would still find the pre-existing offer and stop there.
  it("appends a conflicting tap's new offer to the carried-forward list, never replacing it", () => {
    const record: AgendaRecord = {
      ...initAgenda(),
      [SEX_M]: { state: "answered", value: "true" },
      [SEX_F]: { state: "answered", value: "false" },
    };
    const collision: FieldCollision = {
      fieldId: SEX_F,
      values: ["true", "unknown"],
      actions: [
        { fieldId: SEX_F, type: "answer", value: "true" },
        { fieldId: SEX_F, type: "mark_unknown" },
      ],
    };
    const existing = [offer("Page4.Prod1.Prod1LotNum")];

    const result = collisionTapResult(record, existing, collision, 0);

    expect(result.correctionOffers).toHaveLength(2);
    expect(result.correctionOffers).toEqual([
      existing[0],
      expect.objectContaining({ fieldId: SEX_F, exclusiveFact: expect.objectContaining({ name: "sex" }) }),
    ]);
  });

  // Catches the same drop when there was nothing to carry forward — the
  // "always return the input untouched" mutation would return `undefined`
  // here instead of a fresh one-element array.
  it("starts a fresh array when there were no correction offers yet", () => {
    const record: AgendaRecord = {
      ...initAgenda(),
      [SEX_M]: { state: "answered", value: "true" },
      [SEX_F]: { state: "answered", value: "false" },
    };
    const collision: FieldCollision = {
      fieldId: SEX_F,
      values: ["true", "unknown"],
      actions: [
        { fieldId: SEX_F, type: "answer", value: "true" },
        { fieldId: SEX_F, type: "mark_unknown" },
      ],
    };

    const result = collisionTapResult(record, undefined, collision, 0);

    expect(result.correctionOffers).toHaveLength(1);
    expect(result.correctionOffers![0].fieldId).toBe(SEX_F);
  });

  // Catches a dropped replyPrefix: if collisionTapResult() always
  // returned undefined here, the clinician would see the new "Replace
  // sex" chip (proven above) with no on-screen sentence saying what it
  // replaces — stepForSession() never calls describeFollowUpSweep()
  // itself, so this is the only place that sentence can come from.
  // `toBe`, not `toContain` — the same precedent followup-sweep.test.ts's
  // rule-8 tests set: a containment check is exactly what lets a wrong
  // string pass.
  it("states the conflicting offer's sentence as replyPrefix, byte for byte", () => {
    const record: AgendaRecord = {
      ...initAgenda(),
      [SEX_M]: { state: "answered", value: "true" },
      [SEX_F]: { state: "answered", value: "false" },
    };
    const collision: FieldCollision = {
      fieldId: SEX_F,
      values: ["true", "unknown"],
      actions: [
        { fieldId: SEX_F, type: "answer", value: "true" },
        { fieldId: SEX_F, type: "mark_unknown" },
      ],
    };

    const result = collisionTapResult(record, undefined, collision, 0);

    expect(result.replyPrefix).toBe("You said female for sex — it's recorded as male. Replace it?");
  });

  // The complementary case, guarding the mirror-image bug (not the two
  // mutations above, which only touch the conflict branch): a tap that
  // writes straight through must carry the correctionOffers list forward
  // completely untouched — same reference, not a new equal array — and
  // manufacture no replyPrefix, since nothing needs explaining that
  // current.reply doesn't already cover.
  it("on a clean atomic write, carries correctionOffers forward unchanged and states no replyPrefix", () => {
    const record = initAgenda();
    const collision: FieldCollision = {
      fieldId: SEX_M,
      values: ["true", "unknown"],
      actions: [
        { fieldId: SEX_M, type: "answer", value: "true" },
        { fieldId: SEX_M, type: "mark_unknown" },
      ],
    };
    const existing = [offer("Page4.Prod1.Prod1LotNum")];

    const result = collisionTapResult(record, existing, collision, 0);

    expect(result.record[SEX_M]).toEqual({ state: "answered", value: "true" });
    expect(result.record[SEX_F]).toEqual({ state: "answered", value: "false" });
    expect(result.correctionOffers).toBe(existing);
    expect(result.replyPrefix).toBeUndefined();
  });

  // ...and the same for a non-exclusive field's collision, and for the
  // undefined-input case — no offer ever manufactured out of nothing.
  it("on a non-exclusive field's collision, states no replyPrefix and leaves correctionOffers as given", () => {
    const record = initAgenda();
    const LOT = "Page4.Prod1.Prod1LotNum";
    const collision: FieldCollision = {
      fieldId: LOT,
      values: ["8834", "8835"],
      actions: [
        { fieldId: LOT, type: "answer", value: "8834" },
        { fieldId: LOT, type: "answer", value: "8835" },
      ],
    };

    const result = collisionTapResult(record, undefined, collision, 1);

    expect(result.record[LOT]).toEqual({ state: "answered", value: "8835" });
    expect(result.correctionOffers).toBeUndefined();
    expect(result.replyPrefix).toBeUndefined();
  });
});
