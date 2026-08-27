// The Review surface's pure logic (Issue #45) — design.md's surface 4:
// "field-led sectioned cards (form sections A–G), every topic editable;
// an edit reopens the topic as a normal question (the existing reopen
// path)."
import { describe, expect, it } from "vitest";
import { displayName } from "./display-names";
import { openFieldEntries } from "./open-fields";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import {
  fieldDisplay,
  fieldIdsForReviewRow,
  reopenReviewRow,
  reviewFieldRows,
  reviewRows,
  SIGN_OFF_CTA,
} from "./review";
import { TOPICS, type RepeatCounts } from "./topics";

const PATIENT_IDENTIFIER = "Page1.SecA_Patient.PatientIdentifier";
const SUSPECT_1_LOT = "Page4.Prod1.Prod1LotNum";
const DESC_EVENT = "Page2.SecB_Adverse.DescEvent";
const CONCOMITANT_1 = "Page6.SecF_Other.Table1.Row1.Prod1";
const CONCOMITANT_2 = "Page6.SecF_Other.Table1.Row2.Prod2";
const CONCOMITANT_3 = "Page6.SecF_Other.Table1.Row3.Prod3";
const DEVICE_BRAND = "Page6.SecE_Device.BrandName";

const ONE_EACH: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };

function row(id: string, counts: RepeatCounts = ONE_EACH) {
  const found = reviewRows(counts).find((r) => r.id === id);
  if (!found) throw new Error(`no such review row: ${id}`);
  return found;
}

describe("fieldDisplay", () => {
  it("shows an answered value", () => {
    const record = applyAction(initAgenda(), PATIENT_IDENTIFIER, { type: "answer" }, "M.R. / 4471-08");
    expect(fieldDisplay(record, PATIENT_IDENTIFIER)).toEqual({
      text: "M.R. / 4471-08",
      muted: false,
      retained: false,
    });
  });

  it("mutes the unknown and declined sentinels", () => {
    let record = applyAction(initAgenda(), SUSPECT_1_LOT, { type: "mark_unknown" });
    record = applyAction(record, DESC_EVENT, { type: "decline" });
    expect(fieldDisplay(record, SUSPECT_1_LOT)).toEqual({ text: "Unknown", muted: true, retained: false });
    expect(fieldDisplay(record, DESC_EVENT)).toEqual({ text: "Declined to answer", muted: true, retained: false });
  });

  it("shows nothing for a never-touched field", () => {
    expect(fieldDisplay(initAgenda(), PATIENT_IDENTIFIER)).toEqual({ text: null, muted: false, retained: false });
  });

  it("surfaces a reopened field's retained prior value — the one case displayFor() leaves on the table", () => {
    // agenda.ts retains `entry.value` through a reopen ("reopen never
    // wipes"), but until now nothing user-facing read it back
    // (PR #64, finding 7). Review is where it becomes visible.
    let record = applyAction(initAgenda(), PATIENT_IDENTIFIER, { type: "answer" }, "M.R. / 4471-08");
    record = applyAction(record, PATIENT_IDENTIFIER, { type: "reopen" });
    expect(record[PATIENT_IDENTIFIER].state).toBe("unasked");
    expect(fieldDisplay(record, PATIENT_IDENTIFIER)).toEqual({
      text: "M.R. / 4471-08",
      muted: false,
      retained: true,
    });
  });

  it("does not claim a retained value for a field reopened from unknown", () => {
    // mark_unknown clears the value (agenda.ts), so a reopen after one
    // has nothing to retain — and must not show the sentinel either.
    let record = applyAction(initAgenda(), SUSPECT_1_LOT, { type: "mark_unknown" });
    record = applyAction(record, SUSPECT_1_LOT, { type: "reopen" });
    expect(fieldDisplay(record, SUSPECT_1_LOT)).toEqual({ text: null, muted: false, retained: false });
  });

  it("degrades to blank on a field id the manifest doesn't carry", () => {
    expect(fieldDisplay(initAgenda(), "not.a.real.field")).toEqual({ text: null, muted: false, retained: false });
  });
});

