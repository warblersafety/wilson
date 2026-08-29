// The charter's v1.1 end-condition flow test (Issue #45, the last
// rebuild unit — writable only now that every surface exists).
//
// The charter asks for "a scripted end-to-end flow test over the
// reference case against a fake model, which proves the STATE
// TRANSITIONS; surface shape (chip inventory, dialog-vs-page) is proven
// by the per-unit mockup side-by-sides the manual-check notes carry."
// So this runs at pure lib level — zero DOM, zero React — matching the
// repo's own convention (no .test.tsx exists anywhere; no jsdom or
// testing-library dependency is installed) and taking each surface
// through the exact functions its component calls.
//
// No new fixture: the reference case is NARRATIVE_EXTRACTION_FIXTURES'
// `amoxicillin-reference-case`, driven exactly as the eval's dry mode
// drives it, so this test and that eval cannot silently disagree about
// what the reference case is.
//
// "v1's field-mapping tests still green" is the existing pytest suite
// (scripts/tests/) plus form-3500-fields*.test.ts passing in the same CI
// run — not re-asserted here.
import { describe, expect, it } from "vitest";
import { anchorOf, dispositionOf, isListableGap } from "./ask-inventory";
import { isTopicGatedOff } from "./gates";
import { NARRATIVE_EXTRACTION_FIXTURES } from "../../fixtures/narrative-extraction/cases";
import { initAgenda } from "./agenda";
import { askDeterministic } from "./ask";
import { FORM_3500_FIELDS } from "./form-3500-fields";
import { resolveNarrativeExtraction } from "./narrative-extract";
import { openFieldEntries, summarizeOpenFields } from "./open-fields";
import { fetchReportPdf, type PdfFetch } from "./pdf-export";
import { confirmReadBack, groupProposalsByField, resolveConfirmReadiness } from "./read-back";
import { formatReadyCounts, readyCounts } from "./ready";
import { fieldDisplay, fieldIdsForReviewRow, reopenReviewRow, reviewRows } from "./review";
import type { ReadBackHandoff } from "./start-surface";
import {
  applyProposedActions,
  initTalkSession,
  processTurn,
  startTalk,
  type ExtractFn,
  type TalkSession,
} from "./talk";
import { narrativePassFields, nextStep, setRepeatCount, TOPICS } from "./topics";

const REFERENCE_CASE = NARRATIVE_EXTRACTION_FIXTURES.find((f) => f.id === "amoxicillin-reference-case")!;

const SUSPECT_2_NAME = "Page5.Prod2.Prod2Name";
const CONCOMITANT_2_PROD = "Page6.SecF_Other.Table1.Row2.Prod2";
const CONCOMITANT_3_PROD = "Page6.SecF_Other.Table1.Row3.Prod3";
const PROD_1_NAME = "Page4.Prod1.Prod1Name";

// --- surface 1: Start -----------------------------------------------------

// Exactly what StartSurface's submit path produces, minus the Server
// Action wrapper: the fixture's hand-scripted response stands in for the
// model call, and the REAL validator decides what it grounds.
function runNarrativePass(): ReadBackHandoff {
  const session = initTalkSession();
  const result = resolveNarrativeExtraction(
    [{ role: "clinician", text: REFERENCE_CASE.narrative }],
    { candidates: REFERENCE_CASE.scriptedCandidates, repeatDecisions: REFERENCE_CASE.scriptedRepeatDecisions },
    narrativePassFields(session.record),
  );
  return { session, narrative: REFERENCE_CASE.narrative, result };
}

// --- surfaces 3: Follow-ups ------------------------------------------------

// The fake model for the follow-up loop: a hand-written ExtractFn, the
// literal-function pattern talk.test.ts and direct-step.test.ts already
// use (this repo mocks nothing). It alternates "I don't have that" and
// "rather not say" across each ask's fields — legitimate because
// isResolved() counts `unknown` and `declined`, so the walk really does
// reach "done", and useful because it manufactures every state the
// closing surfaces have to handle rather than a record of uniform
// answers.
function alternatingDismissals(turnIndex: number): ExtractFn {
  return async (session) => {
    const step = nextStep(session.record, session.repeatCounts);
    if (step.kind !== "topic") return { actions: [] };
    return {
      // step.fieldIds is exactly what the visible question named — the
      // ask's own unresolved askFieldIds (topics.ts) — so there is
      // nothing to cap. Writing past it would resolve fields the
      // clinician was never asked about (chip-grammar.ts's
      // dismissableFieldIds() records why that used to be possible).
      // Alternating by the field's index WITHIN its ask, not by turn
      // index: turn parity made the whole fixture depend on how many
      // turns the walk happens to take, so adding rule 5's gates (six
      // fewer asks) silently flipped which fields ended up `unknown` and
      // broke an assertion about a state nothing in this test controls.
      // Per-ask indexing gives every ask's first field `unknown` and the
      // rest `declined`, whatever the walk's length.
      actions: step.fieldIds
        .map((fieldId, i) => ({
          fieldId,
          type: i % 2 === 0 ? ("mark_unknown" as const) : ("decline" as const),
        })),
    };
  };
}

