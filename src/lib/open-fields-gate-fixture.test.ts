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
// walk records: every field the dialog lists `unknown` is exactly the
// set the footer's and Ready's own `unknown` bucket count, so a field
// cannot go missing from one surface while still showing on another.
import { describe, expect, it } from "vitest";
import { GATE_CASES, scriptFor, type GateCase } from "../../fixtures/gate/cases";
import { seedFromNarrative, simulateCase } from "./gate-simulate";
import { ALL_FIELD_TYPES, validateCandidates } from "./extraction-validator";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { initTalkSession, type TalkSession } from "./talk";
import { nextStep } from "./topics";
import { openFieldEntries } from "./open-fields";
import { recordFieldCounts } from "./report-chrome";
import { readyCounts } from "./ready";
import { stampReportDate } from "./report-date";

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

// AC-3: the dialog, the chrome footer and Ready reconcile — proven as a
// property over the five cases, not asserted for one example and
// generalized by hand. "Reconcile" is scoped deliberately to the
// `unknown` bucket: it is the one state a field can only reach by being
// individually asked and dismissed (never "silently unasked" the way
// `not-asked`/unreached fields are, so it carries no reachability
// ambiguity to sort out first), and it is exactly the bucket the footer
// and Ready both name in their own written/unknown(/declined) lines —
// the property this rule's own reconciliation paragraph is about. Every
// field the dialog lists with reason "you didn't have it" is exactly the
// set the footer's and Ready's own `unknown` bucket count: no field is
// visible as an open gap on one surface while invisible on the other.
describe("AC-3: the dialog, the chrome footer and Ready reconcile (#127)", () => {
  const TODAY = new Date("2026-08-29");

  it.each(PINNABLE_CASES.map((c) => [c.id, c] as const))("%s", async (id, c) => {
    const { record, entries } = await endOfWalk(c);
    const stamped = stampReportDate(record, TODAY);

    // The dialog's own `unknown`-reason rows, flattened to the fields
    // they represent — the set both chrome surfaces must agree with.
    const dialogUnknownFieldIds = entries.filter((e) => e.reasonKind === "unknown").flatMap((e) => e.fieldIds);

    const ready = readyCounts(stamped);
    expect(ready.unknown, `${id} Ready's unknown bucket`).toBe(dialogUnknownFieldIds.length);

    // The footer merges `declined` into the same bucket as `unknown`
    // (report-chrome.ts's own documented two-way split, unchanged by
    // this unit) — so its own `unknown` count is the dialog's unknown
    // rows PLUS however many fields Ready counts as declined, never a
    // number invented independently of Ready's own split.
    const footer = recordFieldCounts(stamped);
    expect(footer.unknown, `${id} footer's unknown bucket`).toBe(dialogUnknownFieldIds.length + ready.declined);

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
});
