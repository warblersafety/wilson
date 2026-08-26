// Cost proof for Issue #44's widened per-turn follow-up sweep (design.md
// "Cost posture": "the implementing unit's proof includes a measured
// cached-vs-uncached per-turn cost against the narrow-scope baseline —
// above roughly twice the cached narrow baseline, the widening returns to
// Steve for re-decision before the unit merges"). Builds the SAME
// mid-session fixture's prompt in both shapes — the narrow, pre-widening,
// ask-scoped prompt (EXTRACTOR_SYSTEM/buildExtractionUserContent, kept
// byte-for-byte unchanged by this unit) and the wide prompt
// (buildFollowUpExtractorSystem/buildFollowUpUserContent) — and calls
// each real Sonnet 5 twice in a row, so the SECOND call of each shape
// shows the cached price once the invariant system prompt has actually
// been written to cache once.
//
//   npm run cost:widened  — workflow_dispatch only (eval-extraction.yml,
//                           mode: cost), never locally: this makes real,
//                           billed API calls and this dev machine is
//                           keyless by design (docs/SECRETS-AND-COSTS.md).
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { applyAction, initAgenda, type AgendaRecord } from "../src/lib/agenda";
import { MAX_FIELDS_PER_ASK } from "../src/lib/ask";
import { FORM_3500_FIELDS } from "../src/lib/form-3500-fields";
import { TOPICS, initRepeatCounts, nextStep, openFollowUpFields } from "../src/lib/topics";
import type { TalkTurn } from "../src/lib/talk";
import {
  EXTRACTION_RESPONSE_SCHEMA,
  EXTRACTOR_MODEL,
  EXTRACTOR_SYSTEM,
  buildExtractionUserContent,
  buildFollowUpExtractorSystem,
  buildFollowUpUserContent,
} from "../src/prompts/extractor";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    [
      "cost:widened requires ANTHROPIC_API_KEY.",
      "",
      "This script makes real, billed Sonnet 5 calls (four of them: narrow x2,",
      "wide x2) to measure the widened follow-up sweep's cost against its",
      "pre-widening baseline. It's meant to run only via GitHub Actions",
      "(eval-extraction.yml, workflow_dispatch, mode: cost) against the",
      "wilson-evals workspace — never on a local dev machine, which is",
      "keyless by design. See docs/SECRETS-AND-COSTS.md.",
    ].join("\n"),
  );
  process.exit(1);
}

// Same rates as scripts/eval-extraction.ts / eval-narrative-extraction.ts
// (the account's claude-api skill reference, cached 2026-06-24) — kept
// identical rather than re-derived, so a rate change only needs updating
// in one place's worth of copies, not a second independently-chosen one.
const INPUT_RATE_PER_MTOK = 3.0;
const OUTPUT_RATE_PER_MTOK = 15.0;
// Prompt-caching economics (claude-api skill, shared/prompt-caching.md):
// a cache WRITE costs ~1.25x the base input rate; a cache READ costs
// ~0.1x. scripts/eval-extraction.ts's own cost tracking omits these
// (harmless there — EXTRACTOR_SYSTEM alone is well under Sonnet 5's
// 1024-token cacheable minimum, so cache tokens are always 0 in that
// script) but this script's whole point is to measure cache behavior, so
// leaving them out here would silently under-report the wide shape's
// real first-call cost and over-report its cached second-call savings.
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

function declineAll(record: AgendaRecord, fieldIds: string[]): AgendaRecord {
  return fieldIds.reduce((rec, id) => applyAction(rec, id, { type: "decline" }), record);
}

// A representative mid-session snapshot — seven topics' worth of fields
// already resolved, currently on suspect-product-1-identity — chosen to
// be a plausible real turn rather than an empty-record best case that
// would understate the manifest's actual rendered size (and therefore
// understate what the widened prompt's cacheable prefix really costs to
// write).
function midSessionFixture(): { record: AgendaRecord; transcript: TalkTurn[]; message: string } {
  // Every topic BEFORE suspect-product-1-identity in topics.ts's own
  // array order, not just the first three — leaving any of them open
  // left `nextStep()` landing earlier (event-medical-history, a
  // single-field topic) than this fixture's own transcript/message ever
  // claimed to be answering (found by review on PR #64: the cost job was
  // silently measuring the wrong turn). The assertion below turns that
  // same class of drift into a thrown error instead of a silent
  // mismeasurement the next time topics.ts's order changes.
  const doneTopicIds = [
    "patient-basics",
    "event-what-happened",
    "event-outcome",
    "event-medical-history",
    "event-lab-data",
    "event-additional-comments",
    "product-availability",
  ];
  let record = initAgenda();
  for (const topicId of doneTopicIds) {
    const topic = TOPICS.find((t) => t.id === topicId)!;
    record = declineAll(record, topic.fieldIds);
  }

  const step = nextStep(record, initRepeatCounts());
  if (step.kind !== "topic" || step.topic.id !== "suspect-product-1-identity") {
    throw new Error(
      `cost-widened-turn: fixture drift — expected doneTopicIds to leave nextStep() on ` +
        `"suspect-product-1-identity", but got ${step.kind === "topic" ? step.topic.id : step.kind}. ` +
        "Update doneTopicIds above (and this fixture's transcript/message) to match the current topic map.",
    );
  }

  // suspect-product-1-identity's real ask, per askDeterministic() and its
  // own MAX_FIELDS_PER_ASK cap: only the first 3 of its 6 fields (name,
  // strength, unit) are actually phrased — manufacturer (field 5) is
  // deliberately left for the clinician to volunteer, exercising the
  // widened sweep's own out-of-ask pickup, same as in a real session.
  const transcript: TalkTurn[] = [{ role: "talker", text: "What's the product name, the strength, and the unit?" }];
  const message = "Amoxicillin 875 mg, made by a generic manufacturer we don't have on file.";
  return { record, transcript, message };
}

