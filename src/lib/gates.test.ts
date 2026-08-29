// docs/ask-copy.md rule 5. The point of every test here is the same: a
// gated-off topic is NOT part of this report, which is a different claim
// from "no" — and the difference has to survive into the walk, the
// open-fields dialog, the counts, and the rail.
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import {
  filterLabRowOverflow,
  involvesProductHandling,
  isDeviceReport,
  isTopicGatedOff,
} from "./gates";
import { openFieldEntries } from "./open-fields";
import { initRepeatCounts, nextStep, TOPICS } from "./topics";

const ONE_EACH = { "suspect-product": 1, "concomitant-medication": 1 };
const answer = (record: AgendaRecord, id: string, value: string) =>
  applyAction(record, id, { type: "answer" }, value);

const DEVICE_TOPICS = ["device-identity", "device-usage", "device-history"];
const PURCHASE_TOPICS = ["suspect-product-1-purchase", "suspect-product-2-purchase"];

describe("the device gate", () => {
  it("is closed for a plain adverse-reaction report", () => {
    for (const topicId of DEVICE_TOPICS) expect(isTopicGatedOff(topicId, initAgenda()), topicId).toBe(true);
  });

  // Rule 5: "any Section E field has a validated proposal, or the
  // clinician says so". No ask voices devices, so this is the only path
  // the build currently has — #99 is the click-path it does not.
  it("opens on any Section E field the clinician's words reached", () => {
    const record = answer(initAgenda(), "Page6.SecE_Device.BrandName", "InfusePro 3000");
    for (const topicId of DEVICE_TOPICS) expect(isTopicGatedOff(topicId, record), topicId).toBe(false);
    expect(isDeviceReport(record)).toBe(true);
  });

  it("opens on an unknown or a decline too — not having the model number is not not-having-a-device", () => {
    for (const action of [{ type: "mark_unknown" as const }, { type: "decline" as const }]) {
      const record = applyAction(initAgenda(), "Page6.SecE_Device.ModelNum", action);
      expect(isDeviceReport(record), action.type).toBe(true);
    }
  });

  it("stays open through a reopen, which retains the value", () => {
    let record = answer(initAgenda(), "Page6.SecE_Device.BrandName", "InfusePro 3000");
    record = applyAction(record, "Page6.SecE_Device.BrandName", { type: "reopen" });
    expect(isDeviceReport(record)).toBe(true);
  });
});

describe("the availability and purchase gates", () => {
  it("are closed for a plain adverse-reaction report", () => {
    const record = initAgenda();
    expect(isTopicGatedOff("product-availability", record)).toBe(true);
    for (const topicId of PURCHASE_TOPICS) expect(isTopicGatedOff(topicId, record), topicId).toBe(true);
  });

  it("open on a product problem, a use error, or a manufacturer switch", () => {
    for (const fieldId of [
      "Page1.SecA_Patient.RepError",
      "Page1.SecA_Patient.Defects",
      "Page1.SecA_Patient.DiffManu",
    ]) {
      const record = answer(initAgenda(), fieldId, "true");
      expect(involvesProductHandling(record), fieldId).toBe(true);
      expect(isTopicGatedOff("product-availability", record), fieldId).toBe(false);
    }
  });

  it("open on an OTC, compounded, cannabinoid or cosmetic product type, in either instance", () => {
    for (const fieldId of [
      "Page4.Prod1.Prod1OTC",
      "Page4.Prod1.Prod1Compounded",
      "Page4.Prod1.Prod1Cannabi",
      "Page4.Prod1.Prod1CosRetail",
      "Page4.Prod1.Prod1CosmProf",
      "Page5.Prod2.Pdt2Cannabi",
      "Page5.Prod2.pdt2CosmProf",
    ]) {
      expect(involvesProductHandling(answer(initAgenda(), fieldId, "true")), fieldId).toBe(true);
    }
  });

  it("open on a device report too", () => {
    const record = answer(initAgenda(), "Page6.SecE_Device.CommName", "infusion pump");
    expect(isTopicGatedOff("product-availability", record)).toBe(false);
  });

  // The distinction rule 7 draws: a negative is an ANSWER, and it opens
  // nothing. Only silence and a stated yes differ here.
  it("stay closed when the report type was answered NO", () => {
    const record = answer(initAgenda(), "Page1.SecA_Patient.Defects", "false");
    expect(involvesProductHandling(record)).toBe(false);
    expect(isTopicGatedOff("product-availability", record)).toBe(true);
  });

  it("stays closed for an adverse-event report type — the ordinary case", () => {
    const record = answer(initAgenda(), "Page1.SecA_Patient.RepAdverse", "true");
    expect(isTopicGatedOff("product-availability", record)).toBe(true);
  });
});