describe("reviewRows", () => {
  it("covers all seven form sections A–G, unlike the rail's curated nine", () => {
    const sections = new Set(reviewRows(ONE_EACH).map((r) => r.section));
    expect([...sections].sort()).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });

  it("splices the section-E device rows in ahead of the first F row", () => {
    const rows = reviewRows(ONE_EACH);
    const lastE = rows.map((r) => r.section).lastIndexOf("E");
    const firstF = rows.findIndex((r) => r.section === "F");
    expect(lastE).toBeGreaterThan(-1);
    expect(firstF).toBe(lastE + 1);
  });

  it("covers every section-E device topic — Review is the reachable place the rail says they live", () => {
    const covered = new Set(reviewRows(ONE_EACH).flatMap((r) => r.topicIds));
    const deviceTopics = TOPICS.filter((t) => t.section === "E");
    expect(deviceTopics.length).toBeGreaterThan(0);
    for (const topic of deviceTopics) expect(covered.has(topic.id)).toBe(true);
  });

  it("keeps the rail's own rows, one suspect-product row per confirmed instance", () => {
    expect(reviewRows(ONE_EACH).filter((r) => r.id.startsWith("suspect-product-")).map((r) => r.id)).toEqual([
      "suspect-product-1",
    ]);
    expect(
      reviewRows({ "suspect-product": 2 }).filter((r) => r.id.startsWith("suspect-product-")).map((r) => r.id),
    ).toEqual(["suspect-product-1", "suspect-product-2"]);
  });
});

describe("fieldIdsForReviewRow", () => {
  it("scopes a repeat row to its confirmed instances, not every slot the form has", () => {
    // Screen 05's card density, and design.md's "obvious gaps": a gap is
    // a reachable field, not a slot the clinician said doesn't exist.
    const oneMed = fieldIdsForReviewRow(row("concomitant-meds"), ONE_EACH);
    expect(oneMed).toContain(CONCOMITANT_1);
    expect(oneMed).not.toContain(CONCOMITANT_2);
    expect(oneMed).toHaveLength(3);

    const twoMeds = fieldIdsForReviewRow(row("concomitant-meds", { "concomitant-medication": 2 }), {
      "concomitant-medication": 2,
    });
    expect(twoMeds).toContain(CONCOMITANT_2);
    expect(twoMeds).not.toContain(CONCOMITANT_3);
    expect(twoMeds).toHaveLength(6);
  });

  it("returns a non-repeat row's fields whole", () => {
    const fields = fieldIdsForReviewRow(row("patient-basics"), ONE_EACH);
    expect(fields).toContain(PATIENT_IDENTIFIER);
  });

  it("returns the device rows' fields", () => {
    const deviceRow = reviewRows(ONE_EACH).find((r) => r.topicIds.some((id) => id.includes("device")));
    expect(deviceRow).toBeDefined();
    const covered = new Set(reviewRows(ONE_EACH).flatMap((r) => fieldIdsForReviewRow(r, ONE_EACH)));
    expect(covered.has(DEVICE_BRAND)).toBe(true);
  });
});

describe("reopenReviewRow", () => {
  function answerAll(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
    return fieldIds.reduce((rec, id) => applyAction(rec, id, { type: "answer" }, "x"), record);
  }

  it("reopens every resolved field in the row, retaining prior values", () => {
    const patientRow = row("patient-basics");
    const fieldIds = fieldIdsForReviewRow(patientRow, ONE_EACH);
    const record = answerAll(initAgenda(), fieldIds);
    const reopened = reopenReviewRow(record, patientRow, ONE_EACH);
    for (const id of fieldIds) {
      expect(reopened[id].state).toBe("unasked");
      expect(reopened[id].value).toBe("x");
    }
  });

  it("leaves fields outside the row untouched", () => {
    const patientRow = row("patient-basics");
    let record = answerAll(initAgenda(), fieldIdsForReviewRow(patientRow, ONE_EACH));
    record = applyAction(record, DESC_EVENT, { type: "answer" }, "rash");
    const reopened = reopenReviewRow(record, patientRow, ONE_EACH);
    expect(reopened[DESC_EVENT]).toEqual({ state: "answered", value: "rash" });
  });

  it("does not reach into repeat instances the clinician confirmed away", () => {
    const medsRow = row("concomitant-meds", { "concomitant-medication": 2 });
    const counts: RepeatCounts = { "concomitant-medication": 2 };
    // A slot-3 field carrying a stale resolved state (only reachable by
    // constructing one directly) must not be walked by a row scoped to
    // two confirmed instances.
    const record = applyAction(initAgenda(), CONCOMITANT_3, { type: "answer" }, "stale");
    const reopened = reopenReviewRow(record, medsRow, counts);
    expect(reopened[CONCOMITANT_3]).toEqual({ state: "answered", value: "stale" });
  });
});