// Drives the loop to "done", answering the two repeat decisions through
// setRepeatCount() — the exact path RepeatDecision.tsx's chips take.
// suspect-product: "No" (count 1), so slots 2+ are decided away.
// concomitant-medication: 2, so instance 2 is CONFIRMED and asked while
// slots 3–10 are decided away. That combination is what makes step 6
// below able to tell the two cases apart.
async function driveToDone(session: TalkSession): Promise<TalkSession> {
  let current = session;
  let turn = 0;
  // Bounded so a machinery regression fails as a test failure rather
  // than a hung suite: 34 topics is the real ceiling, doubled for slack.
  const MAX_TURNS = 200;
  for (; turn < MAX_TURNS; turn++) {
    const step = nextStep(current.record, current.repeatCounts);
    if (step.kind === "done") return current;
    if (step.kind === "repeat-decision") {
      const count = step.repeatGroup === "suspect-product" ? 1 : 2;
      current = { ...current, repeatCounts: setRepeatCount(current.repeatCounts, step.repeatGroup, count) };
      continue;
    }
    const result = await processTurn(current, `turn ${turn}`, {
      ask: askDeterministic,
      extract: alternatingDismissals(turn),
    });
    current = result.session;
  }
  throw new Error(`the follow-up loop did not reach "done" within ${MAX_TURNS} turns`);
}

