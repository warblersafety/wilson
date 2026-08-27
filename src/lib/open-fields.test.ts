// The Open-fields dialog's derivation (Issue #45) — design.md's surface
// 5: "what's still `unknown` or unasked, listed with its reason, each
// answerable from here; 'file as it stands' always available... this
// surface nudges, it never gates."
//
// The semantics these tests pin, which are the whole correctness risk
// here: the entry set is the REACHABLE field set — every non-repeat
// topic plus repeat instances the clinician confirmed exist — not the
// whole 227-field manifest. A slot decided not to exist was answered,
// not skipped over, and listing it as "not asked yet" would be a false
// reason for a product the clinician said isn't there.
import { describe, expect, it } from "vitest";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";
import {
  hasOpenFields,
  openFieldEntries,
  rowForField,
  summarizeOpenFields,
} from "./open-fields";
import { curatedRows } from "./report-chrome";
import { TOPICS, type RepeatCounts } from "./topics";

const SUSPECT_1_LOT = "Page4.Prod1.Prod1LotNum";
const SUSPECT_2_LOT = "Page5.Prod2.Prod2LotNum";
const SUSPECT_2_NAME = "Page5.Prod2.Prod2Name";
const CONCOMITANT_1 = "Page6.SecF_Other.Table1.Row1.Prod1";
const CONCOMITANT_2 = "Page6.SecF_Other.Table1.Row2.Prod2";
const CONCOMITANT_3 = "Page6.SecF_Other.Table1.Row3.Prod3";
const PATIENT_IDENTIFIER = "Page1.SecA_Patient.PatientIdentifier";
const DESC_EVENT = "Page2.SecB_Adverse.DescEvent";

// Every reachable field resolved, so a test can then re-open exactly the
// states it cares about instead of fighting 200-odd `unasked` entries.
function allResolved(counts: RepeatCounts): AgendaRecord {
  let record = initAgenda();
  const reachable = TOPICS.filter(
    (t) => t.repeatInstance === null || t.repeatInstance <= (counts[t.repeatGroup!] ?? 1),
  );
  for (const topic of reachable) {
    for (const fieldId of topic.fieldIds) {
      record = applyAction(record, fieldId, { type: "answer" }, "x");
    }
  }
  return record;
}

function ids(record: AgendaRecord, counts: RepeatCounts): string[] {
  return openFieldEntries(record, counts).map((e) => e.fieldId);
}

