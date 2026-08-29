// AC-4's pinned fixture (ask-copy.md rule 8, #127): "the pinned numbers
// are post-change and must be shown to RECONCILE: each case's drop from
// its pre-change headline equals the members-minus-facts arithmetic this
// rule predicts for that case's own open facts, not merely a smaller
// plausible number." Driven the same way gate-cases.test.ts drives the
// five walkable cases (simulateCase over each case's own steps/script),
// so a future ask-inventory change that silently reshapes what a case
// leaves open is caught here, not at the next gate run.
//
// C6 is not pinnable as the harness stands (gate-cases.test.ts filters it
// out of WALK_CASES; simulateCase stops at start-over), so this file
// pins the five it CAN drive and says five — the contract's own words.
//
// **The reconciliation, and why it is not a tautology.** Two numbers per
// case are external to this file's own computation: PRE_CHANGE_BASELINE
// (measured on `dev` `2e4d1b4`, before this unit, by the OLD one-row-
// per-field openFieldEntries) and POST_CHANGE_HEADLINE (this unit's own
// pinned regression target — re-derived by actually running the walk
// against this implementation rather than copied from the amendment's
// mechanical projection on trust; see the comment over that constant for
// how the two compare). Given only those two external numbers, three
// things are checked against the record openFieldEntries() ACTUALLY
// produces for each case: the flattened field coverage matches the old
// baseline exactly (no field silently dropped or invented by the
// collapse), the row count matches the new pin exactly (the collapse
// didn't over- or under-merge), and the arithmetic tying the two — the
// drop equals the sum of (member count - 1) over every collapsed row —
// holds as its own explicit statement, not merely implied by the first
// two. `entries.length` is never asserted from a bare literal alone: it
// is always read alongside the members-minus-facts sum that predicts it.
//
// **AC-3** — the dialog, the chrome footer and Ready reconcile — is
// proven in the same describe block below, over the same five end-of-
// walk records. Rev 3 of the amendment (surfaced by this build) settles
// what that means for a fact whose members differ: NOT that the dialog's
// open count is the arithmetic complement of the footer's/Ready's
// buckets — a fact can be written and still open at once (a half-held
// RC-1 is both) — but that all three surfaces read the same facts
// through the same states. Proven against an independent bucketing
// oracle, not by cross-checking the three production functions against
// each other.
import { describe, expect, it } from "vitest";
import { GATE_CASES, scriptFor, type GateCase } from "../../fixtures/gate/cases";
import { seedFromNarrative, simulateCase } from "./gate-simulate";
import { ALL_FIELD_TYPES, validateCandidates } from "./extraction-validator";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { initTalkSession, type TalkSession } from "./talk";
import { nextStep, TOPICS } from "./topics";
import { factGroups, openFieldEntries } from "./open-fields";
import { recordFieldCounts } from "./report-chrome";
import { readyCounts } from "./ready";
import { stampReportDate } from "./report-date";
import { dispositionOf } from "./ask-inventory";
import { applyAction, initAgenda, type AgendaRecord } from "./agenda";

// Duplicated from gate-cases.test.ts's own module-private seedFor(),
// deliberately — topics.ts's own recorded policy (open-fields.ts's file
// header cites it too) is to duplicate a small predicate across
// boundaries "rather than hidden behind a shared helper a future edit
// could accidentally widen in both places at once," and this file's
// concern (a fixture pinning reconciliation arithmetic) is genuinely
// separate from gate-cases.test.ts's (the walk still matching its own
// script).
function seedFor(c: GateCase): TalkSession {
  if (!c.narrative) return initTalkSession();
  const stamped = c.narrative.candidates.map((candidate) => ({
    ...candidate,
    quote: { turnIndex: 0, text: candidate.quote },
  }));
  const { accepted } = validateCandidates(
    [{ role: "clinician", text: c.narrative.text }],
    stamped as never,
    FORM_3500_FIELDS,
    ALL_FIELD_TYPES,
  );
  return seedFromNarrative(c.narrative.text, accepted);
}

