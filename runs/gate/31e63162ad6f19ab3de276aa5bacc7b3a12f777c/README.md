# Round-gate case run

Driven by `scripts/gate-case-driver.mjs` (unit #96) against this `dev`
SHA, with the fake-model extraction fixtures
(`fixtures/gate/cases.ts` → `src/lib/scripted-extract.ts`).

`run.json` records **all six cases**: each passed, and the union of the
surfaces they traversed covers design.md's enumeration with nothing
missed.

Only **C3**'s artifacts are committed here. It is the richest case — two
suspect products, three concomitants, a cross-turn correction and a
same-turn collision — and it is the one this unit's self-test
(`src/lib/gate-run.test.ts`) reads. Committing all six would be ~33 MB
for a driver-proving run; the gate session commits its own full set, per
docs/round-gate.md's "Evidence is committed, not described".

**What this run does and does not certify** (docs/round-gate.md's own
words, repeated in each `manifest.json`): copy, layout and screen
fidelity are model-independent and are certified by it; flow and length
are NOT — under the fake driver they hold only *as exercised by the
scripted extractions*. The real-model residual is charter v1.2's live
evals and Steve's acceptance pass.

The PDF is produced from the exported record through
`scripts/fill-3500.py` — the function `api/generate-pdf.py` wraps. That
HTTP route is Vercel-only and 404s under `next dev` (every `runs/*/`
since unit-89 records the same), so the route's own wrapping is proven
by `scripts/tests/`, and the filling is proven here.
