// Eval runner for the narrative-extraction pass (Issue #41). Two modes,
// matching the charter's test floor split, but with a real difference from
// scripts/eval-extraction.ts's own dry/live split: dry mode here is not
// limited to structural/wiring checks. Each fixture carries its own
// scripted (fake-model) response, so dry mode runs that response through
// the real validator (src/lib/narrative-extract.ts's resolveNarrativeExtraction,
// the exact function a real model call also feeds) and asserts the full
// accepted/rejected/repeatDecisions sets — proving the safety-relevant
// behavior deterministically, no API key or network access required, matching
// docs/charter.md's v1.1 end condition ("a scripted end-to-end flow test...
// against a fake model").
//
//   npm run eval:narrative-dry   — no API calls, runs on every PR (ci.yml)
//   npm run eval:narrative       — live Sonnet 5 calls against wilson-evals,
//                                  workflow_dispatch only, skipping the two
//                                  adversarial fixtures (see cases.ts)
import Anthropic from "@anthropic-ai/sdk";
import {
  NARRATIVE_EXTRACTION_FIXTURES,
  type NarrativeExtractionFixture,
} from "../fixtures/narrative-extraction/cases";
import { createNarrativeExtractFn, resolveNarrativeExtraction } from "../src/lib/narrative-extract";
import { EXTRACTOR_MODEL } from "../src/prompts/extractor";
import { FORM_3500_FIELDS } from "../src/lib/form-3500-fields";
import { initAgenda, type AgendaRecord } from "../src/lib/agenda";
import { TOPICS, initRepeatCounts, narrativePassFields } from "../src/lib/topics";
import type { TalkTurn } from "../src/lib/talk";

const DRY = process.argv.includes("--dry");

// Same rates/ceiling reasoning as eval-extraction.ts — re-baseline against
// wilson-evals' own console numbers once real sweeps have run.
const INPUT_RATE_PER_MTOK = 3.0;
const OUTPUT_RATE_PER_MTOK = 15.0;
const CEILING_USD = 1.0;

function unknownFieldIds(ids: string[]): string[] {
  return ids.filter((id) => !FORM_3500_FIELDS.some((f) => f.id === id));
}

function setsMatch<T>(actual: T[], expected: T[], key: (item: T) => string): string | null {
  const actualKeys = actual.map(key).sort();
  const expectedKeys = expected.map(key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    return `expected [${expectedKeys.join(", ")}], got [${actualKeys.join(", ")}]`;
  }
  return null;
}

function dryCheckFixture(fixture: NarrativeExtractionFixture): string[] {
  const problems: string[] = [];

  const scriptedIds = fixture.scriptedCandidates.map((c) => c.fieldId);
  const expectedIds = [...fixture.expected.accepted, ...fixture.expected.rejected].map((e) => e.fieldId);
  for (const id of unknownFieldIds([...scriptedIds, ...expectedIds])) {
    problems.push(`references a field id not in the real manifest: ${id}`);
  }
  if (!fixture.narrative.trim()) {
    problems.push("narrative is empty");
  }

  // A blank starting record, matching the opening-narrative's real usage
  // (design.md: "No separate landing page; this is the landing") — the
  // same openFields a real createNarrativeExtractFn() call would compute.
  const openFields = narrativePassFields(initAgenda(), TOPICS, FORM_3500_FIELDS);
  const transcript: TalkTurn[] = [{ role: "clinician", text: fixture.narrative }];

  const result = resolveNarrativeExtraction(
    transcript,
    { candidates: fixture.scriptedCandidates, repeatDecisions: fixture.scriptedRepeatDecisions },
    openFields,
  );

  const acceptedMismatch = setsMatch(
    result.proposals.map((p) => p.action),
    fixture.expected.accepted,
    (a) => `${a.fieldId}:${a.type}:${a.type === "answer" ? a.value : ""}`,
  );
  if (acceptedMismatch) problems.push(`accepted mismatch — ${acceptedMismatch}`);

  const rejectedMismatch = setsMatch(
    result.rejected.map((r) => ({ fieldId: r.candidate.fieldId, reason: r.reason })),
    fixture.expected.rejected,
    (r) => `${r.fieldId}:${r.reason}`,
  );
  if (rejectedMismatch) problems.push(`rejected mismatch — ${rejectedMismatch}`);

  const repeatMismatch = setsMatch(
    result.repeatDecisions,
    fixture.expected.repeatDecisions,
    (d) => `${d.repeatGroup}:${d.count}`,
  );
  if (repeatMismatch) problems.push(`repeatDecisions mismatch — ${repeatMismatch}`);

  return problems;
}

