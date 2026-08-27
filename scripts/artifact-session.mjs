// Drives a scripted end-to-end session and writes the full-session
// artifact design.md's extended proof rule requires: the complete
// transcript, plus a screenshot of every surface state the run traverses.
//
// No model calls. It seeds `wilson.talk-session.v1` with the session
// IntakeFlow persists after a Read-back confirm (scripts/artifact-seed.ts
// prints one), then drives only the deterministic chip paths — "I don't
// have that", and "No" at each repeat decision — to the end of the walk.
// A typed answer would call the extractor, which needs an API key.
//
// Playwright is deliberately NOT a repo dependency: this runs by hand
// when a UI unit needs its artifact, and adding it would put a browser
// download into every CI install. Install it into a scratch directory,
// copy this file beside it, and run it from there:
//
//   mkdir -p /tmp/wilson-artifact/pw && cd /tmp/wilson-artifact/pw
//   npm init -y && npm i playwright
//   cp <repo>/scripts/artifact-session.mjs .
//   # then, back in the repo:
//   npm run dev &
//   npx tsx scripts/artifact-seed.ts > /tmp/wilson-artifact/seed.json
//   # then, from /tmp/wilson-artifact/pw:
//   OUT=<repo>/runs/unit-NN SEED=/tmp/wilson-artifact/seed.json node artifact-session.mjs
//
// Environment: OUT (required — the artifact directory), SEED (required —
// the seed JSON), BASE (default http://localhost:3000; use localhost,
// never 127.0.0.1), MAX_TURNS, SHOT_TURNS (how many consecutive
// follow-up turns to screenshot — every repeat decision and every later
// surface is always captured regardless).
//
// Superseded, once it lands, by unit #96's committed case driver for the
// round gate (docs/round-gate.md) — which captures the same evidence for
// six pinned cases rather than one.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const OUT = process.env.OUT;
const SEED = readFileSync(process.env.SEED, "utf8");
const BASE = process.env.BASE ?? "http://localhost:3000";
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 200);
const SHOT_TURNS = Number(process.env.SHOT_TURNS ?? 10);

mkdirSync(OUT, { recursive: true });
const log = [];
let shot = 0;
const say = (s) => { console.log(s); log.push(s); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => { if (m.type() === "error") say(`[console error] ${m.text()}`); });
page.on("pageerror", (e) => say(`[page error] ${e.message}`));

async function shoot(name) {
  const file = `${String(++shot).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  say(`[screenshot] ${file}`);
}

async function transcriptText() {
  return page.$$eval(".transcript__turn", (els) => els.map((e) => e.textContent.trim()));
}
async function askBubbleText() {
  const el = await page.$(".ask-form__reply, .repeat-decision__reply");
  return el ? (await el.textContent()).trim() : null;
}

// --- Surface 1: Start ---
await page.goto(BASE);
await page.waitForSelector("main");
await shoot("start");
say(`[surface] start — heading: ${(await page.textContent("h1")) ?? "(none)"}`);

// --- Seed and land on Follow-ups ---
await page.evaluate((seed) => window.localStorage.setItem("wilson.talk-session.v1", seed), SEED);
await page.reload();
await page.waitForSelector(".ask-form, .repeat-decision");

let turn = 0;
let lastTranscript = [];
const seenAskTexts = [];
while (turn < MAX_TURNS) {
  const isRepeat = (await page.$(".repeat-decision")) !== null;
  const ask = await askBubbleText();
  const turns = await transcriptText();
  // The bug under test is the ADJACENT pair: the transcript ending with
  // the very ask the bubble below is about to render (Steve's gray-then-
  // teal screenshot). An identical string appearing EARLIER in the
  // history is a different defect — distinct topics whose template copy
  // renders byte-identical, which is #90's scope, not this unit's.
  const endsWithAsk = turns.length > 0 && turns[turns.length - 1] === ask;
  const echoesEarlier = turns.slice(0, -1).filter((t) => t === ask).length;
  seenAskTexts.push(ask);
  say(
    `\n=== turn ${turn + 1} (${isRepeat ? "repeat-decision" : "topic"}) ===\n` +
      `progress: ${(await page.textContent(".transcript-panel__progress").catch(() => null)) ?? "(none)"}\n` +
      `ask bubble: ${ask}\n` +
      `transcript above it: ${turns.length} turns; ends with this ask: ${endsWithAsk}; ` +
      `identical text earlier in history: ${echoesEarlier}`,
  );
  if (endsWithAsk) say(`!! DOUBLE-RENDER: the transcript ends with the ask the bubble renders`);
  if (echoesEarlier > 0) say(`note (#90, not this unit): ${echoesEarlier} earlier turn(s) carry byte-identical template copy`);
  if (turn < SHOT_TURNS || isRepeat) await shoot(isRepeat ? `followups-repeat-${turn + 1}` : `followups-turn-${turn + 1}`);

  if (isRepeat) {
    await page.click(".repeat-decision__chips button:has-text('No')");
  } else {
    const chip = await page.$("button:has-text(\"I don't have that\")");
    if (!chip) { say("[no chip — leaving the follow-up loop]"); break; }
    await chip.click();
  }
  turn += 1;
  lastTranscript = turns;
  await page.waitForTimeout(120);
  if (!(await page.$(".ask-form, .repeat-decision"))) { say("\n[follow-ups complete]"); break; }
}

// --- Review ---
await page.waitForTimeout(400);
await shoot("review");
say(`\n[surface] review — body text:\n${(await page.textContent("main")).trim().slice(0, 2500)}`);

// The complete transcript, once, at the end of the walk — the artifact's
// "read this session as a user" half.
// Captured on the last follow-up turn: by the time the walk ends the
// wizard has handed off to Review, which renders no transcript.
const finalTranscript = (await transcriptText()).length > 0 ? await transcriptText() : lastTranscript;
say(`\n=== COMPLETE TRANSCRIPT (${finalTranscript.length} turns) ===`);
for (const [i, t] of finalTranscript.entries()) say(`[${i + 1}] ${t}`);

// --- Review: the paper facsimile, one click away ---
const paperToggle = await page.$(".review__paper-toggle");
if (paperToggle) {
  await paperToggle.click();
  await page.waitForTimeout(400);
  await shoot("review-paper-facsimile");
  say("[surface] review — Form 3500 facsimile shown");
  await paperToggle.click();
  await page.waitForTimeout(200);
}

// --- Open fields (screen 06, drawn over Review by its sign-off) ---
await page.click(".review__sign-off");
await page.waitForTimeout(300);
if (await page.$(".open-fields__answer, [id='open-fields-heading']")) {
  await shoot("open-fields");
  say(`[surface] open-fields dialog:\n${(await page.textContent("[aria-labelledby='open-fields-heading'], dialog, .dialog")).trim().slice(0, 1200)}`);
  await page.click("button:has-text('Finish as it stands')");
  await page.waitForTimeout(500);
}

// --- Ready ---
await shoot("ready");
say(`\n[surface] ready — body text:\n${(await page.textContent("main")).trim().slice(0, 1500)}`);

const doubleRenders = log.filter((l) => l.startsWith("!! DOUBLE-RENDER")).length;
const templateEchoes = log.filter((l) => l.startsWith("note (#90")).length;
say(`\n=== SUMMARY ===\nturns driven: ${turn}\nscreenshots: ${shot}\n` +
  `double-render occurrences (this unit's bug): ${doubleRenders}\n` +
  `turns whose ask text is echoed earlier in the history (#90's template copy): ${templateEchoes}`);
writeFileSync(`${OUT}/session.txt`, log.join("\n"));
await browser.close();
