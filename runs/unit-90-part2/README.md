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
gets none, plus the two multi-selects that deliberately complete nothing)
and by an end-to-end test in `src/lib/extract.test.ts` that drives a real
`createExtractFn` turn and asserts a hospitalisation answer completes all
seven outcome boxes, death included.

Nor does it show Review's new "No" rendering for an answered-false
checkbox: the scripted walk dismisses everything as `unknown`, so it
produces no answered falses at all. `review.test.ts` covers it.

What this run *is* good for is the negative: **no surface regression.**
28 turns, all seven surface states, 0 double-renders, 0 template echoes,
the open-fields dialog still at 109. The evidence for that is
`session.txt`, which is **byte-identical to `runs/unit-100/session.txt`** —
every ask, every transcript turn, and every later surface's rendered text,
unchanged.

Real-model contact is a done-ness precondition for the round, not for this
PR: the round gate (#96, `docs/round-gate.md`) is where a build meets a
live extractor before Steve sees it.

## The screenshots are NOT comparable to `runs/unit-100/`, and a correction

**All thirteen** differ from `runs/unit-100/`'s copies — each about 1.7 KB
smaller at identical dimensions. Nothing on any of those surfaces changed:
this PR's own driver change is the cause. Next.js's dev-mode indicator
renders into a `nextjs-portal` element asynchronously, and
`scripts/artifact-session.mjs` now hides it before every capture, because
it is tool chrome rather than the product.

That same asynchrony is why `01-start.png` had been varying **run to run
on an unchanged build** — which means PR #104's claim that "exactly one of
thirteen differs" was partly luck rather than measurement, and this
README's first version repeated the error in the other direction by
claiming twelve were identical. Both are corrected here.

Two consecutive runs of this build were verified byte-identical
afterwards, and the screenshots here match the run made before this PR's
review round. From this artifact on, a screenshot difference means a real
difference; comparisons that straddle the dev-chrome change do not mean
anything and `session.txt` is the honest instrument across it.

## Still true, and still out of scope here

- Gated topics are still asked, and `date of this report` is still blank:
  both are part 2b (gates, lab-row overflow, ReportDate's export stamp).
- Ready still shows a PDF failure — `next dev` does not serve the Vercel
  Python function.
- The open-fields count is per field, not per fact (design.md's round-2
  curated Review rendering).

> **Note (unit #96).** `scripts/artifact-session.mjs` and
> `scripts/artifact-seed.ts` no longer exist — they were replaced by
> `scripts/gate-case-driver.mjs`, which walks Start through Ready with
> typed turns as well as chips (`CASE=C1`). This file records what was
> run at the time; the reproduce instructions above are historical.
