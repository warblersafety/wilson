# wilson

Clinician-facing tool for voluntary FDA adverse-drug-reaction reporting
(Form FDA 3500) — peer to lucy (murmurpv/lucy, patient-facing, Form
3500B). wilson itself lives in the `warblersafety` org, not `murmurpv`.

Charter: [docs/charter.md](docs/charter.md) — read it first; it states this
project's intended use and its own conclusion on review depth, which governs
review scaling everywhere below. Process origin: smansf/sofa-claude (copied at
bootstrap 2026-08-21; this repo owes it nothing).

Standing handoff: Issue #1 — `/onboard` reads it, `/wrap-up`
refreshes it.

## Branches and deploys

- `dev` — Claude's trunk. Feature branches `claude/*` PR into `dev`. Claude
  merges **only via `python3 scripts/merge_dev.py <PR>`**, which refuses
  unless CI is green, a fresh-context reviewer pass (one round, scaled to
  the charter's stated review-depth conclusion) is posted as a PR comment
  starting `## Reviewer pass`, the base is `dev`, and the PR isn't a draft.
  Merging any other way is a defect, not a shortcut. `dev`
  is the repo's default branch, so unit issues auto-close on merge. Open
  every PR at the first push, draft while review and fixes are in
  progress; ready means merging is the only step left.
- `staging` — human-facing preview. Steve promotes `dev → staging` via a
  promotion PR that Claude prepares — the same rules apply to every
  promotion PR, `staging → main` included (see `main` below): a plain
  summary, a title describing the whole rollup rather than inherited
  from whichever unit happened to merge last, and **opened as draft**
  (`gh pr create --draft` — opening one ready is a defect, not a
  shortcut). Steve flips ready and merges after spending whatever
  review depth he chooses; Claude never flips a promotion PR to ready,
  so for promotion PRs the ready flip is itself the record that Steve
  decided — review run or skipped, since everything in it already
  passed its own review individually on the way into `dev`. When his
  review lane returns zero findings, the session that observed the run
  records that outcome as a PR comment quoting the tool's summary — an
  observed result, never an invocation or replication of his lane;
  absent both findings and a record comment, the review is treated as
  not yet run. Vercel preview deploy is wired: every push to `staging`
  deploys automatically, gated behind Vercel Authentication like every
  other preview URL.
- `main` — production. Steve promotes `staging → main` the same way as
  `dev → staging` above — a promotion PR Claude prepares and drafts,
  never flips to ready. Vercel production deploy is wired: every push
  to `main` deploys automatically and is publicly visible (Hobby plan
  protects preview URLs only, not production).
- **Before preparing the first promotion PR**, confirm `gh repo view --json
  deleteBranchOnMerge` reports `false`. A promotion PR's head *is* a
  long-lived branch, so with the setting on, merging `staging → main`
  deletes `staging`. If it reports `true` the promotion waits: it is a
  needs-Steve item (Settings → General, ~15 s), and `scripts/merge_dev.py`
  already deletes unit branches itself, so nothing here needs the setting.
  Protected `staging`/`main` are exempt from that deletion, but see the
  next line before assuming they are protected at all.
- **Branch protection in this repo: PROCESS-ONLY, not enforced by GitHub.**
  `wire_repo.py` verified both paths on 2026-08-21 and both failed: a
  direct push to `main`/`staging` was **accepted** (not refused by rules),
  and the rulesets API returned 403 on both branches — free-plan rulesets
  cover **public** repos only, and this repo is private (org-level
  rulesets need GitHub Enterprise). The human-only-merge rule on
  `staging`/`main` rests on process alone until this repo goes public or
  the org has Enterprise rulesets. Filed in the needs-Steve digest
  (smansf/sofa-claude#2).
- Deploy wiring lives in Steve's Vercel account (team `warblersafety`,
  covering wilson, lucy, and future apps). Only `staging` and `main`
  actually deploy, enforced by [vercel.json](vercel.json)'s
  `git.deploymentEnabled` — `dev` and unit branches build/test locally
  only. This isn't just tidiness: Vercel's Hobby plan refuses to
  deploy any commit not authored by the account owner on a private
  org-owned repo, which is every commit Claude pushes.
  `deploymentEnabled` stops Vercel from even attempting those
  branches, so the refusal never happens rather than needing to be
  tolerated downstream (a project-level Ignored Build Step was tried
  first and confirmed too late in Vercel's pipeline to help — it fires
  after that refusal, not before). `staging`/`main` deploy normally
  once Steve merges under his own GitHub identity, which satisfies
  that same rule. Claude
  holds a Vercel token only when Steve hands one over for a specific
  task — short-lived, never auto-minted the way GitHub's is (Vercel has
  no per-operation minting equivalent to `gh_token.py`), stored locally,
  never committed. See
  [docs/SECRETS-AND-COSTS.md](docs/SECRETS-AND-COSTS.md) for the current
  secrets shape. Claude never merges to `staging` or `main`.
- Every GitHub call from this repo — `scripts/merge_dev.py`, or a
  session's own `gh` — runs under a short-lived App token minted by
  `scripts/gh_token.py`, scoped to the repositories and permissions the
  task actually touches — usually this repo (`python3 scripts/gh_token.py
  --account <owner> --repos <name> --perm contents=read -- gh ...`); the
  needs-Steve digest write is the standing exception (`--account smansf
  --repos sofa-claude --perm issues=write`). There is no ambient fallback:
  if minting fails, that work stops and the cause goes to the needs-Steve
  digest; never retry under another credential, and never `gh auth
  login`. This repo requires no PAT of its own.
- Promote often: a `dev` far ahead of `staging` makes promotion scary
  instead of routine. Claude flags when the gap exceeds ~10 units.

## Units of work

- One issue per unit, filed with the **Unit issue form** (the web form
  requires acceptance criteria; a `gh`-filed unit must carry the same
  sections); criteria are frozen before code. Done = merged to `dev`.
  No unit reopens; follow-ups are new intake.
- TDD: failing test first, then code. CI enforces the charter's **test
  floor** — every unit's frozen acceptance criteria maps to a concrete
  proof artifact (unit test, fixture suite, eval-dry structural check,
  e2e, or an explicit manual-check note); no blanket coverage percentage
  — a floor to hold, never a number to climb. The
  floor takes whatever shape the charter's subject actually has (a coverage
  percentage, fixture-corpus completeness, a property suite); it must be
  mechanically checkable by CI, and a shape that forces a fake number is the
  wrong shape.
- Discovered work, first triage: fix in flight only what blocks the unit or
  is a trivial defect in code already being touched (capped at trivial —
  wants design ⇒ file it). Everything else real is filed silently, at any
  severity; observations with no statable harm scenario are not filed.
- Second triage, on the issue: `urgent` (interrupts current work), `keep`
  (never expires), or unlabeled (default — auto-expires after 14 days
  untouched). Tier, and whether it needs a spec, is judged at pickup.
- Review: the `dev` rule above. Amendments to `docs/charter.md` or
  `docs/design.md` additionally take a `doc-review` pass (operator
  toolbox). Promotion PRs hand Steve the paste-ready
  `/code-review <effort> <PR URL> --comment` command and confirm its
  findings — or the zero-finding record — actually landed on the PR.

## Never

- Merge to `staging` or `main` — those are Steve's promotions, always.
- Add process machinery here. Process problems are sofa-claude bleeds:
  note the incident, raise it there, keep building the product.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
