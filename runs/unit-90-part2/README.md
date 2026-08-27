# Unit #90 part 2a — full-session artifact

design.md's extended proof rule. `scripts/artifact-session.mjs` against
`npm run dev`, no model calls, `SHOT_TURNS=6`.

## What this artifact proves, and what it can't

This round changes the **extraction turn** — the derive rules of
`docs/ask-copy.md` rule 3 and rule 7's group completion. The scripted walk
drives only the deterministic chip paths, because a typed answer calls the
extractor and this environment has no `ANTHROPIC_API_KEY`. So the derives
do not appear here at all.

They are proved instead by `src/lib/derive.test.ts` (every rule with its
negative — the bare-age default, and the bare weight that deliberately
gets none) and by an end-to-end test in `src/lib/extract.test.ts` that
drives a real `createExtractFn` turn and asserts a hospitalisation answer
completes all seven outcome boxes, death included.

What this run *is* good for is the negative: **no surface regression.**
28 turns, 55 transcript turns, 0 double-renders, 0 template echoes, all
seven surface states, and the open-fields dialog still at 109. Every
screenshot is byte-identical to `runs/unit-100/` except `01-start.png` —
see below.

Real-model contact is a done-ness precondition for the round, not for this
PR: the round gate (#96, `docs/round-gate.md`) is where a build meets a
live extractor before Steve sees it.

## A note on `01-start.png`, and a correction

`01-start.png` differs from `runs/unit-100/`'s copy, and not because
anything on the Start surface changed. Next.js's dev-mode indicator
renders into a `nextjs-portal` element asynchronously, so it was present
in some captures and absent from others taken moments apart. That made the
Start screenshot vary **run to run on an unchanged build**, which means
PR #104's "exactly one of thirteen differs" claim was partly luck rather
than measurement.

`scripts/artifact-session.mjs` now hides that element before every
capture — it is tool chrome, not the product — and two consecutive runs of
the same build were verified byte-identical afterwards. From this artifact
on, a screenshot difference means a real difference.

## Still true, and still out of scope here

- Gated topics are still asked, and `date of this report` is still blank:
  both are part 2b (gates, lab-row overflow, ReportDate's export stamp).
- Ready still shows a PDF failure — `next dev` does not serve the Vercel
  Python function.
- The open-fields count is per field, not per fact (design.md's round-2
  curated Review rendering).
