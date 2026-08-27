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
  anchorOf,
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

    // Hand-written, and hand-written means hand-written: an earlier round
    // built this set by calling dispositionOf(), the table isListableGap()
    // itself delegates to, so it could only ever agree with the
    // implementation (reviewer passes on PR #98 finding 1, and PR #104
    // finding 2 for the repeat). These are literal ids and a literal
    // count.
    it("excludes exactly these 74 fields on a fresh record, and no others", () => {
      const excluded = FORM_3500_FIELDS.map((f) => f.id).filter((id) => !isListableGap(id, record));
      expect(excluded).toHaveLength(74);
      // Rule 4's auto field, and the ask whose condition does not hold.
      expect(excluded).toContain(REPORT_DATE);
      expect(excluded).toContain(DEATH_DATE);
      // Rule 5's 31 write-target rows: the whole lab table but LD-1's anchor.
      const labRows = FORM_3500_FIELDS.map((f) => f.id).filter(
        (id) => id.startsWith("Page3.TestDataTable.Row") && id !== LAB_ANCHOR && !id.endsWith("PicYes"),
      );
      expect(labRows).toHaveLength(31);
      for (const id of labRows) expect(excluded, id).toContain(id);
      // Rule 3's companions, all 41 of them, none of whose anchors is
      // answered on a fresh record.
      for (const id of [
        "Page1.SecA_Patient.AgeYears",
        "Page1.SecA_Patient.AgeMonths",
        "Page1.SecA_Patient.AgeWeeks",
        "Page1.SecA_Patient.AgeDays",
        "Page1.SecA_Patient.WeightLB",
        "Page1.SecA_Patient.WeightKG",
        "Page3.TestDataTable.ReturnDate",
        "Page4.Prod1.Prod1StrengthUnit",
        "Page4.Prod1.Prod1DoseUnit",
        "Page4.Prod1.Prod1FreqOther",
        "Page4.Prod1.Prod1RouteOther",
        "Page4.Prod1.Prod1TherapyDuration",
        "Page4.Prod1.Prod1TherapyDurUnit",
        "Page6.SecE_Device.ReprocInfo",
        "Page6.SecF_Other.Table1.Row1.Start1",
        "Page6.SecF_Other.Table1.Row1.End1",
        "Page7.SecG_Reporter.Country",
      ]) {
        expect(excluded, id).toContain(id);
      }
      // 1 auto + 1 conditional + 31 write-target + 41 companions = 74.
      expect(1 + 1 + 31 + 41).toBe(74);
    });

    // The fix that finding 1 of PR #104's reviewer pass demanded: the
    // discriminator is anchor state, not the derive bucket. Each of these
    // is a fact an ask voices out loud, and a blanket derive exclusion
    // hid every one of them.
    describe("a companion becomes a gap once its anchor is answered", () => {
      const answered = (fieldId: string, value: string) => ({
        ...record,
        [fieldId]: { state: "answered" as const, value },
      });

      it("lists a bare weight's lb/kg — rule 3's own worked example", () => {
        const withWeight = answered("Page1.SecA_Patient.WeightValue", "80");
        expect(isListableGap("Page1.SecA_Patient.WeightLB", withWeight)).toBe(true);
        expect(isListableGap("Page1.SecA_Patient.WeightKG", withWeight)).toBe(true);
        // ...and still not the age units, which nothing anchors.
        expect(isListableGap("Page1.SecA_Patient.AgeYears", withWeight)).toBe(false);
      });

      it("lists PA-1's return date only when the product WAS returned", () => {
        expect(isListableGap("Page3.TestDataTable.ReturnDate", answered("Page3.TestDataTable.EvalRetd", "false"))).toBe(
          false,
        );
        expect(isListableGap("Page3.TestDataTable.ReturnDate", answered("Page3.TestDataTable.EvalRetd", "true"))).toBe(
          true,
        );
      });

      it("lists DV-3's reprocessor only when it WAS a reprocessed device", () => {
        expect(isListableGap("Page6.SecE_Device.ReprocInfo", answered("Page6.SecE_Device.ReuseYes", "false"))).toBe(
          false,
        );
        expect(isListableGap("Page6.SecE_Device.ReprocInfo", answered("Page6.SecE_Device.ReuseYes", "true"))).toBe(true);
      });

      it("lists a named medication's therapy dates", () => {
        const named = answered("Page6.SecF_Other.Table1.Row1.Prod1", "lisinopril");
        expect(isListableGap("Page6.SecF_Other.Table1.Row1.Start1", named)).toBe(true);
        expect(isListableGap("Page6.SecF_Other.Table1.Row1.End1", named)).toBe(true);
      });

      it("lists a stated dose's unit and a stated strength's unit", () => {
        expect(isListableGap("Page4.Prod1.Prod1DoseUnit", answered("Page4.Prod1.Prod1Dose", "1 tablet"))).toBe(true);
        expect(isListableGap("Page4.Prod1.Prod1StrengthUnit", answered("Page4.Prod1.Prod1Strength", "875"))).toBe(true);
      });

      it("never lists an anchorless companion — it fills from the words or not at all", () => {
        for (const id of [
          "Page4.Prod1.Prod1TherapyDuration",
          "Page5.Prod2.Prod2TherapyDuration",
          "Page7.SecG_Reporter.Country",
        ]) {
          expect(anchorOf(id), id).toBeUndefined();
          const anythingAnswered = answered("Page4.Prod1.Prod1TherapyStartDate", "1 Jan");
          expect(isListableGap(id, anythingAnswered), id).toBe(false);
        }
      });

      it("closes a unit question's alternatives once any of them is answered", () => {
        const aged = answered("Page1.SecA_Patient.AgeValue", "61");
        // Nothing derived yet: which unit it is remains a live question.
        expect(isListableGap("Page1.SecA_Patient.AgeYears", aged)).toBe(true);
        expect(isListableGap("Page1.SecA_Patient.AgeMonths", aged)).toBe(true);
        // Rule 3's bare-age default lands (a bare age is years), and the
        // other three stop being gaps — the question is settled.
        const derived = { ...aged, "Page1.SecA_Patient.AgeYears": { state: "answered" as const, value: "true" } };
        for (const unit of [
          "Page1.SecA_Patient.AgeMonths",
          "Page1.SecA_Patient.AgeWeeks",
          "Page1.SecA_Patient.AgeDays",
        ]) {
          expect(isListableGap(unit, derived), unit).toBe(false);
        }
      });

      it("does not treat a medication's start and stop dates as alternatives", () => {
        // Two facts, not one question: answering the start leaves the
        // stop open, unlike a unit group.
        const named = answered("Page6.SecF_Other.Table1.Row1.Prod1", "lisinopril");
        const started = {
          ...named,
          "Page6.SecF_Other.Table1.Row1.Start1": { state: "answered" as const, value: "Jan" },
        };
        expect(isListableGap("Page6.SecF_Other.Table1.Row1.End1", started)).toBe(true);
      });

      it("does not list a companion whose anchor is unknown or declined", () => {
        for (const action of ["mark_unknown", "decline"] as const) {
          const dismissed = { ...record, "Page1.SecA_Patient.WeightValue": { state: action === "mark_unknown" ? ("unknown" as const) : ("declined" as const) } };
          expect(isListableGap("Page1.SecA_Patient.WeightLB", dismissed), action).toBe(false);
        }
      });

      it("names an anchor for every companion that any ask voices out loud", () => {
        // The four the blanket exclusion hid, pinned by name so a future
        // disposition change cannot quietly drop one back out.
        for (const [companion, anchor] of [
          ["Page3.TestDataTable.ReturnDate", "Page3.TestDataTable.EvalRetd"],
          ["Page6.SecE_Device.ReprocInfo", "Page6.SecE_Device.ReuseYes"],
          ["Page6.SecF_Other.Table1.Row1.Start1", "Page6.SecF_Other.Table1.Row1.Prod1"],
          ["Page1.SecA_Patient.WeightLB", "Page1.SecA_Patient.WeightValue"],
        ] as const) {
          expect(anchorOf(companion), companion).toBe(anchor);
        }
      });
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
