// Eval runner for the real Extractor (Issue #22). Two modes, matching the
// charter's test floor split (docs/charter.md, "Any model-touching eval
// suites get a free 'dry' structural check... with live sweeps as a
// separately-triggered job — same split lucy uses"):
//
//   npm run eval:dry         — no API calls, runs on every PR (ci.yml)
//   npm run eval:extraction  — live Sonnet 5 calls against wilson-evals,
//                              workflow_dispatch only (eval-extraction.yml)
//
// This is a coverage/wiring sweep, not a statistical precision/recall
// harness — the charter's own review-depth conclusion doesn't ask for one,
// and the real safety property is enforced deterministically by
// src/lib/extraction-validator.ts regardless of what this script measures.
// A live-mode comparison only checks that each expected field got SOME
// accepted action of the right kind (loose value match for "answer"), and
// that an expected repeatDecision was produced — not exact wording.
import Anthropic from "@anthropic-ai/sdk";
import { EXTRACTION_FIXTURES, type ExtractionFixture } from "../fixtures/extraction/cases";
import { createExtractFn } from "../src/lib/extract";
import { EXTRACTOR_MODEL, buildFollowUpUserContent } from "../src/prompts/extractor";
import { FORM_3500_FIELDS } from "../src/lib/form-3500-fields";
import { nextStep, openFollowUpFields } from "../src/lib/topics";

const DRY = process.argv.includes("--dry");

// Sonnet 5 rates per the account's claude-api skill reference (cached
// 2026-06-24): $3.00/$15.00 per 1M input/output tokens. A corpus-size
// guard, not a precise monthly forecast — re-baseline against
// wilson-evals' own console numbers once real sweeps have run, same
// caveat lucy's SECRETS-AND-COSTS.md carries for its own estimates.
const INPUT_RATE_PER_MTOK = 3.0;
const OUTPUT_RATE_PER_MTOK = 15.0;
const CEILING_USD = 1.0;

function dryCheckFixture(fixture: ExtractionFixture): string[] {
  const problems: string[] = [];
  const transcript = [...fixture.transcript, { role: "clinician" as const, text: fixture.message }];

  let step;
  try {
    step = nextStep(fixture.record, fixture.repeatCounts, undefined, FORM_3500_FIELDS);
  } catch (err) {
    return [`nextStep() threw: ${(err as Error).message}`];
  }

  if (step.kind === "done") {
    problems.push("nextStep() resolved to 'done' — fixture's prior state leaves nothing open to extract");
  }

  for (const action of fixture.expected.actions) {
    if (!FORM_3500_FIELDS.some((f) => f.id === action.fieldId)) {
      problems.push(`expected action targets unknown field id: ${action.fieldId}`);
    }
    if (step.kind === "topic" && !step.fieldIds.includes(action.fieldId)) {
      problems.push(`expected action's field (${action.fieldId}) is not in the open step's fieldIds`);
    }
  }

  if (fixture.expected.repeatDecision) {
    if (step.kind !== "repeat-decision") {
      problems.push(
        `fixture expects a repeatDecision but nextStep() resolved to kind "${step.kind}", not "repeat-decision"`,
      );
    } else if (step.repeatGroup !== fixture.expected.repeatDecision.repeatGroup) {
      problems.push(
        `fixture's expected repeatGroup (${fixture.expected.repeatDecision.repeatGroup}) doesn't match the open step's (${step.repeatGroup})`,
      );
    }
  }

  try {
    // buildFollowUpUserContent, the builder createExtractFn() actually
    // calls — not the narrow one this check used to use, which had been
    // off the production path since Issue #44 widened the sweep and so
    // validated every fixture against a prompt no live run has sent in
    // weeks (found while building #90 part 2). Same arguments extract.ts
    // passes: the ask's own unresolved fields, and the widened open set.
    const askFieldIds = step.kind === "topic" ? step.fieldIds : [];
    const openFields = openFollowUpFields(fixture.record);
    const content = buildFollowUpUserContent(step, askFieldIds, openFields, transcript);
    if (!content.includes(fixture.message)) {
      problems.push("built prompt content doesn't include the fixture's clinician message");
    }
    for (const action of fixture.expected.actions) {
      // content.includes alone: every openFields id is rendered into the
      // prompt's open block, so an extra membership check would be
      // unreachable (reviewer pass, PR #106).
      if (!content.includes(action.fieldId)) {
        problems.push(`expected action's field (${action.fieldId}) is named nowhere in the built prompt`);
      }
    }
  } catch (err) {
    problems.push(`buildFollowUpUserContent() threw: ${(err as Error).message}`);
  }

  return problems;
}