// C6 is C2's steps followed by a Start-over into C3 — not a walk of its
// own (gate-cases.test.ts's own WALK_CASES filter, repeated here for the
// same reason).
const PINNABLE_CASES = GATE_CASES.filter((c) => c.thenStartOver === undefined);

// Measured on `dev` `2e4d1b4`, before this unit — the OLD dialog, one row
// per FIELD. Pinned as history, not re-derived: the code that produced
// these numbers no longer exists after this unit lands, so nothing in
// this file can recompute them independently of trusting the record.
// What CAN be re-verified independently is that the new dialog's entries
// still cover exactly this many individual fields when flattened — the
// "flattened field coverage" assertion in the it.each below.
const PRE_CHANGE_BASELINE: Record<string, number> = {
  C1: 66,
  C2: 71,
  C3: 99,
  C4: 105,
  C5: 40,
};

// This unit's own pinned regression target — the number the sign-off
// dialog actually headlines once openFieldEntries() counts facts.
// Re-derived, not copied on trust: run through the real machinery
// (simulateCase over each case's own script, same as gate-cases.test.ts)
// against this unit's implementation, cross-checked by the reconciliation
// assertion below before being pinned. Every one of the five matches the
// amendment's own mechanical projection (ask-copy.md rule 8, #127)
// exactly, despite that projection's own disclaimer that it "does not
// model the factResolvesFromOne or companion-group clauses" — C3's two
// suspect-product instances and C5's dismissed race/product-type/
// contact-details facts (the cases most likely to expose a gap in the
// projection's arithmetic) land on the projected numbers once actually
// run, not merely close to them.
const POST_CHANGE_HEADLINE: Record<string, number> = {
  C1: 28,
  C2: 32,
  C3: 49,
  C4: 44,
  C5: 19,
};

// The end-of-walk session for a case, run once and shared by both AC-4
// (the headline) and AC-3 (its reconciliation with the footer and Ready)
// below — the same record either check reasons about, so both describe
// blocks read it through this one driver rather than two.
async function endOfWalk(c: GateCase) {
  const result = await simulateCase(c.steps as never, scriptFor(c), seedFor(c));
  expect(nextStep(result.session.record, result.session.repeatCounts).kind, c.id).toBe("done");
  const { record, repeatCounts } = result.session;
  return { record, repeatCounts, entries: openFieldEntries(record, repeatCounts) };
}

describe("AC-4: the open-fields headline reconciles across the unit change (#127)", () => {
  it("covers exactly the five cases the harness can drive, and says so", () => {
    expect(PINNABLE_CASES.map((c) => c.id)).toEqual(["C1", "C2", "C3", "C4", "C5"]);
  });

  it.each(PINNABLE_CASES.map((c) => [c.id, c] as const))(
    "%s: the drop from the pre-change headline equals the members-minus-facts arithmetic",
    async (id, c) => {
      const { entries } = await endOfWalk(c);

      // Every field the OLD, one-row-per-field dialog would have listed
      // is still represented somewhere in the new entries — flattened,
      // it is exactly the historical count. This is what proves the
      // collapse dropped no field and invented none: a bug that silently
      // excludes a field from a group's still-open subset (or excludes a
      // field's own row entirely) shows up here as a coverage shortfall,
      // not as "a plausible-looking wrong number" on the row count alone.
      const flattenedCoverage = entries.flatMap((e) => e.fieldIds).length;
      expect(flattenedCoverage, `${id} flattened field coverage`).toBe(PRE_CHANGE_BASELINE[id]);

      // The headline itself — what the dialog's h2 actually renders.
      expect(entries.length, `${id} headline row count`).toBe(POST_CHANGE_HEADLINE[id]);

      // The reconciliation: the drop equals the sum, over every row that
      // collapsed two or more fields, of (member count - 1) — the exact
      // "members minus facts" arithmetic ask-copy.md rule 8 states. Named
      // and asserted on its own rather than left implied by the two
      // checks above, so a future edit to either pinned table without
      // recomputing the other is caught by THIS assertion specifically.
      const membersMinusFacts = entries.reduce((sum, e) => sum + (e.fieldIds.length - 1), 0);
      const drop = PRE_CHANGE_BASELINE[id] - POST_CHANGE_HEADLINE[id];
      expect(drop, `${id} drop`).toBe(membersMinusFacts);

      // Every row is at least one field, and no field is claimed twice.
      const allFieldIds = entries.flatMap((e) => e.fieldIds);
      expect(new Set(allFieldIds).size, `${id} no field double-counted`).toBe(allFieldIds.length);
      for (const e of entries) expect(e.fieldIds.length, `${id} ${e.label}`).toBeGreaterThan(0);
    },
  );
});

