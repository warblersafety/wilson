// The UX floor (Issue #91), and the proof that each of its checks can
// fail.
//
// Every check here guards a defect class Steve's 2026-08-26 rejection
// named. A check that cannot fail guards nothing, so each one is run
// TWICE: green over the real build, and red over an injected-violation
// fixture (fixtures/ux-floor/violations.ts) that reproduces the shipped
// defect. That pairing is the unit's acceptance criterion, not a stylistic
// preference — a floor is only a floor if stepping through it is
// detectable.
import { describe, expect, it } from "vitest";
import {
  ASK_COUNT_CEILING,
  askCountViolations,
  consecutiveDuplicateViolations,
  fieldIdShapedViolations,
  manifestLabelViolations,
  optionCodeViolations,
  renderedCopyInventory,
  scriptedWalk,
  GATE_STATE_SEEDS,
  STATED_UNGATED_ASK_COUNT,
  templateMarkerViolations,
} from "./ux-floor";
import {
  FIELD_ID_INVENTORY,
  MANIFEST_LABEL_INVENTORY,
  OPTION_CODE_INVENTORY,
  OVER_CEILING_WALK,
  SHORT_WALK,
  TEMPLATE_MARKER_INVENTORY,
  TWICE_IN_A_ROW_WALK,
} from "../../fixtures/ux-floor/violations";

const INVENTORY = renderedCopyInventory();
const WALK = scriptedWalk();

describe("the rendered-copy inventory", () => {
  // AC-1's "all topics, both instances, all voice patterns", and item 7's
  // "never just the reference path". Asserted as a floor on the
  // enumeration itself: a sweep that silently stopped enumerating would
  // pass every check below while proving nothing.
  it("covers every authored ask, every topic, and both repeat instances", () => {
    const sources = new Set(INVENTORY.map((entry) => entry.source));
    expect(sources.has("ask:SP-1")).toBe(true);
    expect(sources.has("ask:SP-1-2")).toBe(true);
    expect(sources.has("ask:OC-2")).toBe(true); // the conditional ask, never walked by default
    expect(sources.has("ask:DV-1")).toBe(true); // a gated topic's ask
    expect(sources.has("ask:PA-1")).toBe(true);
    expect(sources.has("ask:SP-9-2")).toBe(true);
  });

  it("covers every voice pattern rule 8 lists, not only the asks", () => {
    const kinds = new Set(INVENTORY.map((entry) => entry.source.split(":")[0]));
    for (const kind of [
      "ask", // the authored questions
      "re-ask", // rule 9's frames
      "machinery", // the done message, repeat decisions, the volunteered hint
      "display-name", // rule 6's names, which every other pattern composes from
      "sweep", // out-of-ask writes, correction offers, collisions, volunteered repeats
      "open-fields", // the dialog's rows and body copy
      "surface", // Start, Read-back, Review, Ready, and the gated-off rail
    ]) {
      expect(kinds.has(kind), `no ${kind} strings in the inventory`).toBe(true);
    }
  });

  it("renders rule 9's frames at every partial state of every ask", () => {
    // 130 frames, not one: a re-ask is composed per still-open fact, so
    // the reference path proves almost none of them.
    expect(INVENTORY.filter((entry) => entry.source.startsWith("re-ask:")).length).toBeGreaterThan(100);
  });

  it("renders every field's display name", () => {
    expect(INVENTORY.filter((entry) => entry.source.startsWith("display-name:"))).toHaveLength(227);
  });
});

describe("no clinician-facing string carries a manifest label", () => {
  it("holds across the whole inventory", () => {
    expect(manifestLabelViolations(INVENTORY)).toEqual([]);
  });

  it("goes red on the label v1.1 asked outcomes with", () => {
    const found = manifestLabelViolations(MANIFEST_LABEL_INVENTORY);
    expect(found).toHaveLength(1);
    expect(found[0].source).toBe("ask:OC-1");
    expect(found[0].detail).toContain("Outcome Attributed to Adverse Event");
  });
});

describe("no clinician-facing string carries a template marker", () => {
  it("holds across the whole inventory", () => {
    expect(templateMarkerViolations(INVENTORY)).toEqual([]);
  });

  it("goes red on the exact string Steve was shown", () => {
    const found = templateMarkerViolations(TEMPLATE_MARKER_INVENTORY);
    expect(found).toHaveLength(2);
    expect(found.map((v) => v.source)).toEqual(["ask:SP-7", "ask:RA-1"]);
  });
});

