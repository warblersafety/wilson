// The authored inventory itself (docs/ask-copy.md): coverage, counts, and
// the structural rules the contract states about it. ask.test.ts covers
// what the inventory SAYS; this file covers that it says it about
// everything, exactly once.
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda } from "./agenda";
import {
  AUTHORED_ASKS,
  GATED_TOPIC_IDS,
  asksForTopic,
  askApplies,
  dispositionOf,
  isListableGap,
  unresolvedAskFieldIds,
  unresolvedFactNames,
} from "./ask-inventory";
import { fieldById, FORM_3500_FIELDS } from "./form-3500-fields";
import { TOPICS } from "./topics";

const askedIds = AUTHORED_ASKS.flatMap((a) => a.askFieldIds);
const companionIds = AUTHORED_ASKS.flatMap((a) => a.companionFieldIds);

describe("the authored ask inventory", () => {
  // Rule 1's build error, in test form: the contract's coverage claim is
  // "34 topics, 227 fields, all dispositioned".
  it("gives every one of the 34 topics at least one authored ask", () => {
    expect(TOPICS).toHaveLength(34);
    for (const topic of TOPICS) {
      expect(() => asksForTopic(topic.id), topic.id).not.toThrow();
      expect(asksForTopic(topic.id).length, topic.id).toBeGreaterThan(0);
    }
  });

  it("throws for a topic with no authored asks, rather than falling back", () => {
    expect(() => asksForTopic("no-such-topic")).toThrow(/no authored asks/);
  });

  it("dispositions all 227 manifest fields, each exactly once", () => {
    const all = [...askedIds, ...companionIds];
    expect(new Set(all).size, "a field dispositioned twice").toBe(all.length);
    expect(new Set(all)).toEqual(new Set(FORM_3500_FIELDS.map((f) => f.id)));
  });

  it("names only real fields, each inside its own ask's topic", () => {
    for (const ask of AUTHORED_ASKS) {
      const topic = TOPICS.find((t) => t.id === ask.topicId);
      expect(topic, `${ask.id} names an unknown topic`).toBeDefined();
      for (const fieldId of [...ask.askFieldIds, ...ask.companionFieldIds]) {
        expect(fieldById(fieldId), `${ask.id}: ${fieldId}`).toBeDefined();
        expect(topic!.fieldIds, `${ask.id}: ${fieldId} is not in ${topic!.id}`).toContain(fieldId);
      }
    }
  });

  it("gives every ask at least one field to wait on", () => {
    // An ask with no blocking field would never be reached by the walk —
    // it would be authored copy no clinician ever reads.
    for (const ask of AUTHORED_ASKS) {
      expect(ask.askFieldIds.length, ask.id).toBeGreaterThan(0);
    }
  });

  // ask-copy.md's own stated count, and its hard ceiling: "The ungated
  // single-product no-device walk contains exactly 21 authored asks ...
  // Hard ceiling: 24 — an amendment that pushes past it returns to a
  // design conversation first."
  it("contains exactly 21 ungated asks on the single-product no-device walk, under the ceiling of 24", () => {
    const record = initAgenda();
    const ungated = AUTHORED_ASKS.filter((ask) => {
      if (GATED_TOPIC_IDS.has(ask.topicId)) return false;
      const topic = TOPICS.find((t) => t.id === ask.topicId)!;
      // One suspect product, one concomitant medication: the walk the
      // contract counts.
      if (topic.repeatInstance !== null && topic.repeatInstance > 1) return false;
      // Conditional asks (the date of death) are excluded from the count.
      return askApplies(ask, record);
    });
    expect(ungated.map((a) => a.id)).toEqual([
      "PB-1", "PB-2", "PB-3",
      "WH-1", "WH-2",
      "OC-1",
      "MH-1",
      "LD-1",
      "AC-1",
      "SP-1", "SP-2", "SP-3", "SP-4", "SP-5", "SP-6", "SP-7", "SP-8",
      "CM-1",
      "RC-1", "RA-1", "RA-2",
    ]);
    expect(ungated).toHaveLength(21);
    expect(ungated.length).toBeLessThanOrEqual(24);
  });

  it("gates exactly the topics the contract gates", () => {
    expect([...GATED_TOPIC_IDS].sort()).toEqual([
      "device-history",
      "device-identity",
      "device-usage",
      "product-availability",
      "suspect-product-1-purchase",
      "suspect-product-2-purchase",
    ]);
  });

  // OC-2, the one conditional ask. A checkbox answered "false" is rule
  // 7's real negative — "none of those" must not be followed by a
  // date-of-death question.
  describe("OC-2's death-date condition", () => {
    const oc2 = AUTHORED_ASKS.find((a) => a.id === "OC-2")!;
    const DEATH = "Page1.SecA_Patient.Death";

    it("does not apply while the outcome is unasked", () => {
      expect(askApplies(oc2, initAgenda())).toBe(false);
    });

    it("does not apply when death was answered false", () => {
      const record = { ...initAgenda(), [DEATH]: { state: "answered" as const, value: "false" } };
      expect(askApplies(oc2, record)).toBe(false);
    });

    it("applies when death was answered true", () => {
      const record = { ...initAgenda(), [DEATH]: { state: "answered" as const, value: "true" } };
      expect(askApplies(oc2, record)).toBe(true);
    });
  });

  // Rule 2: an ask asks for FACTS. A one-hot pair and a multi-select
  // group are each one fact, so rule 9's re-ask names them once.
  describe("fact groups", () => {
    it("names a one-hot pair as one fact", () => {
      const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
      const record = applyAction(initAgenda(), pb1.askFieldIds[0], { type: "answer" }, "MRN 1");
      expect(unresolvedFactNames(pb1, record)).toEqual(["age", "sex"]);
    });

    it("names a multi-select checkbox group as one fact", () => {
      const oc1 = AUTHORED_ASKS.find((a) => a.id === "OC-1")!;
      expect(unresolvedFactNames(oc1, initAgenda())).toEqual(["outcome"]);
    });

    it("falls back to a field's display name where the ask declares no group", () => {
      const sp2 = AUTHORED_ASKS.find((a) => a.id === "SP-2")!;
      expect(unresolvedFactNames(sp2, initAgenda())).toEqual(["lot number", "NDC or unique ID"]);
    });

    it("declares only real, unshared, in-ask fields in its fact groups", () => {
      const seen = new Set<string>();
      for (const ask of AUTHORED_ASKS) {
        for (const fact of ask.facts ?? []) {
          expect(fact.name.length, ask.id).toBeGreaterThan(0);
          expect(fact.name, ask.id).not.toContain(",");
          expect(fact.fieldIds.length, `${ask.id}/${fact.name}`).toBeGreaterThan(0);
          for (const fieldId of fact.fieldIds) {
            expect(ask.askFieldIds, `${ask.id}/${fact.name}`).toContain(fieldId);
            expect(seen.has(fieldId), `${fieldId} is in two fact groups`).toBe(false);
            seen.add(fieldId);
          }
        }
      }
    });
  });

  // The open-fields dialog is where a clinician goes looking for what is
  // still missing, and isListableGap() is the only thing that can take a
  // field OFF that list. The end-condition flow test derives its expected
  // ids THROUGH this function, so it cannot catch it excluding the wrong
  // one (reviewer pass, PR #98, finding 1) — these pin the excluded set
  // by hand instead. Part 2 edits this exact function to add gates.
  describe("isListableGap", () => {
    const record = initAgenda();
    const REPORT_DATE = "Page1.SecA_Patient.ReportDate";
    const DEATH_DATE = "Page1.SecA_Patient.DeathDate";
    const LAB_ANCHOR = "Page3.TestDataTable.Row1.TestData1";

    it("excludes every field that is not an ask field, on a fresh record", () => {
      const excluded = FORM_3500_FIELDS.map((f) => f.id).filter((id) => !isListableGap(id, record));
      // Hand-written, not derived through the function: rule 4's one auto
      // field, rule 5's 31 lab write-target rows, rule 3's derive
      // companions (amended 2026-08-27, #101 — visible at Review, not
      // listed here), and the date of death, whose ask does not apply
      // with no death recorded.
      const auto = [REPORT_DATE];
      const conditional = [DEATH_DATE];
      const writeTargets = FORM_3500_FIELDS.map((f) => f.id).filter(
        (id) => dispositionOf(id) === "write-target",
      );
      const derives = FORM_3500_FIELDS.map((f) => f.id).filter((id) => dispositionOf(id) === "derive");
      expect(writeTargets).toHaveLength(31);
      expect(new Set(excluded)).toEqual(new Set([...auto, ...conditional, ...writeTargets, ...derives]));
    });

    // Spot-checks by name, so the set above can't drift into agreeing
    // with a wrong disposition table.
    it("excludes the age-unit checkboxes and the weight unit by name", () => {
      for (const fieldId of [
        "Page1.SecA_Patient.AgeYears",
        "Page1.SecA_Patient.AgeMonths",
        "Page1.SecA_Patient.AgeWeeks",
        "Page1.SecA_Patient.AgeDays",
        "Page1.SecA_Patient.WeightLB",
        "Page1.SecA_Patient.WeightKG",
        "Page4.Prod1.Prod1StrengthUnit",
        "Page7.SecG_Reporter.Country",
      ]) {
        expect(isListableGap(fieldId, record), fieldId).toBe(false);
      }
    });

    it("keeps LD-1's own anchor and the weight itself listable", () => {
      expect(isListableGap(LAB_ANCHOR, record)).toBe(true);
      expect(isListableGap("Page1.SecA_Patient.WeightValue", record)).toBe(true);
    });

    it("keeps every ask field of an applicable ask listable", () => {
      for (const ask of AUTHORED_ASKS) {
        if (!askApplies(ask, record)) continue;
        for (const fieldId of ask.askFieldIds) {
          expect(isListableGap(fieldId, record), `${ask.id}: ${fieldId}`).toBe(true);
        }
      }
    });

    // The conditional case in both directions: silence about a death must
    // not manufacture a "date of death" gap, and a recorded death must not
    // hide one.
    it("lists the date of death once a death is recorded, and not before", () => {
      expect(isListableGap(DEATH_DATE, record)).toBe(false);
      const withDeath = { ...record, "Page1.SecA_Patient.Death": { state: "answered" as const, value: "true" } };
      expect(isListableGap(DEATH_DATE, withDeath)).toBe(true);
      const withoutDeath = { ...record, "Page1.SecA_Patient.Death": { state: "answered" as const, value: "false" } };
      expect(isListableGap(DEATH_DATE, withoutDeath)).toBe(false);
    });

    it("never excludes an auto or write-target field's disposition by accident", () => {
      expect(dispositionOf(REPORT_DATE)).toBe("auto");
      expect(dispositionOf("Page3.TestDataTable.Row8.TDate7")).toBe("write-target");
      expect(dispositionOf(LAB_ANCHOR)).toBe("ask");
      expect(dispositionOf("Page1.SecA_Patient.AgeYears")).toBe("derive");
    });
  });

  describe("unresolvedAskFieldIds", () => {
    it("counts only the ask's own blocking fields — never its companions", () => {
      const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
      expect(unresolvedAskFieldIds(pb1, initAgenda())).toEqual(pb1.askFieldIds);
    });

    it("drops a field once it resolves, in the ask's own order", () => {
      const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
      const record = {
        ...initAgenda(),
        [pb1.askFieldIds[0]]: { state: "answered" as const, value: "MRN 1" },
      };
      expect(unresolvedAskFieldIds(pb1, record)).toEqual(pb1.askFieldIds.slice(1));
    });

    it("throws on a record that is missing one of the ask's fields", () => {
      const pb1 = AUTHORED_ASKS.find((a) => a.id === "PB-1")!;
      const record = { ...initAgenda() };
      delete record[pb1.askFieldIds[0]];
      expect(() => unresolvedAskFieldIds(pb1, record)).toThrow(/record missing field id/);
    });
  });
});