function runDry(): void {
  let failures = 0;
  for (const fixture of EXTRACTION_FIXTURES) {
    const problems = dryCheckFixture(fixture);
    if (problems.length === 0) {
      console.log(`ok   ${fixture.id}`);
    } else {
      failures++;
      console.log(`FAIL ${fixture.id}`);
      for (const p of problems) console.log(`       ${p}`);
    }
  }
  console.log(`\n${EXTRACTION_FIXTURES.length - failures}/${EXTRACTION_FIXTURES.length} fixtures structurally valid`);
  console.log(`projected live-mode cost for one full sweep: well under $${CEILING_USD.toFixed(2)} (${EXTRACTION_FIXTURES.length} calls at this prompt size)`);
  if (failures > 0) process.exit(1);
}

function looselyMatches(actual: ExtractionFixture["expected"]["actions"], fixture: ExtractionFixture): boolean {
  return fixture.expected.actions.every((expected) => {
    const match = actual.find((a) => a.fieldId === expected.fieldId && a.type === expected.type);
    if (!match) return false;
    if (expected.type === "answer" && match.type === "answer") {
      // A live model's exact wording isn't the safety property under test
      // (extraction-validator.ts's grounding check is) — this is a loose
      // coverage check, not exact-match. Substring in either direction
      // covers both a terser model answer ("42" for expected "42 years
      // old") and a more verbose one, without being fooled by a match on
      // just the expected value's first word.
      const actualValue = match.value.toLowerCase();
      const expectedValue = expected.value.toLowerCase();
      return actualValue.includes(expectedValue) || expectedValue.includes(actualValue);
    }
    return true;
  });
}

async function runLive(): Promise<void> {
  const client = new Anthropic();
  let totalCostUsd = 0;

  // Cost tracking wraps the instance method directly — the same technique
  // vi.spyOn uses in src/lib/extract.test.ts, just without a test
  // framework driving it, since this is a manually-triggered script, not
  // shipped/production code. Wrapped once, outside the loop: wrapping
  // fresh on every fixture would bind to the previous iteration's
  // already-wrapped parse, double-billing every call after the first.
  const originalParse = client.messages.parse.bind(client.messages);
  client.messages.parse = (async (...args: Parameters<typeof originalParse>) => {
    const response = await originalParse(...args);
    totalCostUsd +=
      (response.usage.input_tokens / 1_000_000) * INPUT_RATE_PER_MTOK +
      (response.usage.output_tokens / 1_000_000) * OUTPUT_RATE_PER_MTOK;
    return response;
  }) as typeof client.messages.parse;

  const extract = createExtractFn(client);
  let failures = 0;

  for (const fixture of EXTRACTION_FIXTURES) {
    if (totalCostUsd >= CEILING_USD) {
      console.log(`ceiling reached ($${CEILING_USD.toFixed(2)}) — stopping before ${fixture.id}`);
      failures++;
      continue;
    }

    const costBefore = totalCostUsd;
    const session = { transcript: fixture.transcript, record: fixture.record, repeatCounts: fixture.repeatCounts };
    const result = await extract(session, fixture.message);
    const thisCallCost = totalCostUsd - costBefore;

    const actionsOk = looselyMatches(result.actions, fixture);
    const repeatOk = fixture.expected.repeatDecision
      ? JSON.stringify(result.repeatDecision) === JSON.stringify(fixture.expected.repeatDecision)
      : true;

    if (actionsOk && repeatOk) {
      console.log(`ok   ${fixture.id} (+$${thisCallCost.toFixed(4)}, running total $${totalCostUsd.toFixed(4)})`);
    } else {
      failures++;
      console.log(`FAIL ${fixture.id}`);
      console.log(`       expected: ${JSON.stringify(fixture.expected)}`);
      console.log(`       actual:   ${JSON.stringify(result)}`);
    }
  }

  console.log(`\nmodel: ${EXTRACTOR_MODEL}`);
  console.log(`total cost this run: $${totalCostUsd.toFixed(4)} (ceiling $${CEILING_USD.toFixed(2)})`);
  console.log(`${EXTRACTION_FIXTURES.length - failures}/${EXTRACTION_FIXTURES.length} fixtures matched`);
  if (failures > 0) process.exit(1);
}

if (DRY) {
  runDry();
} else {
  await runLive();
}