describe("v1.1 end condition: the reference case through all six surfaces", () => {
  it("carries the amoxicillin case from narrative to exported PDF", async () => {
    // --- 1. Start → Read-back: nothing written before confirmation ------
    const handoff = runNarrativePass();
    expect(handoff.result.proposals.length).toBe(REFERENCE_CASE.expected.accepted.length);
    // The charter's literal "nothing written to the record before
    // confirmation (test-asserted)".
    expect(handoff.session.record).toEqual(initAgenda());

    // --- 2. Read-back → confirm: now, and only now, the record is written
    const groups = groupProposalsByField(handoff.result.proposals);
    const readiness = resolveConfirmReadiness(groups, new Map());
    expect(readiness.ready).toBe(true);
    if (!readiness.ready) throw new Error("expected the reference case to need no collision choices");
    const confirmed = confirmReadBack(handoff, readiness.actions);
    for (const action of REFERENCE_CASE.expected.accepted) {
      expect(confirmed.record[action.fieldId].state).toBe("answered");
    }
    expect(confirmed.record[PROD_1_NAME].value).toBe("amoxicillin");

    // --- 3. Hand off to Follow-ups, exactly as IntakeFlow does ----------
    const started = await startTalk(confirmed, { ask: askDeterministic });
    expect(started.session.transcript.at(-1)?.role).toBe("talker");

    // --- 4. Scripted follow-ups to "done" ------------------------------
    const done = await driveToDone(started.session);
    expect(nextStep(done.record, done.repeatCounts).kind).toBe("done");
    expect(done.repeatCounts).toEqual({ "suspect-product": 1, "concomitant-medication": 2 });
    // The narrative's answers survived the whole loop untouched —
    // design.md's "every other topic stays protected".
    expect(done.record[PROD_1_NAME]).toEqual({ state: "answered", value: "amoxicillin" });
    // A confirmed instance 2 really was asked; a decided-away slot never was.
    expect(done.record[CONCOMITANT_2_PROD].state).not.toBe("unasked");
    expect(done.record[CONCOMITANT_3_PROD].state).toBe("unasked");
    expect(done.record[SUSPECT_2_NAME].state).toBe("unasked");

    // --- 5. Review: full A–G cards over the reachable field set ---------
    const rows = reviewRows(done.repeatCounts);
    expect(new Set(rows.map((r) => r.section))).toEqual(new Set(["A", "B", "C", "D", "E", "F", "G"]));
    expect(fieldDisplay(done.record, PROD_1_NAME)).toEqual({
      text: "amoxicillin",
      muted: false,
      retained: false,
    });
    const medsRow = rows.find((r) => r.id === "concomitant-meds")!;
    const medsFields = fieldIdsForReviewRow(medsRow, done.repeatCounts);
    expect(medsFields).toContain(CONCOMITANT_2_PROD);
    expect(medsFields).not.toContain(CONCOMITANT_3_PROD);

    // --- 6. Open fields: unknowns, including inside confirmed instance 2
    const entries = openFieldEntries(done.record, done.repeatCounts);
    // Flattened: one row can now cover several field ids (ask-copy.md
    // rule 8, #127), so the field-level assertions below — and the
    // exact-set comparison against expectedOpenIds further down — work
    // over every individual field a row represents, not one per row.
    const openIds = entries.flatMap((e) => e.fieldIds);
    expect(entries.length).toBeGreaterThan(0);
    // At "done" every ASK field is resolved — that is what done means —
    // so an `unknown` entry is a fact the clinician was asked for and
    // didn't have. A `not-asked` entry is a derive companion whose anchor
    // this run answered (ask-copy.md rule 3) — never an auto or
    // write-target field, and never a companion with nothing answered
    // behind it.
    for (const entry of entries) {
      for (const fieldId of entry.fieldIds) {
        const disposition = dispositionOf(fieldId);
        expect(["ask", "derive"], fieldId).toContain(disposition);
        if (disposition === "derive") {
          const anchorId = anchorOf(fieldId);
          expect(anchorId, `${fieldId} is listed with no anchor`).toBeDefined();
          expect(done.record[anchorId!].state, fieldId).toBe("answered");
        }
        if (entry.reasonKind === "unknown") expect(done.record[fieldId].state).toBe("unknown");
      }
    }
    expect(entries.some((e) => e.reasonKind === "unknown")).toBe(true);
    // The record-wide-unknowns branch that motivates open-fields.ts: a
    // CONFIRMED second medication's unknown field must be listed, even
    // though the follow-up sweep's own instance-1 scoping would hide it.
    const unknownInInstance2 = TOPICS.filter((t) => t.repeatInstance === 2 && t.repeatGroup === "concomitant-medication")
      .flatMap((t) => t.fieldIds)
      .filter((id) => done.record[id].state === "unknown");
    expect(unknownInInstance2.length).toBeGreaterThan(0);
    for (const id of unknownInInstance2) expect(openIds).toContain(id);
    // Skipped slots are excluded outright — they were DECIDED away, not
    // left unasked, so "not asked yet" would be a false reason.
    const skippedIds = TOPICS.filter(
      (t) =>
        (t.repeatGroup === "suspect-product" && (t.repeatInstance ?? 1) > 1) ||
        (t.repeatGroup === "concomitant-medication" && (t.repeatInstance ?? 1) > 2),
    ).flatMap((t) => t.fieldIds);
    expect(skippedIds.length).toBeGreaterThan(0);
    for (const id of skippedIds) expect(openIds).not.toContain(id);
    // And clinician-established states are never nudged.
    for (const id of openIds) expect(["answered", "declined"]).not.toContain(done.record[id].state);
    // Completeness, not just the edges: the assertions above are all
    // inclusion/exclusion tests, and a regression that dropped a whole
    // class of reachable topics from the walk (section E, say, which no
    // other test in this unit lists as open) would pass every one of them
    // (reviewer pass, PR #78, finding 4). This derives the expected set
    // independently — straight from TOPICS and the record — and pins the
    // list exactly, order included.
    const expectedOpenIds = TOPICS.filter(
      (t) =>
        t.repeatInstance === null ||
        t.repeatInstance <= (done.repeatCounts[t.repeatGroup!] ?? 1),
    )
      // ...and minus rule 5's gated-off topics, which are out of the
      // report entirely for this case: an antibiotic rash is no device,
      // no product problem, and no OTC/compounded/cannabinoid/cosmetic
      // type, so Section E, availability and purchase are not gaps —
      // they are not part of this report.
      .filter((t) => !isTopicGatedOff(t.id, done.record))
      .flatMap((t) => t.fieldIds)
      .filter((id) => done.record[id].state === "unknown" || done.record[id].state === "unasked")
      // ...minus the fields ask-copy.md's dispositions say are not gaps at
      // all: ReportDate (auto, stamped at export), the lab rows past LD-1's
      // own anchor (write-targets — "an empty row 4 is never a phantom gap
      // in open-fields or the counts"), and the date of death, whose ask
      // does not apply with no death recorded.
      .filter((id) => isListableGap(id, done.record));
    // Unordered as of ask-copy.md rule 8 (#127): a collapsed row's
    // fieldIds walk topic.fieldIds order (open-fields.ts), but a
    // multi-field fact is not always CONTIGUOUS there — SP-6's ExpDate
    // sits between two of "product type"'s own checkbox members
    // (Prod1CosmProf, Prod1Brand) — so the group's one row necessarily
    // pulls its members together ahead of (or behind) an interleaved
    // sibling's own row, which the strict per-field order this used to
    // assert can no longer hold across a collapse. The SET is still
    // exact, which is what this assertion exists to prove: no field
    // dropped, none invented.
    expect([...openIds].sort()).toEqual([...expectedOpenIds].sort());
    // The nudge never gates.
    const summary = summarizeOpenFields(done.record, done.repeatCounts);
    expect(summary.entries.length).toBeGreaterThan(0);
    expect(summary.canFinishAsIs).toBe(true);

    // --- 7. Ready: three real buckets, skipped slots in none of them ----
    const counts = readyCounts(done.record);
    expect(counts.answered).toBeGreaterThan(0);
    expect(counts.unknown).toBeGreaterThan(0);
    expect(counts.declined).toBeGreaterThan(0);
    expect(counts.answered + counts.unknown + counts.declined).toBeLessThan(FORM_3500_FIELDS.length);
    expect(formatReadyCounts(counts)).toBe(
      `${counts.answered} written · ${counts.unknown} unknown · ${counts.declined} declined`,
    );
    // Every skipped-slot field is `unasked`, and readyCounts() puts
    // `unasked` in no bucket — so the totals above exclude them.
    for (const id of skippedIds) expect(done.record[id].state).toBe("unasked");

    // --- 8. Export ------------------------------------------------------
    const bytes = new TextEncoder().encode("%PDF-1.4 fake").buffer;
    const fakeFetch: PdfFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => bytes });
    await expect(fetchReportPdf(done.record, fakeFetch)).resolves.toBe(bytes);
  });

  it("reopens a Review card as a normal re-ask, retaining prior values, and re-derives done", async () => {
    // AC-1's edit path and design.md's "reopen never wipes... the flow
    // returns to Review with the changes visible".
    const handoff = runNarrativePass();
    const groups = groupProposalsByField(handoff.result.proposals);
    const readiness = resolveConfirmReadiness(groups, new Map());
    if (!readiness.ready) throw new Error("expected no collision choices");
    const started = await startTalk(confirmReadBack(handoff, readiness.actions), { ask: askDeterministic });
    const done = await driveToDone(started.session);

    const productRow = reviewRows(done.repeatCounts).find((r) => r.id === "suspect-product-1")!;
    const reopenedRecord = reopenReviewRow(done.record, productRow, done.repeatCounts);

    expect(reopenedRecord[PROD_1_NAME].state).toBe("unasked");
    expect(reopenedRecord[PROD_1_NAME].value).toBe("amoxicillin");
    expect(fieldDisplay(reopenedRecord, PROD_1_NAME)).toEqual({
      text: "amoxicillin",
      muted: false,
      retained: true,
    });
    // Reopening puts the flow back in the ordinary loop, at that topic.
    const reopenedSession: TalkSession = { ...done, record: reopenedRecord };
    const step = nextStep(reopenedSession.record, reopenedSession.repeatCounts);
    expect(step.kind).toBe("topic");
    if (step.kind !== "topic") throw new Error("expected a topic step");
    expect(step.topic.id).toBe("suspect-product-1-identity");

    // Answering it again re-derives "done" — no dead end.
    const reanswered = await driveToDone(reopenedSession);
    expect(nextStep(reanswered.record, reanswered.repeatCounts).kind).toBe("done");
  });

  it("writes nothing to the record if the read-back is never confirmed", () => {
    // The gate is structural, not a UI convention: the write only ever
    // happens inside confirmReadBack()/applyProposedActions().
    const handoff = runNarrativePass();
    expect(handoff.session.record).toEqual(initAgenda());
    const applied = applyProposedActions(handoff.session.record, []);
    expect(applied).toEqual(initAgenda());
  });
});
