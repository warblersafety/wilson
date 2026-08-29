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
  factGroups,
  hasOpenFields,
  openFieldEntries,
  openFieldsHeading,
  rowForField,
  summarizeOpenFields,
} from "./open-fields";
import { curatedRows } from "./report-chrome";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { TOPICS, type RepeatCounts } from "./topics";

const SUSPECT_1_LOT = "Page4.Prod1.Prod1LotNum";
const SUSPECT_2_LOT = "Page5.Prod2.Prod2LotNum";
const SUSPECT_2_NAME = "Page5.Prod2.Prod2Name";
const CONCOMITANT_1 = "Page6.SecF_Other.Table1.Row1.Prod1";
const CONCOMITANT_2 = "Page6.SecF_Other.Table1.Row2.Prod2";
const CONCOMITANT_3 = "Page6.SecF_Other.Table1.Row3.Prod3";
const PATIENT_IDENTIFIER = "Page1.SecA_Patient.PatientIdentifier";
const DESC_EVENT = "Page2.SecB_Adverse.DescEvent";

const SEX_M = "Page1.SecA_Patient.SexM";
const SEX_F = "Page1.SecA_Patient.SexF";
const RACE_FIELDS = [
  "Page1.SecA_Patient.RaceAmInd",
  "Page1.SecA_Patient.RaceAsian",
  "Page1.SecA_Patient.RaceBlack",
  "Page1.SecA_Patient.EthnicLatino",
  "Page1.SecA_Patient.RaceMiddleEastern",
  "Page1.SecA_Patient.RacePacific",
  "Page1.SecA_Patient.RaceWhite",
];
const RACE_WHITE = "Page1.SecA_Patient.RaceWhite";
const WEIGHT_VALUE = "Page1.SecA_Patient.WeightValue";
const WEIGHT_LB = "Page1.SecA_Patient.WeightLB";
const WEIGHT_KG = "Page1.SecA_Patient.WeightKG";
// Form order (topics.ts's own event-outcome fieldIds), NOT the fact's
// authored order in ask-inventory.ts (which follows OC-1's spoken
// sequence — "...death, another serious medical event" — and puts Death
// near the end): a row's fieldIds walk topic.fieldIds order, same as
// every other derivation in this codebase, so entries stay in form order
// even though the ask read them out differently.
const OUTCOME_FIELDS = [
  "Page1.SecA_Patient.Death",
  "Page1.SecA_Patient.Hospital",
  "Page1.SecA_Patient.LifeThreaten",
  "Page1.SecA_Patient.Disability",
  "Page1.SecA_Patient.ReqdInter",
  "Page1.SecA_Patient.Congenital",
  "Page1.SecA_Patient.OtherEvents",
];
const CONTACT_FIELDS = [
  "Page7.SecG_Reporter.LastName",
  "Page7.SecG_Reporter.FirstName",
  "Page7.SecG_Reporter.Address",
  "Page7.SecG_Reporter.City",
  "Page7.SecG_Reporter.State",
  "Page7.SecG_Reporter.ZipCode",
  "Page7.SecG_Reporter.PhoneNum",
  "Page7.SecG_Reporter.Email",
];
const P1_THERAPY_ONGOING_YES = "Page4.Prod1.Prod1TherapyOngoingYes";
const P1_THERAPY_ONGOING_NO = "Page4.Prod1.Prod1TherapyOngoingNo";
const P2_THERAPY_ONGOING_YES = "Page5.Prod2.Prod2TherapyOngoingYes";
const P2_THERAPY_ONGOING_NO = "Page5.Prod2.Prod2TherapyOngoingNo";

function markAllUnknown(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
  return fieldIds.reduce((rec, fieldId) => applyAction(rec, fieldId, { type: "mark_unknown" }), record);
}

function reopenAll(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
  return fieldIds.reduce((rec, fieldId) => applyAction(rec, fieldId, { type: "reopen" }), record);
}

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

// One row can now cover several field ids (ask-copy.md rule 8, #127), so
// this flattens rather than assuming one-row-per-field — every id in
// SUSPECT_1_LOT/PATIENT_IDENTIFIER/DESC_EVENT's family below is its own
// fact (none declares an AskFact or sits in an exclusive companion
// group), so for THIS file's fixtures the flattened list is still one
// entry per field; the "the fact unit" describe block below covers the
// collapsed case, where a row's fieldIds carries more than one id.
function ids(record: AgendaRecord, counts: RepeatCounts): string[] {
  return openFieldEntries(record, counts).flatMap((e) => e.fieldIds);
}

