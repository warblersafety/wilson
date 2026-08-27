// The round-gate case driver (Issue #96). Takes one case id, runs it end
// to end through a real browser against a local dev build with the
// fake-model extraction fixtures, and commits the evidence
// docs/round-gate.md requires under `runs/gate/<dev-SHA>/<case>/`:
// the full transcript, a screenshot of every surface state traversed,
// the exported PDF, and the session bundle.
//
// Replaces scripts/artifact-session.mjs (one case, chips only, seeded
// past Start and Read-back) and runs/unit-92/verify-downloads.mjs, both
// deleted with this unit. A UI unit wanting design.md's full-session
// artifact runs a case from here — `CASE=C1` walks Start through Ready
// with typed turns as well as chips, which the old script could not do
// at all without an API key.
//
// **It fails loudly rather than exiting green on a partial traversal**
// (AC-3). Three independent detectors:
//   - every step asserts the question it expects is really on screen, so
//     a case that has drifted out of step with the walk stops here;
//   - the surfaces actually traversed are checked against the case's own
//     declared set, and what is missing is listed by name;
//   - every talker turn the session holds must have reached the screen
//     (scripts/gate-emit-case.ts's `expected`), so a turn the machinery
//     produced that no surface showed is a failure and not a screenshot
//     nobody reads. That is how #118 was found.
//
// **What those three do NOT cover, stated because a green exit here is
// not a passing gate** (doc-review on #96). The transcript check is
// one-directional — expected ⊆ rendered — so it is blind to a turn
// rendered TWICE, which is entry 3's double bubble; that class is held
// by ux-floor.ts's frameDuplicateViolations() in the ordinary test job,
// not here. And nothing in this script judges whether the copy reads
// well, whether the ask count is sane, or whether a clinician would
// wince: checklist entries 1, 3, 4, 6, 7, 9 and 10 are the reviewer's,
// answered with evidence. Exit 0 means the six cases are still
// driveable and complete — it does not mean the build is good.
//
// Playwright is deliberately NOT a repo dependency: it would put a
// browser download into every CI install. Install it into a scratch
// directory,
// copy this file beside it, and run it from there:
//
//   mkdir -p /tmp/wilson-gate/pw && cd /tmp/wilson-gate/pw
//   npm init -y && npm i playwright
//   cp <repo>/scripts/gate-case-driver.mjs .
//   REPO=<repo> CASE=C3 node gate-case-driver.mjs
//   REPO=<repo> CASE=all node gate-case-driver.mjs   # all six + union check
//
// Environment: REPO (required), CASE (required — a case id or "all"),
// OUT (default <REPO>/runs/gate/<dev-SHA>), PORT (default 3210),
// PYTHON (default python3 — scripts/fill-3500.py needs pymupdf, so on a
// dev box this points at a venv), KEEP=1 to leave the dev server up.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const REPO = must("REPO");
const CASE = must("CASE");
// The SHA names the last commit; it does NOT name what was built. A
// reviewer who patches a rotted selector locally to get through, drives
// six green and commits runs/gate/<clean-SHA>/ has stamped a build
// nobody drove — and CLAUDE.md lets a promotion PR whose head matches
// that SHA proceed. So a dirty tree stops the run, and if it is allowed
// through deliberately the stamp says so in the directory name, the
// manifest and run.json (doc-review on #96).
const SHA = execFileSync("git", ["-C", REPO, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const DIRTY = execFileSync("git", ["-C", REPO, "status", "--porcelain"], { encoding: "utf8" }).trim();
if (DIRTY && !process.env.ALLOW_DIRTY) {
  console.error(
    `gate-case-driver: the working tree is dirty, so a run would stamp ${SHA.slice(0, 7)} for a build that is not ` +
      `that commit. Commit or stash first, or set ALLOW_DIRTY=1 to run anyway (the stamp becomes ` +
      `"${SHA.slice(0, 7)}...-dirty" and every manifest records it).\n\n${DIRTY}`,
  );
  process.exit(2);
}
const STAMP = DIRTY ? `${SHA}-dirty` : SHA;
const OUT_ROOT = process.env.OUT ?? `${REPO}/runs/gate/${STAMP}`;
const PORT = Number(process.env.PORT ?? 3210);
// scripts/fill-3500.py needs pymupdf. CI installs it from
// requirements.txt; on a dev box point this at a venv's interpreter.
const PYTHON = process.env.PYTHON ?? "python3";
const BASE = `http://localhost:${PORT}`;

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`gate-case-driver: ${name} is required`);
  return v;
}

