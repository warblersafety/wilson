// Probe 2 — deviating again: (a) ACCEPT the correction offer instead of
// ignoring it, and check the record actually changes; (b) carry on to the
// second-suspect-product ask and capture the deferral the case driver
// never screenshots.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = "/Users/sofa-claude/code/warblersafety/wilson";
const PORT = 3312;
const BASE = `http://localhost:${PORT}`;
const OUT = "/tmp/wilson-gate/probe2";
mkdirSync(OUT, { recursive: true });

const emitted = JSON.parse(
  execFileSync("npx", ["tsx", "scripts/gate-emit-case.ts", "C3"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
);
writeFileSync(`${OUT}/extraction-script.json`, JSON.stringify(emitted.script, null, 2));

const child = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
  cwd: REPO,
  env: { ...process.env, WILSON_GATE_SCRIPT: `${OUT}/extraction-script.json`, NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 120; i++) {
  try { if ((await fetch(BASE, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
  await sleep(500);
}

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 1280, height: 900 } }).then((c) => c.newPage());
const out = [];
const say = (s) => { console.log(s); out.push(s); };
let n = 0;
const shoot = async (name) => {
  await page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast]{display:none!important}" }).catch(() => {});
  await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, "0")}-${name}.png`, fullPage: true });
  say(`[shot] ${String(n).padStart(2, "0")}-${name}.png`);
};
const bubble = async () => {
  const el = await page.$(".ask-form__reply, .repeat-decision__reply");
  return el ? (await el.textContent()).trim() : "(none)";
};
const affordances = async () =>
  page.$$eval("button,[role='button']", (els) => els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).filter(Boolean));
const field = async (id) =>
  page.evaluate((f) => (JSON.parse(localStorage.getItem("wilson.talk-session.v1") ?? "{}").record ?? {})[f], id);

await page.goto(BASE);
await page.waitForSelector(".start-surface");
await page.fill(".start-surface__composer", emitted.case.narrative.text);
await page.click(".start-surface__form button[type='submit']");
await page.waitForSelector(".read-back");
await page.click(".read-back__confirm");
await page.waitForSelector(".ask-form, .repeat-decision");

let acceptedCorrection = false;
for (const [i, step] of emitted.case.steps.entries()) {
  const before = await bubble();

  if (!acceptedCorrection && /Replace it\?/.test(before)) {
    say(`\n=== ACCEPTING the correction offer (deviation from the case) ===`);
    say(`BEFORE: date of event = ${JSON.stringify(await field("Page1.SecA_Patient.EventDate"))}`);
    await shoot("correction-offer");
    await page.click("button:has-text('Replace date of event')");
    await page.waitForTimeout(600);
    say(`AFTER : date of event = ${JSON.stringify(await field("Page1.SecA_Patient.EventDate"))}`);
    say(`BUBBLE AFTER ACCEPT: ${await bubble()}`);
    say(`AFFORDANCES AFTER  : ${JSON.stringify(await affordances())}`);
    await shoot("correction-accepted");
    acceptedCorrection = true;
    // The offer consumed the turn; re-enter the same step so the walk stays aligned.
  }

  if (/I'll ask about that once/.test(before)) {
    say(`\n=== SECOND SUSPECT PRODUCT — the deferral ===`);
    say(`BUBBLE: ${before}`);
    say(`AFFORDANCES: ${JSON.stringify(await affordances())}`);
    say(`Prod2Name = ${JSON.stringify(await field("Page5.Prod2.Prod2Name"))}`);
    await shoot("deferral");
  }

  if (step.kind === "type") {
    await page.fill(".ask-form textarea", step.message);
    await page.click(".ask-form button[type='submit']");
  } else {
    const btn = await page.$(`button:has-text(${JSON.stringify(step.label)})`);
    if (!btn) { say(`(step ${i}: no "${step.label}" chip — stopping)`); break; }
    await btn.click();
  }
  await page.waitForTimeout(240);
  if (!(await page.$(".ask-form, .repeat-decision"))) break;
}

say(`\nFINAL date of event = ${JSON.stringify(await field("Page1.SecA_Patient.EventDate"))}`);
say(`FINAL Prod2Name     = ${JSON.stringify(await field("Page5.Prod2.Prod2Name"))}`);
writeFileSync(`${OUT}/probe2.txt`, out.join("\n"));
await browser.close();
child.kill("SIGTERM");
