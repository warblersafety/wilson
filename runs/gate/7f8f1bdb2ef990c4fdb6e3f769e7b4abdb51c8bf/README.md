# Round-gate run — dev 7f8f1bd — **NOT READY**

The first round gate under `docs/round-gate.md`. Round = the ten commits
merged to `dev` since that file landed (`2def75a..7f8f1bd`): units #89,
#90 (three parts), #91, #92, #96, #100/#101/#103, #109/#110, #111.

Driven on a clean tree at
`7f8f1bdb2ef990c4fdb6e3f769e7b4abdb51c8bf` by
`scripts/gate-case-driver.mjs` (`CASE=all`), with the fake-model
extraction fixtures (`fixtures/gate/cases.ts` →
`src/lib/scripted-extract.ts`). Driver exit code **0** — the six cases
are still driveable and complete. That is the floor, not the verdict:
entries 1, 3, 4, 6, 7, 9 and 10 are answered by the reviewer, below and
in the verdict on Issue #1.

The build's own gates were green at the same SHA: `npm run typecheck`
clean, `npm test` 885 passed across 37 files. Everything this run found,
it found with CI green — which is the gap the gate exists to cover.

## What is here

Per case (`C1`–`C6`): `transcript.txt` (the driver's own log, including
each surface's dumped text), `<case>-rendered-transcript.txt` (the
transcript panel in order, plus every ask rendered in the composer
bubble), a screenshot of every surface state traversed,
`<case>-record.json`, `<case>-session-bundle.json`,
`<case>-form-3500.pdf`, `manifest.json`, `extraction-script.json`, and
`dev-server.log`. `run.json` carries all six results and the surface
union. `driver-run.log` is the whole run's console output.

`runs/gate-probes/7f8f1bd/` (outside `runs/gate/`, which `gate-run.test.ts`
walks as case directories) holds the reviewer's own deviations from the scripted
cases — `probe.mjs` and `probe2.mjs`, runnable the same way as the
driver, with their screenshots and logs. They reach three states the
case driver never screenshots (it shoots the first six turns plus typed
steps only): the correction offer, the collision, and the
second-suspect-product deferral. Findings 2 and 4 in the verdict rest on
them.

## What this run does and does not certify

docs/round-gate.md's own words, repeated here and in each
`manifest.json`: **copy, layout and screen fidelity are
model-independent and are certified by this run; flow and length are
NOT — under the fake driver they hold only *as exercised by the
scripted extractions*.** The real-model residual is charter v1.2's live
evals and Steve's own acceptance pass, and this verdict never claims it.

That boundary is load-bearing here, not a formality. Several cases
deliberately propose less than a good model would, and the walk length
shows it: C2's narrative states "non-serious", "reported yesterday" and
"ongoing" and the script proposes none of them; C1's "it's an adverse
reaction" and "made by Sandoz" likewise. So the ask counts below are
real for these extractions and say nothing about a real model's.

The PDF is produced from the exported record through
`scripts/fill-3500.py` — the function `api/generate-pdf.py` wraps. That
route is Vercel-only and 404s under `next dev` (every `runs/*/` since
unit-89 records the same), so the route's wrapping is proven by
`scripts/tests/` and the filling is proven here.

## Verdict summary

**NOT READY.** Eight findings, two of them putting wrong or missing data
on an FDA-bound form:

1. Text-ask negatives print "Unknown" on the exported form (C2 — entry 5, 9)
2. A stated second suspect product is dropped, with a false promise (C3 — entry 2, 7)
3. Every chip-tap answer re-renders the whole question (all cases — entry 3, 4)
4. A follow-up collision asks a question it cannot receive (C3 — entry 7)
5. Re-ask frames stand in for primary asks never voiced (C1/C2/C3/C4 — entry 1, 2)
6. The sex the clinician just confirmed is asked again, then recorded as a phantom (C3 — entry 2, 5)
7. The sign-off surface headlines "105 fields are still open" (C3/C4 — entry 5, 10)
8. Ready renders "Report ready" and a PDF failure at once (all cases — entry 3)

Entries 8, 9 and 11 pass; the correction offer, the privacy copy, the
gate exclusions, C6's Start-over isolation and C1/C3/C4/C5's PDF
field-mapping are all clean. The full checklist, entry by entry with
evidence, is the verdict comment on Issue #1.

**A driver failure would have been ambiguous between a product defect
and fixture rot; there was none.** No selector was patched and no
fixture was edited to get through — the tree was clean at the start of
the run and every finding above is a product behaviour, read off
committed evidence.
