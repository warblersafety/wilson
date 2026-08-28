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
  bulkDismissNamingViolations,
  consecutiveDuplicateViolations,
  fieldIdShapedViolations,
  firstVoicingViolations,
  manifestLabelViolations,
  optionCodeViolations,
  renderedCopyInventory,
  repeatInstanceAdjacencyViolations,
  scriptedWalk,
  GATE_STATE_SEEDS,
  REPEAT_COUNT_CHOICES,
  STATED_UNGATED_ASK_COUNT,
  templateMarkerViolations,
} from "./ux-floor";
import { AUTHORED_ASKS, unresolvedFactNames, type AuthoredAsk } from "./ask-inventory";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import { dismissAcknowledgment, dismissableFieldIds } from "./chip-grammar";
import { describeDismissal } from "./followup-sweep";
import { askCopy, reAskFrame } from "./ask";
import { TOPICS, type NextStep } from "./topics";
import {
  FIELD_ID_INVENTORY,
  MANIFEST_LABEL_INVENTORY,
  OPTION_CODE_INVENTORY,
  OVER_CEILING_WALK,
  SHORT_WALK,
  REPEAT_INSTANCE_ORPHAN_WALK,
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

  // Issue #110. Every ask, both dismiss chips — not a sample: the tap
  // acknowledgment names facts, and the asks whose fact list would read
  // worst (DV-1's ten device fields, RC-1's eight contact fields) are
  // exactly the ones a fixture would have left out.
  //
  // DV-1's pin changed 2026-08-28 (#125): renderedCopyInventory()'s own
  // dismiss loop reaches DV-1 UNTOUCHED (fieldIds: ask.askFieldIds, the
  // whole ask, nothing on the record) — rule 8's record-following name
  // says that state is named PLAINLY, "the device details", not "the
  // rest of the device details", which presumes a "rest" nothing has
  // given a referent to. The OLD pin here is the exact defect the
  // amendment removes (gate run #1, entry 1's dismiss-acknowledgment
  // half). The "rest of" form still exists — see the second assertion
  // below, once part of DV-1 is on the record.
  it("renders rule 8's dismiss acknowledgment for every ask and both chips", () => {
    const dismissals = INVENTORY.filter((entry) => entry.source.startsWith("sweep:dismiss/"));
    expect(dismissals).toHaveLength(AUTHORED_ASKS.length * 2);
    const bySource = new Map(dismissals.map((entry) => [entry.source, entry.text]));
    expect(bySource.get("sweep:dismiss/RA-2/mark_unknown")).toBe(
      "Marked other reports and identity-withholding choice as not on hand.",
    );
    expect(bySource.get("sweep:dismiss/DV-1/decline")).toBe("Marked the device details as declined.");
  });

  // The "rest of" half of the SAME rule: once part of a bulk-mapped fact
  // is on the record, dismissing what remains is honestly "the rest".
  // Not in the reference inventory above (which enumerates the untouched
  // ask only) — driven directly, the same way bulkDismissNamingViolations()
  // does, over a DV-1 already holding one field.
  it("names the bulk dismiss acknowledgment 'rest of' once part of the fact is on the record", () => {
    const dv1 = AUTHORED_ASKS.find((a) => a.id === "DV-1")!;
    const topic = TOPICS.find((t) => t.id === "device-identity")!;
    const partialRecord = applyAction(initAgenda(), dv1.askFieldIds[0], { type: "answer" }, "EpiPen");
    const step: NextStep = {
      kind: "topic",
      topic,
      ask: dv1,
      fieldIds: dv1.askFieldIds.filter((id) => id !== dv1.askFieldIds[0]),
    };
    expect(dismissAcknowledgment(step, "decline")).toBe("Marked the rest of the device details as declined.");
    // The record is what the naming follows, not the ask itself — the
    // ask's OTHER dismiss pin above, over the SAME ask untouched, still
    // reads plainly.
    expect(partialRecord[dv1.askFieldIds[0]].state).toBe("answered");
  });

  // Reviewer pass on #109/#110: these three named a Review-row key or a
  // manifest row inside a sentence. Pinned by their rendered form, and
  // paired with the rule-9 names they must NOT have changed.
  it("names facts whose display name is not prose through standaloneName", () => {
    const text = (source: string) => INVENTORY.find((entry) => entry.source === source)?.text;
    expect(text("sweep:dismiss/LD-1/mark_unknown")).toBe("Marked relevant tests or labs as not on hand.");
    expect(text("sweep:dismiss/CM-1/mark_unknown")).toBe("Marked other medications as not on hand.");
    expect(text("sweep:dismiss/SP-4/mark_unknown")).toBe(
      "Marked therapy start date, therapy stop date, therapy status, and the date the dose was reduced as not on hand.",
    );
  });

  it("leaves rule 9's own names untouched — standaloneName is additive", () => {
    const record = initAgenda();
    const byId = (id: string) => AUTHORED_ASKS.find((ask) => ask.id === id)!;
    expect(unresolvedFactNames(byId("LD-1"), record)).toEqual(["test 1"]);
    expect(unresolvedFactNames(byId("CM-1"), record)).toEqual(["other medication 1"]);
    expect(unresolvedFactNames(byId("SP-4"), record)).toEqual([
      "therapy start date",
      "therapy stop date",
      "therapy status",
      "dose reduced on",
    ]);
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

  // Gate state is only one dimension. Repeat count is the other, and the
  // first cut of this file missed it: every gate seed above leaves both
  // repeat groups at one instance, so a walk with three concomitant
  // medications — an ordinary session — was never checked.
  //
  // It was NOT clean when it was: docs/ask-copy.md used to author ONE
  // CM-2 string for concomitant instances 2-10, and once a count is
  // decided no repeat decision separates the instances, so instances 2
  // and 3 were byte-identical back-to-back turns — AC-2's own defect
  // class, authored by the contract rather than introduced by the build.
  // This test carried the departure as an exact `CM-2-3`..`CM-2-10` pin
  // while #111 was open. The amendment (2026-08-27) gives each instance
  // its ordinal, so the pin is DELETED rather than widened.
  //
  // What holds now, stated exactly: across every gate state and every
  // repeat count, no walk repeats a turn CONSECUTIVELY, with no
  // departures. Not "no walk repeats a turn" — consecutiveDuplicateViolations()
  // compares turns[i] to turns[i-1] and nothing else. The difference is
  // load-bearing rather than pedantic: a two-suspect-product walk repeats
  // seven asks NINE turns apart (SP-2..SP-8 are byte-identical across
  // instances) and this check is silent on all of them. That is a real
  // copy defect, filed as #117; naming the check honestly is what
  // keeps it from being buried under a green test called
  // "repeats no turn in any walk shape" (doc-review on #111).
  it("repeats no turn CONSECUTIVELY in any walk shape — no departures", () => {
    const repeating: string[] = [];
    for (const [gate, seed] of GATE_STATE_SEEDS) {
      for (const [choice, choose] of REPEAT_COUNT_CHOICES) {
        for (const violation of consecutiveDuplicateViolations(scriptedWalk(seed(), choose))) {
          repeating.push(`${violation.source} (${gate}/${choice}): ${violation.text}`);
        }
      }
    }
    expect(repeating).toEqual([]);
  });

  // ask-copy.md CM-2-{n}'s stated premise, checked rather than described
  // (doc-review and reviewer pass on #111). The amendment bolds the
  // adjacency because "the second medication" only reads as a
  // concomitant if the turn before it established the topic — and CM-1
  // is skipped whenever row 1 is already resolved, leaving the repeat
  // decision as the only turn doing that work.
  it("never reaches a later repeat instance without its group's own turn before it", () => {
    const orphans: string[] = [];
    for (const [gate, seed] of GATE_STATE_SEEDS) {
      for (const [choice, choose] of REPEAT_COUNT_CHOICES) {
        for (const violation of repeatInstanceAdjacencyViolations(scriptedWalk(seed(), choose))) {
          orphans.push(`${violation.source} (${gate}/${choice}): ${violation.detail}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  // The walk the read-back path already produces: row 1 answered from the
  // opening narrative, so CM-1 never renders and the repeat decision is
  // the only turn left carrying the topic. Holds today — one turn wide.
  it("holds on the read-back walk, where CM-1 is skipped entirely", () => {
    const seeded = applyAction(initAgenda(), "Page6.SecF_Other.Table1.Row1.Prod1", { type: "answer" }, "lisinopril");
    const walk = scriptedWalk(seeded, (group, after) => (group === "concomitant-medication" ? 3 : after));
    expect(walk.some((turn) => turn.id === "CM-1")).toBe(false);
    expect(walk.some((turn) => turn.id === "CM-2-2")).toBe(true);
    expect(repeatInstanceAdjacencyViolations(walk)).toEqual([]);
  });

  it("goes red when the group's own turn is gone — the shape #43 would produce", () => {
    const found = repeatInstanceAdjacencyViolations(REPEAT_INSTANCE_ORPHAN_WALK);
    expect(found).toHaveLength(1);
    expect(found[0].source).toContain("CM-2-2");
    expect(found[0].detail).toContain("SP-8-2");
  });

  // The amendment's own proof, and the reason the check above can be
  // absolute: every concomitant instance now says something different.
  // Asserted over the walk that actually reaches all ten, not over the
  // inventory — a per-instance string that the walk never renders would
  // prove nothing.
  it("gives all ten concomitant instances distinct copy", () => {
    const atCapacity = REPEAT_COUNT_CHOICES.find(([name]) => name === "every-group-at-capacity")![1];
    const walk = scriptedWalk(initAgenda(), atCapacity);
    const concomitant = walk.filter((turn) => turn.kind === "ask" && turn.id.startsWith("CM-"));
    expect(concomitant).toHaveLength(10);
    expect(new Set(concomitant.map((turn) => turn.text)).size).toBe(10);
  });

  it("keeps the suspect-product group clean — its second instance is authored apart", () => {
    // The contract got this one right, and pinning it is what makes the
    // concomitant departure a defect rather than a convention: SP-1-2
    // says "the second suspect product", so a two-product walk repeats
    // nothing.
    for (const [gate, seed] of GATE_STATE_SEEDS) {
      const walk = scriptedWalk(seed(), REPEAT_COUNT_CHOICES[1][1]);
      expect(consecutiveDuplicateViolations(walk), gate).toEqual([]);
      expect(walk.some((turn) => turn.id === "SP-1-2"), gate).toBe(true);
    }
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

// Consequence 7's new entry (#125): "for every topic, instance, and gate
// state, the copy helpers — given declared voicing and resolution state
// — return the primary copy or the arrival frame for a partial arrival,
// never a bare re-ask frame or an unprefixed bulk line." Unlike the
// checks above, the defect this class guards against lives in askCopy()'s
// OWN composition logic, not in any inventory data — so, matching
// transcript-view.test.ts's scriptedFrames(render) proof for the
// double-bubble class, the injected violation is an ALTERNATE compute
// function reproducing the pre-#125 behavior, not a hand-built data
// fixture.
describe("rule 9's first-voicing property, over declared voicing and resolution state (#125)", () => {
  // The exact pre-amendment askCopy() (ask.ts, before this unit): partial
  // meant the bare re-ask frame, full stop — no voicedThisReport
  // parameter existed to consult. Reproduced here as a plain function
  // rather than imported, because ask.ts's real askCopy() is the fix and
  // has no "old mode" switch to select.
  const preAmendmentAskCopy = (ask: AuthoredAsk, record: AgendaRecord): string => {
    const unresolved = ask.askFieldIds.filter((id) => record[id].state === "unasked");
    if (unresolved.length === ask.askFieldIds.length) return ask.copy;
    return reAskFrame(unresolvedFactNames(ask, record));
  };

  it("holds across every authored ask, at every partial state, both voicing states", () => {
    expect(firstVoicingViolations()).toEqual([]);
  });

  it("goes red on the pre-#125 compute function — gate run #1, entry 1's exact defect", () => {
    const found = firstVoicingViolations(preAmendmentAskCopy);
    // Every partial-arrival state across every ask fires: the old
    // function never looks at voicedThisReport at all.
    expect(found.length).toBeGreaterThan(100);
    // DV-1's own defect, named: "And the rest of the device details?"
    // rendered as C4's first-ever utterance for that topic.
    const dv1 = found.find((v) => v.source.startsWith("arrival:DV-1/"));
    expect(dv1?.detail).toContain("never-voiced arrival");
  });

  it("goes red on a compute function that renders a bulk arrival line unprefixed", () => {
    // A plausible half-fix: someone wires arrivalAsk in but forgets the
    // "I've got {held}. " prefix rule 9 requires — the ask half alone,
    // exactly the case the amendment calls out as still unacceptable
    // ("never rendered bare: the held prefix is what gives 'the rest'
    // its referent").
    const bareBulkArrival = (ask: AuthoredAsk, record: AgendaRecord, voicedThisReport: boolean): string => {
      const bulkFact = ask.facts?.find((f) => f.arrivalAsk !== undefined);
      if (!voicedThisReport && bulkFact !== undefined) return bulkFact.arrivalAsk!;
      return askCopy(ask, record, voicedThisReport);
    };
    const found = firstVoicingViolations(bareBulkArrival);
    expect(found.some((v) => v.detail.includes("unprefixed"))).toBe(true);
  });
});

// Rule 8's record-following bulk-dismiss name (#125), the same
// injected-function shape as the first-voicing property above: the
// defect lives in which name standaloneFactNamesFor() (ask-inventory.ts)
// picks, not in any data a fixture could carry on its own.
describe("rule 8's bulk-dismiss naming follows the record (#125)", () => {
  // Pre-#125: standaloneName ("the rest of...") unconditionally, whether
  // or not anything of the fact was on the record — the exact defect
  // gate run #1 named: "a dismiss on RC-1 acknowledged 'the rest of your
  // contact details' when nothing of the fact was on the record."
  const preAmendmentDismissAck = (step: NextStep, action: "mark_unknown" | "decline"): string | undefined => {
    if (step.kind !== "topic") return undefined;
    const names = dismissableFieldIds(step).map((id) => {
      const fact = step.ask.facts?.find((f) => f.fieldIds.includes(id));
      return fact?.standaloneName ?? fact?.name ?? id;
    });
    const deduped = [...new Set(names)];
    return deduped.length === 0 ? undefined : describeDismissal(deduped, action);
  };

  it("holds across all three bulk-mapped asks, untouched and partial", () => {
    expect(bulkDismissNamingViolations()).toEqual([]);
  });

  it("goes red on the pre-#125 acknowledgment — always 'rest of', record or not", () => {
    const found = bulkDismissNamingViolations(preAmendmentDismissAck);
    // Both chips, all three bulk asks (RC-1, DV-1, SP-9, SP-9-2), on the
    // untouched half only — the old function gets the partial half right
    // by coincidence (standaloneName IS the correct "rest of" name once
    // something is on the record), so only "untouched" sources fire.
    expect(found.length).toBeGreaterThanOrEqual(8);
    expect(found.every((v) => v.source.endsWith("/untouched"))).toBe(true);
    expect(found.some((v) => v.detail.includes("nothing of the fact on the record"))).toBe(true);
  });
});