function runDry(): void {
  let failures = 0;
  for (const fixture of NARRATIVE_EXTRACTION_FIXTURES) {
    const problems = dryCheckFixture(fixture);
    if (problems.length === 0) {
      console.log(`ok   ${fixture.id}`);
    } else {
      failures++;
      console.log(`FAIL ${fixture.id}`);
      for (const p of problems) console.log(`       ${p}`);
    }
  }
  console.log(
    `\n${NARRATIVE_EXTRACTION_FIXTURES.length - failures}/${NARRATIVE_EXTRACTION_FIXTURES.length} fixtures structurally valid and correctly resolved by the real validator`,
  );
  const liveCount = NARRATIVE_EXTRACTION_FIXTURES.filter((f) => !f.adversarial).length;
  console.log(
    `projected live-mode cost for one full sweep: well under $${CEILING_USD.toFixed(2)} (${liveCount} calls at this prompt size)`,
  );
  if (failures > 0) process.exit(1);
}

function looselyMatchesValue(actual: string, expected: string): boolean {
  const a = actual.toLowerCase();
  const e = expected.toLowerCase();
  return a.includes(e) || e.includes(a);
}

// A real model's exact wording/coverage isn't the safety property under
// test (extraction-validator.ts's grounding check is, proven API-free by
// runDry() above) — this only sense-checks that a live call roughly
// reproduces the fixture's expected coverage. Skips adversarial fixtures
// (see cases.ts) — there is nothing meaningful to compare a well-behaved
// live model's output against for those.
async function runLive(): Promise<void> {
  const client = new Anthropic();
  let totalCostUsd = 0;

  const originalParse = client.messages.parse.bind(client.messages);
  client.messages.parse = (async (...args: Parameters<typeof originalParse>) => {
    const response = await originalParse(...args);
    totalCostUsd +=
      (response.usage.input_tokens / 1_000_000) * INPUT_RATE_PER_MTOK +
      (response.usage.output_tokens / 1_000_000) * OUTPUT_RATE_PER_MTOK;
    return response;
  }) as typeof client.messages.parse;

  const extract = createNarrativeExtractFn(client);
  let failures = 0;
  const fixtures = NARRATIVE_EXTRACTION_FIXTURES.filter((f) => !f.adversarial);

  for (const fixture of fixtures) {
    if (totalCostUsd >= CEILING_USD) {
      console.log(`ceiling reached ($${CEILING_USD.toFixed(2)}) — stopping before ${fixture.id}`);
      failures++;
      continue;
    }

    const record: AgendaRecord = initAgenda();
    const costBefore = totalCostUsd;
    const result = await extract({ transcript: [], record, repeatCounts: initRepeatCounts() }, fixture.narrative);
    const thisCallCost = totalCostUsd - costBefore;

    const coverageOk = fixture.expected.accepted.every((expected) => {
      const match = result.proposals.find((p) => p.action.fieldId === expected.fieldId && p.action.type === expected.type);
      if (!match) return false;
      if (expected.type === "answer" && match.action.type === "answer") {
        return looselyMatchesValue(match.action.value, expected.value);
      }
      return true;
    });
    const repeatOk = fixture.expected.repeatDecisions.every((expected) =>
      result.repeatDecisions.some((d) => d.repeatGroup === expected.repeatGroup && d.count === expected.count),
    );

    if (coverageOk && repeatOk) {
      console.log(`ok   ${fixture.id} (+$${thisCallCost.toFixed(4)}, running total $${totalCostUsd.toFixed(4)})`);
    } else {
      failures++;
      console.log(`FAIL ${fixture.id}`);
      console.log(`       expected coverage: ${JSON.stringify(fixture.expected.accepted)}`);
      console.log(`       actual proposals:  ${JSON.stringify(result.proposals)}`);
    }
  }

  console.log(`\nmodel: ${EXTRACTOR_MODEL}`);
  console.log(`total cost this run: $${totalCostUsd.toFixed(4)} (ceiling $${CEILING_USD.toFixed(2)})`);
  console.log(`${fixtures.length - failures}/${fixtures.length} fixtures matched (adversarial fixtures skipped)`);
  if (failures > 0) process.exit(1);
}

if (DRY) {
  runDry();
} else {
  await runLive();
}