describe("no clinician-facing string carries a field id", () => {
  it("holds across the whole inventory", () => {
    expect(fieldIdShapedViolations(INVENTORY)).toEqual([]);
  });

  it("goes red on each field-id shape the manifest uses", () => {
    const found = fieldIdShapedViolations(FIELD_ID_INVENTORY);
    expect(found.map((v) => v.source)).toEqual(["ask:SP-1", "display-name:death", "sweep:out-of-ask"]);
  });
});

describe("no clinician-facing string carries a PDF option code", () => {
  it("holds across the whole inventory", () => {
    expect(optionCodeViolations(INVENTORY)).toEqual([]);
  });

  it("goes red on a dose unit read straight off the PDF's option list", () => {
    const found = optionCodeViolations(OPTION_CODE_INVENTORY);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("MILLIGRAM(S) - MG");
  });
});

describe("a scripted full walk", () => {
  it("never asks the same thing twice in a row", () => {
    expect(consecutiveDuplicateViolations(WALK)).toEqual([]);
  });

  it("goes red when a re-ask repeats the ask it follows", () => {
    const found = consecutiveDuplicateViolations(TWICE_IN_A_ROW_WALK);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("repeats the turn before it");
  });

  // AC-3. The count docs/ask-copy.md states ("the ungated single-product
  // no-device walk contains exactly 21 authored asks"), reached by
  // walking rather than by summing the inventory — 58-82 template asks is
  // what Steve was actually shown.
  it("asks the count the contract states, under the ceiling it sets", () => {
    expect(askCountViolations(WALK)).toEqual([]);
    expect(WALK.filter((turn) => turn.kind === "ask")).toHaveLength(STATED_UNGATED_ASK_COUNT);
    expect(STATED_UNGATED_ASK_COUNT).toBeLessThanOrEqual(ASK_COUNT_CEILING);
  });

  it("goes red on a walk that drifts past the stated count", () => {
    const found = askCountViolations(SHORT_WALK);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("states 21");
  });

  it("goes red on a walk that breaks the ceiling", () => {
    const found = askCountViolations(OVER_CEILING_WALK);
    // Both halves of AC-3 fire: 58 is neither the stated count nor under
    // the ceiling, and the walk Steve rejected broke both at once.
    expect(found).toHaveLength(2);
    expect(found.some((v) => v.detail.includes("ceiling of 24"))).toBe(true);
  });
});

describe("every gate state, not just the reference path", () => {
  // Item 7: "every topic, both repeat instances, every gate state...
  // never just the reference path". The copy checks above cover gated
  // topics through the inventory (which carries every authored ask,
  // gated or not); this is the walk's half — rule 5 puts gated asks back
  // mid-flow, and a walk that gains asks is a walk that can gain a
  // repetition.
  it.each(GATE_STATE_SEEDS)("never repeats a turn in the %s walk", (_name, seed) => {
    expect(consecutiveDuplicateViolations(scriptedWalk(seed()))).toEqual([]);
  });

  it("asks strictly more once a gate opens, and never fewer", () => {
    const ungated = scriptedWalk().filter((turn) => turn.kind === "ask");
    for (const [name, seed] of GATE_STATE_SEEDS.slice(1)) {
      const opened = scriptedWalk(seed()).filter((turn) => turn.kind === "ask");
      expect(opened.length, name).toBeGreaterThan(ungated.length);
      // By ask identity, not rendered text: a seed that opens a gate also
      // pre-answers the field it opened it with, so that ask legitimately
      // renders as rule 9's frame instead of its primary copy. A gate
      // opens asks; it never silently removes one.
      const openedIds = new Set(opened.map((turn) => turn.id));
      for (const turn of ungated) {
        expect(openedIds.has(turn.id), `${name} lost ${turn.id}`).toBe(true);
      }
    }
  });

  // The ceiling is stated for the ungated walk — the contract excludes
  // gated and conditional asks from the count it caps. Pinned so nobody
  // later reads askCountViolations() as a rule about every walk.
  it("counts only the ungated walk against the contract's stated number", () => {
    const device = scriptedWalk(GATE_STATE_SEEDS[2][1]()).filter((turn) => turn.kind === "ask");
    expect(device.length).toBeGreaterThan(ASK_COUNT_CEILING);
    expect(askCountViolations(scriptedWalk())).toEqual([]);
  });
});