// An independent re-implementation of the amendment's own bucket rule
// (docs/ask-copy.md rule 8, #127 rev 3) — deliberately NOT calling into
// readyCounts()/recordFieldCounts(), so a bug in either of those
// functions shows up as a mismatch against this oracle rather than a
// tautological restatement of whatever they happen to compute. Mirrors
// the amendment's own bullet order (written, then unknown, then
// declined): the amendment does not name a tie-break for a group with
// no answered member but BOTH an unknown and a declined one (not
// reached by any of the five cases, and not obviously reachable at all
// — a dismiss chip applies one action to a whole still-open set at
// once), so this reads its bullets in the order written and resolves
// that case to `unknown`.
function oracleBucket(states: Array<AgendaRecord[string]["state"]>): "written" | "unknown" | "declined" | "nowhere" {
  if (states.some((s) => s === "answered")) return "written";
  if (states.some((s) => s === "unknown")) return "unknown";
  if (states.some((s) => s === "declined")) return "declined";
  return "nowhere";
}

// The oracle's own bucket sums for a record — auto fields excluded per
// group exactly as recordFieldCounts()/readyCounts() exclude them, so
// the comparison isn't polluted by a disagreement this file isn't
// testing.
function oracleCounts(record: AgendaRecord) {
  const counts = { written: 0, unknown: 0, declined: 0 };
  for (const group of factGroups()) {
    const members = group.filter((id) => dispositionOf(id) !== "auto");
    if (members.length === 0) continue;
    const bucket = oracleBucket(members.map((id) => record[id]?.state ?? "unasked"));
    if (bucket !== "nowhere") counts[bucket]++;
  }
  return counts;
}