interface CallMeasurement {
  label: string;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costUsd: number;
}

function costOf(usage: {
  input_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens: number;
}): number {
  const cacheCreation = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  return (
    (usage.input_tokens / 1_000_000) * INPUT_RATE_PER_MTOK +
    (cacheCreation / 1_000_000) * INPUT_RATE_PER_MTOK * CACHE_WRITE_MULTIPLIER +
    (cacheRead / 1_000_000) * INPUT_RATE_PER_MTOK * CACHE_READ_MULTIPLIER +
    (usage.output_tokens / 1_000_000) * OUTPUT_RATE_PER_MTOK
  );
}

// Calls the real API twice in a row with the SAME system/user content —
// the first call writes the cache (cache_creation_input_tokens > 0,
// input_tokens carries the rest), the second reads it
// (cache_read_input_tokens > 0). Uses the real structured-output shape
// (client.messages.parse against the real response schema), matching
// src/lib/extract.ts's actual production call exactly rather than a
// lighter-weight .create() that would understate real cost.
async function measureTwice(client: Anthropic, label: string, system: string, userContent: string): Promise<CallMeasurement[]> {
  const results: CallMeasurement[] = [];
  for (let i = 0; i < 2; i++) {
    const response = await client.messages.parse({
      model: EXTRACTOR_MODEL,
      max_tokens: 1024,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(EXTRACTION_RESPONSE_SCHEMA) },
    });
    const usage = response.usage;
    results.push({
      label: `${label} (call ${i + 1}, ${i === 0 ? "expect uncached" : "expect cached"})`,
      inputTokens: usage.input_tokens,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      outputTokens: usage.output_tokens,
      costUsd: costOf(usage),
    });
  }
  return results;
}

function printTable(rows: CallMeasurement[]): void {
  const columns = ["shape / call", "input", "cache write", "cache read", "output", "cost (USD)"];
  console.log(columns.map((c) => c.padEnd(30)).join(""));
  for (const row of rows) {
    console.log(
      [
        row.label,
        String(row.inputTokens),
        String(row.cacheCreationTokens),
        String(row.cacheReadTokens),
        String(row.outputTokens),
        `$${row.costUsd.toFixed(6)}`,
      ]
        .map((c) => c.padEnd(30))
        .join(""),
    );
  }
}

async function main(): Promise<void> {
  const client = new Anthropic();
  const { record, transcript, message } = midSessionFixture();
  const fullTranscript: TalkTurn[] = [...transcript, { role: "clinician", text: message }];
  const repeatCounts = initRepeatCounts();
  const step = nextStep(record, repeatCounts);

  const narrowSystem = EXTRACTOR_SYSTEM;
  const narrowUser = buildExtractionUserContent(step, FORM_3500_FIELDS, fullTranscript);

  const wideSystem = buildFollowUpExtractorSystem(FORM_3500_FIELDS);
  const openFields = openFollowUpFields(record, TOPICS, FORM_3500_FIELDS);
  // Same cap src/lib/extract.ts's real call site applies — this script's
  // whole point is to measure the ACTUAL production prompt shape, so it
  // must build the user content the same way extract.ts does, capped
  // askFieldIds included (src/prompts/extractor.ts's buildFollowUpUserContent).
  const askFieldIds = step.kind === "topic" ? step.fieldIds.slice(0, MAX_FIELDS_PER_ASK) : [];
  const wideUser = buildFollowUpUserContent(step, askFieldIds, openFields, fullTranscript);

  console.log(`model: ${EXTRACTOR_MODEL}`);
  console.log(`narrow system prompt: ${narrowSystem.length} chars | wide system prompt: ${wideSystem.length} chars`);
  console.log(`narrow open-field count: ${step.kind === "topic" ? step.fieldIds.length : 0} | wide open-field count: ${openFields.length}\n`);

  const narrowRows = await measureTwice(client, "narrow", narrowSystem, narrowUser);
  const wideRows = await measureTwice(client, "wide", wideSystem, wideUser);

  printTable([...narrowRows, ...wideRows]);

  const narrowCachedCost = narrowRows[1].costUsd;
  const wideCachedCost = wideRows[1].costUsd;
  const totalCost = [...narrowRows, ...wideRows].reduce((sum, row) => sum + row.costUsd, 0);
  const ratio = narrowCachedCost > 0 ? wideCachedCost / narrowCachedCost : Number.POSITIVE_INFINITY;

  console.log(`\ntotal cost this run: $${totalCost.toFixed(6)}`);
  console.log(`wide (cached, call 2) / narrow (cached, call 2) cost ratio: ${ratio.toFixed(2)}x`);
  if (ratio > 2) {
    console.log(
      "\nWARNING: the widened per-turn cost exceeds roughly 2x the cached narrow baseline. Per design.md's " +
        "cost posture, this returns to Steve for re-decision before this unit merges.",
    );
  }
}

await main();
