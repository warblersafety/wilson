// Clicks both #92 buttons in a real browser and reads what lands.
// The revoke-timing fix (reviewer pass, PR #112, finding 1) is invisible
// to every test in the repo; this is the only way to see it.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const SEED = readFileSync(process.env.SEED, "utf8");
const BASE = "http://localhost:3000";

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript((seed) => localStorage.setItem("wilson.talk-session.v1", seed), SEED);
await page.goto(BASE, { waitUntil: "networkidle" });

// Walk to Review via the wizard's own done path: the seeded session is
// mid-walk, so dismiss through to the end.
for (let i = 0; i < 60; i += 1) {
  const chip = page.getByRole("button", { name: "I don't have that" });
  const no = page.getByRole("button", { name: "No", exact: true });
  if (await chip.count()) { await chip.first().click(); }
  else if (await no.count()) { await no.first().click(); }
  else break;
  await page.waitForTimeout(60);
}
await page.waitForTimeout(400);

async function grab(name) {
  const [dl] = await Promise.all([
    page.waitForEvent("download", { timeout: 10000 }),
    page.getByRole("button", { name }).first().click(),
  ]);
  const path = await dl.path();
  const body = readFileSync(path, "utf8");
  return { filename: dl.suggestedFilename(), bytes: body.length, body };
}

for (const surface of ["review", "ready"]) {
  if (surface === "ready") {
    const signOff = page.getByRole("button", { name: "Sign off and continue" });
    if (!(await signOff.count())) { console.log("no sign-off button; stopping"); break; }
    await signOff.click();
    await page.waitForTimeout(500);
    // Sign-off opens the open-fields dialog when gaps remain.
    const finish = page.getByRole("button", { name: "Finish as it stands" });
    if (await finish.count()) { await finish.first().click(); await page.waitForTimeout(600); }
    await page.waitForTimeout(400);
  }
  console.log(`\n=== ${surface} ===`);
  try {
    const rec = await grab("Download the record (JSON)");
    const parsedRec = JSON.parse(rec.body);
    console.log(`record:  ${rec.filename}  ${rec.bytes} bytes  keys=${Object.keys(parsedRec).length}`);
    console.log(`         ReportDate = ${JSON.stringify(parsedRec["Page1.SecA_Patient.ReportDate"])}`);

    const bun = await grab("Download the whole session (JSON)");
    const parsedBun = JSON.parse(bun.body);
    console.log(`bundle:  ${bun.filename}  ${bun.bytes} bytes`);
    console.log(`         first key = ${Object.keys(parsedBun)[0]} = ${parsedBun.bundleVersion}`);
    console.log(`         appVersion=${parsedBun.appVersion} turns=${parsedBun.transcript.length} fields=${Object.keys(parsedBun.record).length}`);
    console.log(`         widget turns = ${parsedBun.transcript.filter(t => t.source === "widget").length}`);
  } catch (e) {
    console.log(`FAILED on ${surface}: ${e.message}`);
  }
}
await browser.close();
