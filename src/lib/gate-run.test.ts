// The driver self-test (Issue #96 AC-4): over a committed run, assert
// the artifact set is complete and the transcript matches the session
// state.
//
// It reads what the driver actually wrote rather than re-deriving it.
// That is the point: `gate-cases.test.ts` proves a case still describes
// the walk using the pure machinery, and would stay green if the browser
// driver silently stopped capturing screenshots, stopped exporting the
// bundle, or wrote a transcript no surface ever rendered. This is the
// half that notices.
//
// Runs against every `runs/gate/<sha>/` directory present. If a run
// exists, it must be complete — a committed run that is missing half its
// evidence is worse than no run, because the verdict that cites it looks
// substantiated.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const GATE_RUNS = `${REPO}/runs/gate`;

interface Manifest {
  case: string;
  devSha: string;
  surfacesDeclared: string[];
  surfacesReached: string[];
  screenshots: number;
  failures: string[];
  modelFidelity: string;
}

function runDirectories(): string[] {
  if (!existsSync(GATE_RUNS)) return [];
  return readdirSync(GATE_RUNS).filter((entry) => statSync(`${GATE_RUNS}/${entry}`).isDirectory());
}

function caseDirectories(run: string): string[] {
  return readdirSync(`${GATE_RUNS}/${run}`).filter((entry) => statSync(`${GATE_RUNS}/${run}/${entry}`).isDirectory());
}

const RUNS = runDirectories();

describe("committed round-gate runs", () => {
  // Not a skip: a repo with no committed run has nothing to check, but a
  // silently-skipping suite is how the v1.1 tests were green the day the
  // build was rejected. Asserted so the reason is visible.
  it("there is at least one committed run to check", () => {
    expect(RUNS.length, `no run directories under runs/gate/`).toBeGreaterThan(0);
  });

  for (const run of RUNS) {
    describe(run.slice(0, 12), () => {
      const cases = caseDirectories(run);

      it("records which cases ran, and whether they passed", () => {
        const summary = JSON.parse(readFileSync(`${GATE_RUNS}/${run}/run.json`, "utf8"));
        expect(summary.devSha).toBe(run);
        expect(summary.cases.length).toBeGreaterThan(0);
        for (const entry of summary.cases) {
          expect(entry.failures, `${entry.id} failed`).toEqual([]);
        }
      });

      it("has at least one case's artifacts committed", () => {
        expect(cases.length).toBeGreaterThan(0);
      });

      for (const id of cases) {
        describe(id, () => {
          const dir = `${GATE_RUNS}/${run}/${id}`;
          const manifest = JSON.parse(readFileSync(`${dir}/manifest.json`, "utf8")) as Manifest;
          const files = readdirSync(dir);

          // docs/round-gate.md: "per case — the full transcript, a
          // screenshot of every surface state, the exported PDF, and the
          // session bundle". Each checked by name, not by counting
          // files: a run that wrote eight screenshots and no PDF has the
          // right file count and the wrong evidence.
          it("carries the full artifact set round-gate.md requires", () => {
            expect(files, "the driver's own log").toContain("transcript.txt");
            expect(files, "the rendered transcript").toContain(`${id}-rendered-transcript.txt`);
            expect(files, "the exported record").toContain(`${id}-record.json`);
            expect(files, "#92's session bundle").toContain(`${id}-session-bundle.json`);
            expect(files, "the exported PDF").toContain(`${id}-form-3500.pdf`);
            expect(files, "the extraction script this run used").toContain("extraction-script.json");
            expect(files.filter((f) => f.endsWith(".png")).length, "screenshots").toBeGreaterThan(5);
          });

          it("reached every surface it declared, and failed nothing", () => {
            expect(manifest.failures).toEqual([]);
            expect(manifest.surfacesDeclared.filter((s) => !manifest.surfacesReached.includes(s))).toEqual([]);
            expect(manifest.screenshots).toBe(files.filter((f) => f.endsWith(".png")).length);
          });

          // The claim docs/round-gate.md requires a fake-model run to
          // make in these words. Committed with the evidence so a
          // verdict citing it cannot quietly drop the qualification.
          it("states what a fake-model run does not certify", () => {
            expect(manifest.modelFidelity).toContain("Copy, layout and screen fidelity are model-independent");
            expect(manifest.modelFidelity).toContain("flow and length are NOT");
          });

          it("the PDF is a real PDF, not an error page", () => {
            const pdf = readFileSync(`${dir}/${id}-form-3500.pdf`);
            expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
            expect(pdf.length).toBeGreaterThan(100_000);
          });

          // AC-4's second half. The bundle is what #92 exports and what
          // an auditor would read; the rendered transcript is what the
          // surface actually showed. Every talker turn the session holds
          // must have been on screen — except the handoff turn Review
          // replaces, which is #118, filed rather than hidden.
          it("the transcript matches the session state", () => {
            const bundle = JSON.parse(readFileSync(`${dir}/${id}-session-bundle.json`, "utf8"));
            const rendered = readFileSync(`${dir}/${id}-rendered-transcript.txt`, "utf8");
            const turns = bundle.session?.transcript ?? bundle.transcript ?? [];
            expect(turns.length, "the bundle carries the conversation").toBeGreaterThan(10);

            const DONE = "That's everything I need to ask. Review the report before you sign off.";
            const unrendered = turns
              .filter((turn: { role: string; text: string }) => turn.role === "talker")
              .map((turn: { text: string }) => turn.text)
              .filter((text: string) => !rendered.includes(text))
              .filter((text: string) => !text.endsWith(DONE));
            expect(unrendered, "talker turns the session holds that no surface showed").toEqual([]);
          });

          it("the exported record is the one the transcript was built from", () => {
            const bundle = JSON.parse(readFileSync(`${dir}/${id}-session-bundle.json`, "utf8"));
            const record = JSON.parse(readFileSync(`${dir}/${id}-record.json`, "utf8"));
            const fromBundle = bundle.session?.record ?? bundle.record;
            const fromRecord = record.record ?? record;
            expect(Object.keys(fromRecord).length).toBe(Object.keys(fromBundle).length);
            // Same states, field for field: two exports of one session
            // that disagree is the class of defect #92's own reviewer
            // pass found (a ReportDate stamped in one and not the other).
            const differing = Object.keys(fromBundle).filter((id) => fromRecord[id]?.state !== fromBundle[id]?.state);
            expect(differing).toEqual([]);
          });
        });
      }
    });
  }
});