function emitCase(id) {
  return JSON.parse(execFileSync("npx", ["tsx", "scripts/gate-emit-case.ts", id], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
}

// --- the dev server -------------------------------------------------------

// One server per case, not one for the whole run: src/app/actions.ts
// reads WILSON_GATE_SCRIPT once per process (a script that changed
// mid-case would make the evidence describe two different scripts), so
// the script and the process have to have the same lifetime.
async function startServer(scriptPath) {
  const child = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
    cwd: REPO,
    env: { ...process.env, WILSON_GATE_SCRIPT: scriptPath, NODE_ENV: "development" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return { child, logs };
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  child.kill("SIGTERM");
  throw new Error(`gate-case-driver: dev server never came up on ${PORT}\n${logs.join("")}`);
}

// --- one case -------------------------------------------------------------

async function driveCase(id) {
  const emitted = emitCase(id);
  const out = `${OUT_ROOT}/${id}`;
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const scriptPath = `${out}/extraction-script.json`;
  writeFileSync(scriptPath, JSON.stringify(emitted.script, null, 2));

  const { child, logs } = await startServer(scriptPath);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();

  const log = [];
  const say = (s) => {
    console.log(s);
    log.push(s);
  };
  const surfaces = new Set();
  // Per walk as well as overall: C6 runs two, and its whole point is
  // that every surface is seen on BOTH sides of a Start over. One shared
  // Set cannot tell "both walks reached Review" from "the first one did"
  // (reviewer pass on #96).
  const surfacesByWalk = {};
  let currentWalk = "(before the first walk)";
  const reach = (name) => {
    surfaces.add(name);
    (surfacesByWalk[currentWalk] ??= new Set()).add(name);
  };
  const failures = [];
  let shot = 0;

  // An uncaught client exception is a failure the driver ALREADY
  // observes, and logging it to a file nobody diffs is downgrading it —
  // a run could exit 0 with a React error boundary tripped mid-walk
  // (reviewer pass on #96). Console errors stay informational: the
  // expected PDF 404 under `next dev` is one, and failing on it would
  // make every run red for a known Vercel-only route.
  page.on("console", (m) => {
    if (m.type() === "error") say(`[console error] ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    say(`[page error] ${e.message}`);
    failures.push(`uncaught client exception: ${e.message}`);
  });

  // Next's dev indicator renders asynchronously into a `nextjs-portal`,
  // so it is present in some captures and absent from others taken
  // moments apart — tool chrome, not the product, and hiding it is what
  // makes two runs of the same build comparable (PR #104).
  const shoot = async (name) => {
    await page.addStyleTag({ content: "nextjs-portal, [data-nextjs-toast] { display: none !important; }" }).catch(() => {});
    const file = `${String(++shot).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: `${out}/${file}`, fullPage: true });
    say(`[screenshot] ${file}`);
  };
  const transcript = () => page.$$eval(".transcript__turn", (els) => els.map((e) => e.textContent.trim()));
  const askText = async () => {
    const el = await page.$(".ask-form__reply, .repeat-decision__reply");
    return el ? (await el.textContent()).trim() : null;
  };

  try {
    // --- Surface 1: Start ---
    await page.goto(BASE);
    await page.waitForSelector("main");
    reach("start");
    // ReportChrome wraps every surface including Start, so this matches
    // on the first load and evidences nothing on its own. Kept because
    // its ABSENCE would be real, and narrowed to the actual class rather
    // than a `[class*='chrome']` wildcard that could match anything.
    if (await page.$(".report-chrome")) reach("report-chrome");
    await shoot("start");
    say(`[surface] start — ${(await page.textContent("h1")) ?? "(no heading)"}`);

    await runWalk(emitted.case, emitted.expected);

    // --- C6's second run, in the SAME browser state ---
    if (emitted.followOn) {
      say(`\n### Start over → ${emitted.followOn.id} (same browser state)`);
      await page.click(".ready__start-over");
      await page.waitForTimeout(200);
      await shoot("start-over-confirm");
      await page.click(".dialog__danger, .dialog__secondary");
      await page.waitForTimeout(400);
      await shoot("start-over-landed");
      const bled = await bleedCheck(emitted.expected.record);
      if (bled.length > 0) failures.push(`C2 data survived Start over: ${bled.join(", ")}`);
      say(`[start-over] fields carrying data from the previous run: ${bled.length}`);
      await runWalk(emitted.followOn, emitted.expected.followOn ?? { transcript: [] });
    }
  } catch (err) {
    failures.push(`driver error: ${err.message}`);
    say(`\n!! ${err.message}`);
    await shoot("failure").catch(() => {});
  }

  // --- what this case was required to reach ---
  // Checked per walk: a C6 whose second run never reached Review must
  // fail for that reason, not be covered by the first run's coverage.
  for (const [walk, reached] of Object.entries(surfacesByWalk)) {
    const declared = walk === emitted.case.id ? emitted.case.surfaces : (emitted.followOn?.surfaces ?? []);
    const missing = (declared ?? []).filter((s) => !reached.has(s));
    if (missing.length > 0) failures.push(`${walk}: surfaces declared but never reached: ${missing.join(", ")}`);
  }

  const manifest = {
    case: emitted.case.id,
    title: emitted.case.title,
    spec: emitted.case.spec,
    evidences: emitted.case.evidences,
    devSha: STAMP,
    treeClean: DIRTY === "",
    surfacesDeclared: emitted.case.surfaces ?? [],
    surfacesReached: [...surfaces].sort(),
    surfacesByWalk: Object.fromEntries(Object.entries(surfacesByWalk).map(([k, v]) => [k, [...v].sort()])),
    screenshots: shot,
    failures,
    // Stated, not implied: docs/round-gate.md requires the verdict to say
    // this in these words, so the evidence says it too.
    modelFidelity:
      "Fake model. Copy, layout and screen fidelity are model-independent and are certified by this run; " +
      "flow and length are NOT — they hold only as exercised by the scripted extractions.",
  };
  writeFileSync(`${out}/manifest.json`, JSON.stringify(manifest, null, 2));
  writeFileSync(`${out}/transcript.txt`, log.join("\n"));
  writeFileSync(`${out}/dev-server.log`, logs.join(""));

  await browser.close();
  if (!process.env.KEEP) child.kill("SIGTERM");
  return { id, failures, surfaces: [...surfaces], allSurfaces: emitted.allSurfaces ?? [] };

  // --- the walk, shared by a case and its Start-over follow-on ---------

  async function runWalk(gateCase, expected) {
    currentWalk = gateCase.id;
    // --- Surface 2: Read-back (only for a case that dictates one) ---
    if (gateCase.narrative) {
      await page.fill(".start-surface__composer", gateCase.narrative.text);
      await page.click(".start-surface__form button[type='submit']");
      await page.waitForSelector(".read-back", { timeout: 20000 });
      reach("read-back");
      await shoot(`${gateCase.id}-read-back`);
      const panel = await page.textContent(".read-back__panel");
      say(`\n[surface] read-back — panel:\n${panel.trim().slice(0, 900)}`);
      await page.click(".read-back__confirm");
      await page.waitForSelector(".ask-form, .repeat-decision", { timeout: 20000 });
    } else {
      // No narrative: the walk is entered by submitting nothing but the
      // minimum the Start surface accepts. C5 is the case that proves
      // Follow-ups is reachable without Read-back at all.
      await page.waitForSelector(".start-surface");
    }

    reach("follow-ups");
    if (await page.$(".transcript-panel, .transcript")) reach("report-chrome");
    else failures.push(`${gateCase.id}: Follow-ups rendered no transcript panel`);

    let lastTranscript = [];
    const onScreen = new Set();
    for (const [index, step] of gateCase.steps.entries()) {
      if (step.kind === "start-over") break;
      const onScreenAsk = await askText();
      if (onScreenAsk === null) {
        failures.push(`${gateCase.id} step ${index}: no ask on screen`);
        break;
      }
      // The sentinel marks the one step whose question is the decision it
      // already asserted (count chips share a turn with it). Recognised
      // by identity, so a blank assertion is still a failure.
      const asserts = step.expectAsk && step.expectAsk !== emitted.followThroughSentinel;
      if (asserts && !onScreenAsk.includes(step.expectAsk)) {
        failures.push(
          `${gateCase.id} step ${index}: expected an ask containing ${JSON.stringify(step.expectAsk)}, saw ${JSON.stringify(onScreenAsk.slice(0, 120))}`,
        );
        break;
      }
      if (index < 6 || step.kind === "type") await shoot(`${gateCase.id}-turn-${String(index + 1).padStart(2, "0")}`);
      // Before AND after the action. The last ask of a walk is answered
      // by a tap that lands on Review, which renders no transcript at
      // all — so an after-only capture is permanently one turn short,
      // and short in the flattering direction.
      const before = await transcript();
      if (before.length > lastTranscript.length) lastTranscript = before;
      // The CURRENT ask lives in the bubble, not the transcript panel —
      // it moves into the panel only when the next turn arrives, so the
      // last ask of a walk is never in the panel at all. Collected
      // separately rather than papered over: "was this turn shown to the
      // clinician" is the question, and the bubble is showing it.
      onScreen.add(onScreenAsk);

      if (step.kind === "type") {
        await page.fill(".ask-form textarea", step.message);
        await page.click(".ask-form button[type='submit']");
      } else {
        await page.click(`button:has-text(${JSON.stringify(step.label)})`);
      }
      await page.waitForTimeout(220);
      // Kept per turn, not read at the end: by the time the walk is over
      // the wizard has handed off to Review, which renders no transcript
      // at all — so reading it afterwards compares against an empty list
      // and finds nothing missing, the most flattering possible bug.
      const rendered = await transcript();
      if (rendered.length > lastTranscript.length) lastTranscript = rendered;
      if (!(await page.$(".ask-form, .repeat-decision"))) break;
    }

    // Gate states, read off the walk the browser actually took.
    const seen = lastTranscript.join("\n");
    if (/device details|operating the device|reprocessed/i.test(seen)) reach("gate-opened-device");
    if (/still available|purchased/i.test(seen)) reach("gate-opened-product-handling");

    const seenOnScreen = [...lastTranscript, ...onScreen];
    await compareTranscript(gateCase.id, seenOnScreen, expected.transcript ?? []);
    // Both halves, because both were read by the clinician: the
    // transcript panel holds every turn that has been superseded, and the
    // composer bubble holds the one currently being answered — which
    // means the LAST ask of a walk is only ever in the bubble. An
    // artifact carrying only the panel is missing a turn, and missing it
    // in the direction that makes a run look complete.
    writeFileSync(
      `${out}/${gateCase.id}-rendered-transcript.txt`,
      [
        "--- transcript panel, in order ---",
        ...lastTranscript,
        "",
        "--- asks rendered in the composer bubble ---",
        ...onScreen,
      ].join("\n"),
    );

    // --- Surface 4: Review ---
    await page.waitForTimeout(500);
    await page.waitForSelector(".review", { timeout: 20000 });
    reach("review");
    await shoot(`${gateCase.id}-review`);

    const paper = await page.$(".review__paper-toggle");
    if (paper) {
      await paper.click();
      await page.waitForTimeout(400);
      reach("review-paper-facsimile");
      await shoot(`${gateCase.id}-review-paper-facsimile`);
      await paper.click();
      await page.waitForTimeout(200);
    }

    // --- Surface 5: Open fields (a dialog over Review) ---
    await page.click(".review__sign-off");
    await page.waitForTimeout(300);
    if (await page.$("[aria-labelledby='open-fields-heading']")) {
      reach("open-fields");
      await shoot(`${gateCase.id}-open-fields`);
      say(`\n[surface] open-fields:\n${(await page.textContent("[aria-labelledby='open-fields-heading']")).trim().slice(0, 700)}`);
      await page.click("button:has-text('Finish as it stands')");
      await page.waitForTimeout(500);
    }

    // --- Surface 6: Ready ---
    await page.waitForSelector(".ready", { timeout: 20000 });
    reach("ready");
    await shoot(`${gateCase.id}-ready`);
    say(`\n[surface] ready:\n${(await page.textContent("main")).trim().slice(0, 1200)}`);

    await captureDownloads(gateCase.id);
    await writePdf(gateCase.id);
  }

  // The record and the whole-session bundle, taken the way a clinician
  // takes them — through the buttons, not by reading localStorage — so
  // what is committed is what the app actually hands over (#92).
  async function captureDownloads(caseId) {
    for (const [label, name] of [
      ["Download the record (JSON)", "record"],
      ["Download the whole session (JSON)", "session-bundle"],
    ]) {
      const button = await page.$(`button:has-text(${JSON.stringify(label)})`);
      if (!button) {
        failures.push(`${caseId}: no "${label}" button on Ready`);
        continue;
      }
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), button.click()]);
      await download.saveAs(`${out}/${caseId}-${name}.json`);
      say(`[download] ${caseId}-${name}.json`);
    }
  }

  // docs/round-gate.md requires the exported PDF as evidence.
  // api/generate-pdf.py is a Vercel serverless handler and does not run
  // under `next dev` (every runs/*/session.txt since unit-89 records the
  // same 404), so the bytes are produced here from the EXPORTED RECORD —
  // the one the clinician just downloaded, ReportDate stamped and all —
  // through scripts/fill-3500.py, which is the very function that handler
  // wraps. Stated in the manifest rather than left to be discovered: this
  // is the same filling code, reached without the HTTP hop, and the hop
  // itself has its own tests (scripts/tests/).
  async function writePdf(caseId) {
    try {
      const record = execFileSync("cat", [`${out}/${caseId}-record.json`], { encoding: "utf8" });
      const pdf = execFileSync(PYTHON, [`${REPO}/scripts/fill-3500.py`], {
        input: record,
        maxBuffer: 64 * 1024 * 1024,
      });
      writeFileSync(`${out}/${caseId}-form-3500.pdf`, pdf);
      say(`[pdf] ${caseId}-form-3500.pdf (${pdf.length} bytes, via scripts/fill-3500.py from the exported record)`);
    } catch (err) {
      failures.push(`${caseId}: PDF export failed — ${String(err.message).slice(0, 300)}`);
    }
  }

  // The browser's transcript against the session the same case produces
  // through the pure machinery. Talker turns only: a chip tap's own
  // clinician turn is composed in the component, and comparing those
  // would be comparing the driver to itself.
  async function compareTranscript(caseId, actual, expected) {
    const expectedTalker = expected.filter((t) => t.role === "talker").map((t) => t.text);
    const missing = expectedTalker.filter((text) => !actual.some((a) => a.includes(text)));
    // The done message is the one turn the session holds that Follow-ups
    // deliberately never shows: IntakeFlow hands off to Review "the
    // moment nothing is left to ask" (Issue #45), so the walk leaves
    // before it renders. Excluded by exact identity, not by dropping the
    // last turn — a SECOND unrendered turn is still a failure, which is
    // the whole point of comparing at all.
    // Anything ENDING with the done message: the handoff turn carries
    // whatever the last action's acknowledgment was, prefixed onto it
    // ("Marked other reports and identity-withholding choice as not on
    // hand. That's everything I need to ask."), so an exact match misses
    // it. That prefix is composed and never shown — warblersafety/wilson#118.
    const DONE = "That's everything I need to ask. Review the report before you sign off.";
    const unexplained = missing.filter((text) => !text.endsWith(DONE));
    say(
      `\n[transcript] ${caseId}: ${actual.length} rendered turns and asks; ` +
        `${expectedTalker.length} talker turns expected from the pure walk; ` +
        `${unexplained.length} unaccounted for (${missing.length - unexplained.length} is the handoff turn, which Review replaces — #118)`,
    );
    if (unexplained.length > 0) {
      failures.push(
        `${caseId}: ${unexplained.length} talker turn(s) the session says exist never reached the screen, ` +
          `first: ${JSON.stringify(unexplained[0].slice(0, 90))}`,
      );
    }
  }

  // C6's pass bar: no data from the completed run survives Start over.
  async function bleedCheck(previousRecord) {
    const stored = await page.evaluate(() => window.localStorage.getItem("wilson.talk-session.v1"));
    if (!stored) return [];
    const session = JSON.parse(stored);
    return Object.entries(previousRecord ?? {})
      .filter(([, entry]) => entry.state === "answered")
      .filter(([fieldId]) => session.record?.[fieldId]?.state === "answered")
      .map(([fieldId]) => fieldId);
  }
}

// --- run ------------------------------------------------------------------

const ids = CASE === "all" ? ["C1", "C2", "C3", "C4", "C5", "C6"] : [CASE];
const results = [];
for (const id of ids) {
  console.log(`\n${"=".repeat(64)}\n=== ${id}\n${"=".repeat(64)}`);
  results.push(await driveCase(id));
}

// The union check (AC-3): across the whole run set, every surface
// design.md enumerates must have been reached by SOMETHING. A per-case
// check cannot catch a surface no case reaches at all.
// Emitted by gate-emit-case.ts from fixtures/gate/cases.ts, never kept
// here: a second copy of the enumeration drifts the moment a surface is
// added, and the union check would then pass against a stale list —
// the one mechanism that is supposed to make "exiting green on a
// partial traversal" impossible (reviewer pass on #96).
const ALL_SURFACES = results[0]?.allSurfaces ?? [];
const union = new Set(results.flatMap((r) => r.surfaces));
const neverReached = CASE === "all" ? ALL_SURFACES.filter((s) => !union.has(s)) : [];

mkdirSync(OUT_ROOT, { recursive: true });
writeFileSync(
  `${OUT_ROOT}/run.json`,
  JSON.stringify({ devSha: STAMP, treeClean: DIRTY === "", cases: results, surfacesUnion: [...union].sort(), neverReached }, null, 2),
);

console.log(`\n${"=".repeat(64)}\n=== RUN SUMMARY (dev ${STAMP.slice(0, 7)}${DIRTY ? " — DIRTY TREE" : ""})`);
for (const r of results) console.log(`${r.id}: ${r.failures.length === 0 ? "ok" : `${r.failures.length} FAILURE(S)`}`);
for (const r of results) for (const f of r.failures) console.log(`  [${r.id}] ${f}`);
if (neverReached.length > 0) console.log(`\n!! surfaces no case reached: ${neverReached.join(", ")}`);
console.log(`\nevidence: ${OUT_ROOT}`);

const failed = results.some((r) => r.failures.length > 0) || neverReached.length > 0;
process.exitCode = failed ? 1 : 0;