describe("openFieldEntries", () => {
  it("lists an `unknown` field with rule 8's 'you didn\'t have it' reason", () => {
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    const record = applyAction(allResolved(counts), SUSPECT_1_LOT, { type: "mark_unknown" });
    const entries = openFieldEntries(record, counts);
    expect(entries.map((e) => e.fieldId)).toEqual([SUSPECT_1_LOT]);
    expect(entries[0].reasonKind).toBe("unknown");
    expect(entries[0].reason).toBe("you didn't have it");
    // The authored display name, not the manifest label this used to
    // render straight into the dialog (ask-copy.md rule 6).
    expect(entries[0].label).toBe("lot number");
  });

  it("excludes answered and declined fields — clinician-established states are never nudged", () => {
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    let record = allResolved(counts);
    record = applyAction(record, DESC_EVENT, { type: "decline" });
    expect(ids(record, counts)).toEqual([]);
  });

  it("includes an `unknown` field inside a CONFIRMED instance 2 — the reason openFollowUpFields can't be reused", () => {
    const counts: RepeatCounts = { "suspect-product": 2, "concomitant-medication": 1 };
    const record = applyAction(allResolved(counts), SUSPECT_2_LOT, { type: "mark_unknown" });
    expect(ids(record, counts)).toContain(SUSPECT_2_LOT);
  });

  it("excludes every field of a slot the clinician confirmed does not exist", () => {
    // suspect-product 1 only: instance 2's fields are `unasked` forever,
    // because that slot was DECIDED away, not left unasked.
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 2 };
    const record = allResolved(counts);
    const listed = ids(record, counts);
    expect(listed).not.toContain(SUSPECT_2_LOT);
    expect(listed).not.toContain(SUSPECT_2_NAME);
    expect(listed).not.toContain(CONCOMITANT_3);
    expect(listed).toEqual([]);
  });

  it("reports a reachable `unasked` field as 'not asked yet'", () => {
    // Constructed directly rather than reached through the flow: at
    // `done` the machinery guarantees no reachable field is `unasked`.
    // The category is still real — and honest for any future reachable-
    // unasked state — so it is proven here rather than left unexercised.
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    const record = applyAction(allResolved(counts), PATIENT_IDENTIFIER, { type: "reopen" });
    const entries = openFieldEntries(record, counts);
    expect(entries.map((e) => e.fieldId)).toEqual([PATIENT_IDENTIFIER]);
    expect(entries[0].reasonKind).toBe("not-asked");
    expect(entries[0].reason).toBe("not asked yet");
  });

  it("treats an undecided repeat group as instance 1 only", () => {
    // No decision recorded yet: instance 1 is always reachable
    // (nextStep()'s "instance 1 is always asked unconditionally"),
    // instance 2+ is not yet.
    const record = initAgenda();
    const listed = ids(record, {});
    expect(listed).toContain(CONCOMITANT_1);
    expect(listed).not.toContain(CONCOMITANT_2);
    expect(listed).not.toContain(SUSPECT_2_LOT);
  });

  it("orders entries by the topic map's own walk, so the dialog reads in form order", () => {
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    let record = allResolved(counts);
    record = applyAction(record, SUSPECT_1_LOT, { type: "mark_unknown" });
    record = applyAction(record, PATIENT_IDENTIFIER, { type: "mark_unknown" });
    expect(ids(record, counts)).toEqual([PATIENT_IDENTIFIER, SUSPECT_1_LOT]);
  });
});

describe("hasOpenFields", () => {
  it("is false when every reachable field is resolved", () => {
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    expect(hasOpenFields(allResolved(counts), counts)).toBe(false);
  });

  it("is true on a blank record", () => {
    expect(hasOpenFields(initAgenda(), {})).toBe(true);
  });
});

describe("summarizeOpenFields", () => {
  // The AC's "filing is never blocked on completeness (asserted by test
  // on the gating logic)" made literal. canFinishAsIs has no gating
  // condition anywhere in its computation, so this assertion is
  // deliberately tautological: it is the tripwire that turns any future
  // completeness gate into a visible, test-breaking decision rather than
  // a quiet one.
  it("stays finishable with entries outstanding", () => {
    const summary = summarizeOpenFields(initAgenda(), {});
    expect(summary.entries.length).toBeGreaterThan(0);
    expect(summary.canFinishAsIs).toBe(true);
  });

  it("stays finishable with nothing outstanding", () => {
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    const summary = summarizeOpenFields(allResolved(counts), counts);
    expect(summary.entries).toEqual([]);
    expect(summary.canFinishAsIs).toBe(true);
  });

  it("counts the entries it carries, so the heading is never hardcoded", () => {
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    let record = allResolved(counts);
    record = applyAction(record, SUSPECT_1_LOT, { type: "mark_unknown" });
    record = applyAction(record, PATIENT_IDENTIFIER, { type: "mark_unknown" });
    expect(summarizeOpenFields(record, counts).entries).toHaveLength(2);
  });
});

describe("rowForField", () => {
  const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };

  it("resolves a field to the review row its Answer affordance reopens", () => {
    const rows = curatedRows(counts);
    expect(rowForField(SUSPECT_1_LOT, rows)?.id).toBe("suspect-product-1");
    expect(rowForField(CONCOMITANT_1, rows)?.id).toBe("concomitant-meds");
  });

  it("returns undefined for a field no row covers", () => {
    // Section E (device) has no curated row — reviewRows() splices those
    // in for Review itself; this function answers only what it is given.
    const rows = curatedRows(counts);
    expect(rowForField("Page6.SecE_Device.BrandName", rows)).toBeUndefined();
  });
});