// AC-3: the dialog, the chrome footer and Ready reconcile — proven as a
// property over the five cases, not asserted for one example and
// generalized by hand. Rev 3 of the amendment (surfaced by this build)
// settles what "reconcile" means for a fact whose members differ: NOT
// that the dialog's open count is the arithmetic complement of the three
// buckets — a fact can be written and still open at once, so it isn't —
// but that all three surfaces read the same facts through the same
// states. Proven here by checking Ready's and the footer's own bucket
// sums against a bucketing oracle that reads the record directly (never
// calling the functions under test), for every fact in the manifest, not
// only the ones a hand-picked example would touch.
describe("AC-3: the dialog, the chrome footer and Ready reconcile (#127)", () => {
  const TODAY = new Date("2026-08-29");

  it.each(PINNABLE_CASES.map((c) => [c.id, c] as const))("%s", async (id, c) => {
    const { record, entries } = await endOfWalk(c);
    const stamped = stampReportDate(record, TODAY);
    const expected = oracleCounts(stamped);

    const ready = readyCounts(stamped);
    expect(ready, `${id} Ready reads the same facts through the same states`).toEqual({
      answered: expected.written,
      unknown: expected.unknown,
      declined: expected.declined,
    });

    // The footer merges `declined` into the same bucket as `unknown`
    // (report-chrome.ts's own documented two-way split, unchanged by
    // this unit) — checked against the SAME oracle sums, not against
    // Ready's own output, so a shared bug in both functions can't hide
    // behind the two agreeing with each other.
    const footer = recordFieldCounts(stamped);
    expect(footer, `${id} footer reads the same facts through the same states`).toEqual({
      written: expected.written,
      unknown: expected.unknown + expected.declined,
    });

    // Declined stays invisible to the dialog at fact granularity too —
    // unchanged by this unit, re-asserted here because it is the one
    // bucket this rule does NOT allow to double as a dialog row (rule 8's
    // own "declined... clinician-established states this dialog
    // respects and never nudges").
    const dialogFieldIds = new Set(entries.flatMap((e) => e.fieldIds));
    for (const group of factGroups()) {
      const members = group.filter((id) => dispositionOf(id) !== "auto");
      if (members.length === 0) continue;
      if (oracleBucket(members.map((fid) => stamped[fid]?.state ?? "unasked")) !== "declined") continue;
      for (const fieldId of members) {
        expect(dialogFieldIds.has(fieldId), `${id} ${fieldId} declined but listed on the dialog`).toBe(false);
      }
    }

    // And the auto exclusion actually holds for both: a stamped
    // ReportDate contributes to neither bucket in either surface, so
    // stamping the record before counting is a no-op on these numbers.
    // Real sessions only ever count the stamped record (ReportChrome.tsx,
    // Ready.tsx), so this is what makes counting the unstamped `record`
    // above a safe stand-in rather than a different number this test
    // happened not to notice.
    expect(readyCounts(record), `${id} unstamped vs stamped Ready`).toEqual(ready);
    expect(recordFieldCounts(record), `${id} unstamped vs stamped footer`).toEqual(footer);
  });

  // The consequence the amendment names explicitly, made concrete: a
  // partly-filled bulk fact (RC-1, one field held, the rest genuinely
  // still open) is BOTH written (Ready/the footer) AND still listed as
  // open (the dialog) — at once, for the exact same fact, in the exact
  // same record. Neither surface is wrong; this is the shape rev 3
  // exists to describe.
  it("a partially-filled bulk fact counts as written AND lists as open, at once", () => {
    const LAST_NAME = "Page7.SecG_Reporter.LastName";
    const OTHER_CONTACT_FIELDS = [
      "Page7.SecG_Reporter.FirstName",
      "Page7.SecG_Reporter.Address",
      "Page7.SecG_Reporter.City",
      "Page7.SecG_Reporter.State",
      "Page7.SecG_Reporter.ZipCode",
      "Page7.SecG_Reporter.PhoneNum",
      "Page7.SecG_Reporter.Email",
    ];
    let record = initAgenda();
    // Every OTHER reachable field resolved first (every topic, every
    // instance — readyCounts()/recordFieldCounts() have never filtered
    // by reachability, unchanged by this unit), so this record's counts
    // are driven entirely by the one fact under test.
    for (const topic of TOPICS) {
      for (const fieldId of topic.fieldIds) record = applyAction(record, fieldId, { type: "answer" }, "x");
    }
    record = applyAction(record, LAST_NAME, { type: "answer" }, "Ostrowski");
    for (const fieldId of OTHER_CONTACT_FIELDS) record = applyAction(record, fieldId, { type: "mark_unknown" });

    const entries = openFieldEntries(record, {});
    const openRow = entries.find((e) => e.fieldIds.includes(OTHER_CONTACT_FIELDS[0]));
    expect(openRow, "the dialog lists the still-open remainder").toBeDefined();
    expect(openRow!.fieldIds).toEqual(OTHER_CONTACT_FIELDS);
    expect(openRow!.reasonKind).toBe("unknown");
    expect(openRow!.label).toBe("the rest of your contact details");

    const stamped = stampReportDate(record, TODAY);
    // Every OTHER fact is fully answered (the setup loop above), so
    // every non-auto group should read as written — including RC-1's,
    // which is the only one that would NOT if the bug this test guards
    // against were present. `nonAutoGroupCount` excludes ReportDate's
    // own singleton group, the one group neither chrome function counts
    // at all.
    const nonAutoGroupCount = factGroups().filter((g) => g.some((fieldId) => dispositionOf(fieldId) !== "auto")).length;
    expect(readyCounts(stamped).answered, "RC-1 counts as written in Ready").toBe(nonAutoGroupCount);
    expect(recordFieldCounts(stamped).written, "RC-1 counts as written in the footer").toBe(nonAutoGroupCount);
  });
});
