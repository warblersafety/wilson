// Reviewer's own probe — deviating from the scripted cases where suspicion
// leads (docs/round-gate.md "How it runs": the cases are the floor).
// Drives C3 to the three moments the case driver never screenshots — the
// correction offer, the collision, and the second-suspect-product deferral
// — and dumps every affordance actually on screen at each.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = "/Users/sofa-claude/code/warblersafety/wilson";
const PORT = 3311;
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT ?? "/tmp/wilson-gate/probe";
mkdirSync(OUT, { recursive: true });

const emitted = JSON.parse(
  execFileSync("npx", ["tsx", "scripts/gate-emit-case.ts", "C3"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
);
const scriptPath = `${OUT}/extraction-script.json`;
writeFileSync(scriptPath, JSON.stringify(emitted.script, null, 2));

const child = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
  cwd: REPO,
  env: { ...process.env, WILSON_GATE_SCRIPT: scriptPath, NODE_ENV: "development" },
  stdio: ["ignore", "pipe", "pipe"],
});
for (let i = 0; i < 120; i++) {
  try {
    const r = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
    if (r.ok) break;
  } catch {}
  await sleep(500);
}

const browser = await chromium.launch();
const page = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }).then((c) => c.newPage());
const out = [];
const say = (s) => { console.log(s); out.push(s); };

let n = 0;
const shoot = async (name, clip) => {
  await page.addStyleTag({ content: "nextjs-portal,[data-nextjs-toast]{display:none!important}" }).catch(() => {});
  const f = `${String(++n).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${f}`, ...(clip ? { clip } : { fullPage: true }) });
  say(`[shot] ${f}`);
};

// Everything a clinician could act on, right now.
const affordances = async () =>
  page.$$eval("button, [role='button']", (els) =>
    els.filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).filter(Boolean),
  );
const bubble = async () => {
  const el = await page.$(".ask-form__reply, .repeat-decision__reply");
  return el ? (await el.textContent()).trim() : "(none)";
};
const dump = async (label) => {
  say(`\n=== ${label} ===`);
  say(`BUBBLE: ${await bubble()}`);
  say(`AFFORDANCES: ${JSON.stringify(await affordances())}`);
};

await page.goto(BASE);
await page.waitForSelector(".start-surface");
await page.fill(".start-surface__composer", emitted.case.narrative.text);
await page.click(".start-surface__form button[type='submit']");
await page.waitForSelector(".read-back");
await shoot("read-back");
say(`\nREAD-BACK PANEL:\n${(await page.textContent(".read-back__panel")).trim()}`);
say(`READ-BACK AFFORDANCES: ${JSON.stringify(await affordances())}`);
await page.click(".read-back__confirm");
await page.waitForSelector(".ask-form, .repeat-decision");

const steps = emitted.case.steps;
for (const [i, step] of steps.entries()) {
  const before = await bubble();

  // The three moments of interest, captured BEFORE the case's own answer.
  if (/Replace it\?/.test(before)) {
    await dump(`CORRECTION OFFER (before step ${i})`);
    await shoot("correction-offer");
  }
  if (/which should I write/.test(before)) {
    await dump(`COLLISION (before step ${i})`);
    await shoot("collision");
    // Deviation: can a clinician resolve it by typing the value again?
    say("\n--- DEVIATION: typing '875 mg' at the collision instead of dismissing ---");
    await page.fill(".ask-form textarea", "875 mg");
    await page.click(".ask-form button[type='submit']");
    await page.waitForTimeout(600);
    say(`AFTER TYPING: ${await bubble()}`);
    const rec = await page.evaluate(() => JSON.parse(localStorage.getItem("wilson.talk-session.v1") ?? "{}"));
    say(`strength now: ${JSON.stringify(rec.record?.["Page4.Prod1.Prod1Strength"])}`);
    await shoot("collision-after-retype");
    break;
  }
  if (/I'll ask about that once/.test(before)) {
    await dump(`DEFERRAL (before step ${i})`);
    await shoot("deferral");
  }

  if (step.kind === "type") {
    await page.fill(".ask-form textarea", step.message);
    await page.click(".ask-form button[type='submit']");
  } else {
    await page.click(`button:has-text(${JSON.stringify(step.label)})`);
  }
  await page.waitForTimeout(240);
  if (!(await page.$(".ask-form, .repeat-decision"))) break;
}

writeFileSync(`${OUT}/probe.txt`, out.join("\n"));
await browser.close();
child.kill("SIGTERM");
console.log(`\nprobe evidence: ${OUT}`);