describe("copy", () => {
  it("makes no submission claim in the sign-off CTA", () => {
    expect(SIGN_OFF_CTA).toBe("Sign off and continue");
    expect(SIGN_OFF_CTA.toLowerCase()).not.toContain("file");
  });
});

// Row labels are authored display names now (ask-copy.md rule 6), so the
// two label-shaping helpers this block used to cover — one that dropped a
// manifest label's card-repeating prefix, one that dropped a composed
// row's last segment — are gone with the derivation they served.
// display-names.test.ts owns the names themselves; reviewFieldRows below
// proves the rows read from them.

describe("reviewFieldRows", () => {
  const AGE_VALUE = "Page1.SecA_Patient.AgeValue";
  const AGE_YEARS = "Page1.SecA_Patient.AgeYears";
  const PROD_NAME = "Page4.Prod1.Prod1Name";
  const PROD_STRENGTH = "Page4.Prod1.Prod1Strength";
  const SEX_F = "Page1.SecA_Patient.SexF";

  function rowsFor(record: AgendaRecord, rowId: string) {
    return reviewFieldRows(record, row(rowId), ONE_EACH);
  }

  it("composes a value with its checked unit, and drops the unit's own row", () => {
    // PR #75's finding F1: a bare "42" under an "Age" label reads as
    // years even when the answered unit is months.
    let record = applyAction(initAgenda(), AGE_VALUE, { type: "answer" }, "42");
    record = applyAction(record, AGE_YEARS, { type: "answer" }, "true");
    const rows = rowsFor(record, "patient-basics");
    expect(rows.find((r) => r.fieldId === AGE_VALUE)?.text).toBe("42 yr");
    expect(rows.find((r) => r.fieldId === AGE_YEARS)).toBeUndefined();
  });

  it("composes the suspect product's identity box", () => {
    let record = applyAction(initAgenda(), PROD_NAME, { type: "answer" }, "Amoxicillin");
    record = applyAction(record, PROD_STRENGTH, { type: "answer" }, "875");
    const rows = rowsFor(record, "suspect-product-1");
    expect(rows.find((r) => r.fieldId === PROD_NAME)?.text).toBe("Amoxicillin 875");
    expect(rows.find((r) => r.fieldId === PROD_STRENGTH)).toBeUndefined();
    // The composition's authored caption, naming everything under it —
    // not the anchor's own name, which would understate a row showing
    // three facts (reviewer pass, PR #98, finding 2).
    expect(rows.find((r) => r.fieldId === PROD_NAME)?.label).toBe("product name, strength, and manufacturer");
  });

  it("renders fixed-choice fields the deleted review component filtered out (#69)", () => {
    const record = applyAction(initAgenda(), SEX_F, { type: "answer" }, "true");
    expect(rowsFor(record, "patient-basics").find((r) => r.fieldId === SEX_F)?.text).toBe("Yes");
  });

  it("keeps a reopened field's retained value visible even where a composition applies", () => {
    let record = applyAction(initAgenda(), AGE_VALUE, { type: "answer" }, "42");
    record = applyAction(record, AGE_VALUE, { type: "reopen" });
    const composed = rowsFor(record, "patient-basics").find((r) => r.fieldId === AGE_VALUE);
    expect(composed).toEqual({ fieldId: AGE_VALUE, label: "age", text: "42", muted: false, retained: true });
  });

  it("drops a field from the card only when a composition actually spoke for its value", () => {
    let record = applyAction(initAgenda(), AGE_VALUE, { type: "answer" }, "42");
    record = applyAction(record, AGE_YEARS, { type: "answer" }, "true");
    const ids = rowsFor(record, "patient-basics").map((r) => r.fieldId);
    expect(new Set(ids).size).toBe(ids.length);
    const reachable = fieldIdsForReviewRow(row("patient-basics"), ONE_EACH);
    // Exactly the one unit checkbox the rendered age composition folded
    // in. Weight's units stay — its own composition rendered nothing, so
    // it spoke for nothing.
    expect(reachable.filter((id) => !ids.includes(id))).toEqual([AGE_YEARS]);
    // …and the rows that remain keep the manifest's own order.
    expect(ids).toEqual(reachable.filter((id) => ids.includes(id)));
  });

  it("hides nothing on a blank record — an unrendered composition absorbs no fields", () => {
    const ids = rowsFor(initAgenda(), "patient-basics").map((r) => r.fieldId);
    expect(ids).toEqual(fieldIdsForReviewRow(row("patient-basics"), ONE_EACH));
  });

  // Reviewer pass, PR #78, finding 1. The composed helpers bail out on a
  // muted or blank anchor and fold in only `answered` values, so absorbing
  // unconditionally hid answered data that the exporter still wrote to the
  // PDF — the silent-drop class the charter weights heaviest.
  it("keeps an answered field visible when its composition's anchor is declined", () => {
    let record = applyAction(initAgenda(), "Page4.Prod1.Prod1Dose", { type: "decline" });
    record = applyAction(record, "Page4.Prod1.Prod1Freq", { type: "answer" }, "BID");
    record = applyAction(record, "Page4.Prod1.Prod1DoseUnit", { type: "answer" }, "MILLIGRAM(S) - MG");
    const rows = rowsFor(record, "suspect-product-1");
    expect(rows.find((r) => r.fieldId === "Page4.Prod1.Prod1Dose")?.text).toBe("Declined to answer");
    expect(rows.find((r) => r.fieldId === "Page4.Prod1.Prod1Freq")?.text).toBe("BID");
    expect(rows.find((r) => r.fieldId === "Page4.Prod1.Prod1DoseUnit")?.text).toBe("MILLIGRAM(S) - MG");
  });

  it("keeps an answered strength visible when the product name is unknown", () => {
    let record = applyAction(initAgenda(), PROD_NAME, { type: "mark_unknown" });
    record = applyAction(record, PROD_STRENGTH, { type: "answer" }, "875");
    const rows = rowsFor(record, "suspect-product-1");
    expect(rows.find((r) => r.fieldId === PROD_NAME)?.text).toBe("Unknown");
    expect(rows.find((r) => r.fieldId === PROD_STRENGTH)?.text).toBe("875");
  });

  it("shows an absorbed-but-unknown field as its own gap, not only in the open-fields dialog", () => {
    // design.md's "legible values and obvious gaps": a reachable field the
    // clinician marked unknown must read as a gap on the card too.
    let record = applyAction(initAgenda(), "Page4.Prod1.Prod1Dose", { type: "answer" }, "875");
    record = applyAction(record, "Page4.Prod1.Prod1DoseUnit", { type: "mark_unknown" });
    const rows = rowsFor(record, "suspect-product-1");
    expect(rows.find((r) => r.fieldId === "Page4.Prod1.Prod1Dose")?.text).toBe("875");
    expect(rows.find((r) => r.fieldId === "Page4.Prod1.Prod1DoseUnit")).toEqual({
      fieldId: "Page4.Prod1.Prod1DoseUnit",
      label: "dose unit",
      text: "Unknown",
      muted: true,
      retained: false,
    });
  });

  // A composition that speaks for more than one fact takes an authored
  // caption; one that only folds in its own fact's unit keeps the anchor's
  // display name.
  it("labels a multi-fact composition with a caption naming everything under it", () => {
    let record = applyAction(initAgenda(), PROD_NAME, { type: "answer" }, "amoxicillin");
    record = applyAction(record, PROD_STRENGTH, { type: "answer" }, "875");
    const identity = rowsFor(record, "suspect-product-1").find((r) => r.fieldId === PROD_NAME);
    expect(identity?.text).toBe("amoxicillin 875");
    expect(identity?.label).toBe("product name, strength, and manufacturer");

    let dosed = applyAction(initAgenda(), "Page4.Prod1.Prod1Dose", { type: "answer" }, "1 tablet");
    dosed = applyAction(dosed, "Page4.Prod1.Prod1Freq", { type: "answer" }, "BID");
    const dose = rowsFor(dosed, "suspect-product-1").find((r) => r.fieldId === "Page4.Prod1.Prod1Dose");
    expect(dose?.text).toBe("1 tablet BID");
    expect(dose?.label).toBe("dose and frequency");
  });

  // Rule 3 as amended (#101): a companion is visible on its anchor's
  // Review row either way, and becomes a LISTED gap once the anchor is
  // answered. The bare weight is the case the rule was authored for, so
  // both halves are asserted on it.
  it("shows an open derive companion on Review, and lists it once its anchor is answered", () => {
    const record = applyAction(initAgenda(), "Page1.SecA_Patient.WeightValue", { type: "answer" }, "80");
    const rows = rowsFor(record, "patient-basics");
    expect(rows.find((r) => r.fieldId === "Page1.SecA_Patient.WeightValue")?.text).toBe("80");
    for (const unit of ["Page1.SecA_Patient.WeightLB", "Page1.SecA_Patient.WeightKG"]) {
      expect(rows.map((r) => r.fieldId), unit).toContain(unit);
      expect(openFieldEntries(record, ONE_EACH).map((e) => e.fieldId), unit).toContain(unit);
    }
  });

  it("shows an unanchored companion on Review while listing it nowhere", () => {
    // No age given, so the four age-unit checkboxes are noise in the
    // dialog and still legible on the card.
    const record = initAgenda();
    const rows = rowsFor(record, "patient-basics").map((r) => r.fieldId);
    const listed = openFieldEntries(record, ONE_EACH).map((e) => e.fieldId);
    for (const unit of ["Page1.SecA_Patient.AgeYears", "Page1.SecA_Patient.AgeDays"]) {
      expect(rows, unit).toContain(unit);
      expect(listed, unit).not.toContain(unit);
    }
  });

  it("keeps the anchor's own name where the composition folds in only that fact's unit", () => {
    let record = applyAction(initAgenda(), AGE_VALUE, { type: "answer" }, "42");
    record = applyAction(record, AGE_YEARS, { type: "answer" }, "true");
    const age = rowsFor(record, "patient-basics").find((r) => r.fieldId === AGE_VALUE);
    expect(age?.text).toBe("42 yr");
    expect(age?.label).toBe("age");
  });

  it("labels every row from the authored names — no manifest label reaches a card", () => {
    let record = applyAction(initAgenda(), AGE_VALUE, { type: "answer" }, "42");
    record = applyAction(record, AGE_YEARS, { type: "answer" }, "true");
    const rows = rowsFor(record, "patient-basics");
    expect(rows.find((r) => r.fieldId === AGE_VALUE)?.label).toBe("age");
    const labels = new Set(FORM_3500_FIELDS.map((f) => f.label));
    for (const row of rows) {
      // Either the field's own authored name or a composition's authored
      // caption — never a manifest label, which is the whole of rule 6.
      expect(labels.has(row.label), row.label).toBe(false);
      expect(row.label, row.fieldId).not.toMatch(/Page\d|Prod\d\.|Sec[A-G]_/);
    }
    expect(rows.find((r) => r.fieldId === AGE_VALUE)?.label).toBe(displayName(AGE_VALUE));
  });
});