describe("openFieldEntries", () => {
  it("lists an `unknown` field with rule 8's 'you didn\'t have it' reason", () => {
    const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };
    const record = applyAction(allResolved(counts), SUSPECT_1_LOT, { type: "mark_unknown" });
    const entries = openFieldEntries(record, counts);
    expect(entries.map((e) => e.fieldIds)).toEqual([[SUSPECT_1_LOT]]);
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
    expect(entries.map((e) => e.fieldIds)).toEqual([[PATIENT_IDENTIFIER]]);
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

// ask-copy.md rule 8's open-fields unit, added 2026-08-29 (#127): "the
// open-fields unit is the fact, not the field." A multi-field fact or a
// rule-3 exclusive companion group is now ONE row, whatever its member
// count — proven here field-by-field rather than through a full gate
// case, so a broken collapse fails at the exact fact it broke.
describe("openFieldEntries — the fact unit (#127)", () => {
  const counts: RepeatCounts = { "suspect-product": 1, "concomitant-medication": 1 };

  it("a dismissed multi-select checkbox fact (PB-3) collapses to one row, not seven", () => {
    const record = markAllUnknown(allResolved(counts), RACE_FIELDS);
    const entries = openFieldEntries(record, counts);
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldIds).toEqual(RACE_FIELDS);
    expect(entries[0].label).toBe("race or ethnicity");
    expect(entries[0].reasonKind).toBe("unknown");
  });

  // The affordance that must not vanish (#127's own worked example): a
  // fact that merely RESOLVES from one member — PB-3's race/ethnicity —
  // leaves its remaining members genuinely `unasked` and genuinely
  // answerable, and the dialog's whole job is listing what a clinician
  // can still usefully answer. A build that instead keyed this off the
  // ASK's own "still blocking the walk?" question (unresolvedAskFieldIds
  // treats a factResolvesFromOne fact as settled the instant one member
  // answers) would silently drop this row — the finding that nearly
  // shipped.
  it("a factResolvesFromOne fact with one member answered still yields exactly one open row", () => {
    const withOneRace = allResolved(counts); // every field answered, including RaceWhite
    const record = reopenAll(withOneRace, RACE_FIELDS.filter((id) => id !== RACE_WHITE));
    const entries = openFieldEntries(record, counts);
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldIds).toEqual(RACE_FIELDS.filter((id) => id !== RACE_WHITE));
    expect(entries[0].fieldIds).toHaveLength(6);
    expect(entries[0].label).toBe("race or ethnicity");
    expect(entries[0].reasonKind).toBe("not-asked");
    expect(entries[0].reason).toBe("not asked yet");
  });

  it("every multi-field fact collapses, not only the checkbox ones — a bulk-mapped ask too (RC-1)", () => {
    const record = markAllUnknown(allResolved(counts), CONTACT_FIELDS);
    const entries = openFieldEntries(record, counts);
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldIds).toEqual(CONTACT_FIELDS);
    // Nothing of the fact is on the record — the PLAIN standalone name,
    // not "the rest of" (ask-copy.md rule 8/9, #125's record-following
    // naming, reused here rather than re-derived).
    expect(entries[0].label).toBe("your contact details");
  });

  // The referent bug #125 removed, reintroduced by passing the fact's
  // whole fieldIds instead of the still-open subset: a half-held RC-1
  // must read "the rest of your contact details", never "your contact
  // details" (which claims nothing is on the record when part of it is).
  it("names a partially-held bulk fact by what's still open, not the fact's whole field set", () => {
    let record = applyAction(allResolved(counts), CONTACT_FIELDS[0], { type: "answer" }, "Smith");
    record = markAllUnknown(record, CONTACT_FIELDS.slice(1));
    const entries = openFieldEntries(record, counts);
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldIds).toEqual(CONTACT_FIELDS.slice(1));
    expect(entries[0].fieldIds).not.toContain(CONTACT_FIELDS[0]);
    expect(entries[0].label).toBe("the rest of your contact details");
  });

  it("a dismissed exclusive fact (sex) collapses to one row, not two", () => {
    const record = markAllUnknown(allResolved(counts), [SEX_M, SEX_F]);
    const entries = openFieldEntries(record, counts);
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldIds).toEqual([SEX_M, SEX_F]);
    expect(entries[0].label).toBe("sex");
    expect(entries[0].reasonKind).toBe("unknown");
  });

  it("a fact rule 7 completes (both exclusive members answered) contributes no row at all", () => {
    // allResolved() already answers every reachable field, sex included
    // — the ordinary "nothing left open" baseline every other test in
    // this file starts from. Named explicitly here because #127 singles
    // this case out: a completed fact must contribute nothing, whatever
    // its members' field-level states look like individually.
    const record = allResolved(counts);
    expect(openFieldEntries(record, counts).filter((e) => e.fieldIds.includes(SEX_M))).toEqual([]);
  });

  it("a voicesEveryMember fact (outcome) collapses to one row, not seven", () => {
    const record = markAllUnknown(allResolved(counts), OUTCOME_FIELDS);
    const entries = openFieldEntries(record, counts);
    expect(entries).toHaveLength(1);
    expect(entries[0].fieldIds).toEqual(OUTCOME_FIELDS);
    expect(entries[0].label).toBe("outcome");
  });

  // Rule 3's exclusive companion groups (age unit, weight unit) are not
  // AskFacts — keying the collapse on ask.facts alone would miss them
  // entirely, leaving a stated bare weight as two rows for the single
  // authored clarification "Was that pounds or kilograms?"
  it("the weight companion pair yields one row, not two", () => {
    // A STATED bare weight: the value is answered (allResolved's own
    // baseline), but neither unit is — the genuinely ambiguous case rule
    // 3 leaves open rather than defaulting (unlike age).
    const record = reopenAll(allResolved(counts), [WEIGHT_LB, WEIGHT_KG]);
    expect(record[WEIGHT_VALUE].state).toBe("answered"); // the anchor this scenario depends on
    const entries = openFieldEntries(record, counts);
    const weightEntry = entries.find((e) => e.fieldIds.includes(WEIGHT_LB));
    expect(weightEntry).toBeDefined();
    expect(weightEntry!.fieldIds).toEqual([WEIGHT_LB, WEIGHT_KG]);
    expect(weightEntry!.label).toBe("Was that pounds or kilograms?");
    expect(weightEntry!.reasonKind).toBe("not-asked");
    // Confirms the pair doesn't ALSO leak through as two separate rows
    // alongside the collapsed one.
    expect(entries.filter((e) => e.fieldIds.includes(WEIGHT_LB) || e.fieldIds.includes(WEIGHT_KG))).toHaveLength(1);
  });

  // suspectProduct(2) reuses instance 1's authored fact names byte for
  // byte ("therapy status"), so a confirmed second product with the same
  // fact open would render two identical rows with nothing to tell them
  // apart — carrying the instance marker the way display names already
  // do ("product #2").
  it("two suspect products yield two distinguishable rows for the same fact", () => {
    const twoProducts: RepeatCounts = { "suspect-product": 2, "concomitant-medication": 1 };
    const record = markAllUnknown(allResolved(twoProducts), [
      P1_THERAPY_ONGOING_YES,
      P1_THERAPY_ONGOING_NO,
      P2_THERAPY_ONGOING_YES,
      P2_THERAPY_ONGOING_NO,
    ]);
    const entries = openFieldEntries(record, twoProducts);
    const therapyStatusRows = entries.filter(
      (e) => e.fieldIds.includes(P1_THERAPY_ONGOING_YES) || e.fieldIds.includes(P2_THERAPY_ONGOING_YES),
    );
    expect(therapyStatusRows).toHaveLength(2);
    const labels = therapyStatusRows.map((e) => e.label);
    expect(labels).toContain("therapy status");
    expect(labels).toContain("product #2 therapy status");
    // Genuinely distinguishable, not a coincidental match on a shared
    // substring.
    expect(new Set(labels).size).toBe(2);
  });
});