describe("what a closed gate does to the rest of the app", () => {
  it("keeps the topic out of the walk entirely", () => {
    let record = initAgenda();
    let counts = initRepeatCounts();
    const visited = new Set<string>();
    for (let guard = 0; guard < 200; guard += 1) {
      const step = nextStep(record, counts);
      if (step.kind === "done") break;
      if (step.kind === "repeat-decision") {
        counts = { ...counts, [step.repeatGroup]: step.afterInstance };
        continue;
      }
      visited.add(step.topic.id);
      record = step.fieldIds.reduce((r, id) => applyAction(r, id, { type: "mark_unknown" }), record);
    }
    for (const topicId of [...DEVICE_TOPICS, ...PURCHASE_TOPICS, "product-availability"]) {
      expect(visited.has(topicId), topicId).toBe(false);
    }
  });

  it("keeps its fields out of the open-fields dialog and its count", () => {
    const listed = openFieldEntries(initAgenda(), ONE_EACH).flatMap((e) => e.fieldIds);
    const gatedFieldIds = TOPICS.filter((t) => isTopicGatedOff(t.id, initAgenda())).flatMap((t) => t.fieldIds);
    expect(gatedFieldIds.length).toBeGreaterThan(0);
    for (const id of gatedFieldIds) expect(listed, id).not.toContain(id);
  });

  it("puts them back the moment the gate opens — rule 5's Timing clause", () => {
    const record = answer(initAgenda(), "Page1.SecA_Patient.Defects", "true");
    // PA-1's three product-availability boxes are one exclusive fact
    // (ask-copy.md rule 8, #127) — all still open here (fresh gate,
    // nothing answered), so they collapse to one dialog row; flattened
    // to check the field itself surfaced, not that it owns its own row.
    const listed = openFieldEntries(record, ONE_EACH).flatMap((e) => e.fieldIds);
    expect(listed).toContain("Page3.TestDataTable.EvalYes");
  });
});

describe("the lab table's row gate", () => {
  const ROW1 = "Page3.TestDataTable.Row1.TestData1";
  const ROW2 = "Page3.TestDataTable.Row2.TestData2";
  const ROW3 = "Page3.TestDataTable.Row3.TestData3";
  const write = (fieldId: string, value: string) => ({ fieldId, type: "answer" as const, value });

  it("lets one turn fill several rows in order — the ask asks for every test at once", () => {
    const kept = filterLabRowOverflow(initAgenda(), [write(ROW1, "ALT 402"), write(ROW2, "AST 210")]);
    expect(kept).toHaveLength(2);
  });

  it("drops a row-3 write when row 2 is empty, so the form never shows a phantom gap", () => {
    const record = answer(initAgenda(), ROW1, "ALT 402");
    const kept = filterLabRowOverflow(record, [write(ROW3, "AST 210")]);
    expect(kept).toEqual([]);
  });

  it("drops a later row when row 1 says the literal None — rule 7's text negative", () => {
    const record = answer(initAgenda(), ROW1, "None");
    expect(filterLabRowOverflow(record, [write(ROW2, "AST 210")])).toEqual([]);
    // Case and padding don't rescue it.
    expect(filterLabRowOverflow(answer(initAgenda(), ROW1, " none "), [write(ROW2, "x")])).toEqual([]);
  });

  it("accepts a row-2 write once row 1 holds real content", () => {
    const record = answer(initAgenda(), ROW1, "ALT 402");
    expect(filterLabRowOverflow(record, [write(ROW2, "AST 210")])).toHaveLength(1);
  });

  it("leaves every non-lab write alone", () => {
    const writes = [write("Page1.SecA_Patient.AgeValue", "61"), write("Page4.Prod1.Prod1Name", "amoxicillin")];
    expect(filterLabRowOverflow(initAgenda(), writes)).toEqual(writes);
  });
});