// The shared grouping this dialog and the chrome footer/Ready now BOTH
// depend on (rule 8, #127 rev 3: "one mechanism, not a second copy that
// can drift"). Tested directly against the manifest, not against any
// caller's own bucketing — a bug here would otherwise be invisible to a
// test whose own oracle also calls factGroups() (mutation-tested: an
// undeduplicated factGroups() slipped straight past the fact-counting
// reconciliation property in open-fields-gate-fixture.test.ts, because
// that property's own oracle groups fields the same way).
describe("factGroups", () => {
  it("covers every manifest field exactly once, no field in two groups and none omitted", () => {
    const flattened = factGroups().flat();
    expect(flattened.length, "no duplicates").toBe(new Set(flattened).size);
    expect(new Set(flattened)).toEqual(new Set(FORM_3500_FIELDS.map((f) => f.id)));
  });

  it("a multi-field fact is one group, not one group per member", () => {
    const race = factGroups().find((g) => g.includes("Page1.SecA_Patient.RaceWhite"));
    expect(race).toEqual([
      "Page1.SecA_Patient.RaceAmInd",
      "Page1.SecA_Patient.RaceAsian",
      "Page1.SecA_Patient.RaceBlack",
      "Page1.SecA_Patient.EthnicLatino",
      "Page1.SecA_Patient.RaceMiddleEastern",
      "Page1.SecA_Patient.RacePacific",
      "Page1.SecA_Patient.RaceWhite",
    ]);
    // Not seven separate one-member groups.
    expect(factGroups().filter((g) => g.includes("Page1.SecA_Patient.RaceWhite"))).toHaveLength(1);
  });
});

describe("openFieldsHeading — the unit noun (#127)", () => {
  it("says 'item', never 'field'", () => {
    expect(openFieldsHeading(1)).toBe("1 item is still open.");
    expect(openFieldsHeading(5)).toBe("5 items are still open.");
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
