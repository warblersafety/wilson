# wilson — secrets management and cost model

Scoped down from lucy's own `docs/SECRETS-AND-COSTS.md` (murmurpv/lucy) per
this repo's charter — "does not need production-grade infrastructure rigor
everywhere." Same underlying pattern, sized to what wilson actually has
today: no Vercel deploy, no production or preview traffic, one Anthropic
workspace actually in use.

## Secrets

**No secret ever lives in the repo, and no secret ever passes through
Claude's hands** — the same invariants lucy states, unchanged here. Steve
creates and places every key; Claude never reads, writes, or echoes a
secret value.

### Three workspaces created, one wired up

Mirroring lucy's `lucy-prod` / `lucy-nonprod` / `lucy-evals` split (one
Anthropic API key per spend bucket, same env var name everywhere,
different value per surface): Steve created `wilson-prod`,
`wilson-nonprod`, and `wilson-evals` as three separate Anthropic console
workspaces on 2026-08-22 (Issue #22's scoping conversation).

Only `wilson-evals` is actually wired into anything:

| Bucket | Workspace | Home | Status |
|---|---|---|---|
| **wilson-evals** | `wilson-evals` | GitHub Actions repository secret, `ANTHROPIC_API_KEY`, on `warblersafety/wilson` | **Wired up** — used by `.github/workflows/eval-extraction.yml` |
| **wilson-nonprod** | `wilson-nonprod` | (none yet) | Created, not yet placed — needs a Vercel project's Preview environment to scope it to |
| **wilson-prod** | `wilson-prod` | (none yet) | Created, not yet placed — needs a Vercel project's Production environment to scope it to |

wilson has no Vercel project yet, so there is nothing for the prod/nonprod
keys to meter — placing them is deferred to whenever that project exists,
not forgotten. When it does, follow lucy's own operator checklist: add
`ANTHROPIC_API_KEY` twice in the Vercel project's environment variables,
Sensitive, `wilson-prod`'s value scoped to Production and `wilson-nonprod`'s
to Preview.

### The development machine holds no key

Same practice as lucy: local dev is keyless by design.

- Everything deterministic — the Agenda, topic map, grounding validator,
  Assembly/Export, all unit tests and fixtures — runs with no API access.
- `src/lib/extract.ts`'s real `ExtractFn` needs a live key to do anything;
  without one, constructing an `Anthropic()` client either fails outright
  or a real call to it fails cleanly (typed error), same failure mode as
  any other missing-credential path in this account.
- The only place a real Sonnet 5 call happens today is inside a GitHub
  Actions run (`eval-extraction.yml`), where the runner injects
  `wilson-evals` into that job's environment only, for the duration of the
  job, and Actions secrets are write-only — no API or token, including
  Claude's, can read one back. Claude's iteration loop here is the same as
  lucy's: push code, read the job's report — never the key.

### Adjacent secrets

- **GitHub App token**: minted per-invocation by `scripts/gh_token.py`
  (Grant 4), scoped to the repositories/permissions the task actually
  touches. Not a standing secret at all — nothing to place or rotate here.
- **Vercel account/tokens**: not yet provisioned to anything; no Vercel
  project exists for this repo yet.
- **Patient/clinician data**: not a secret, but follows a stricter rule per
  `docs/design.md` — no server-side persistence, and once real calls exist,
  server logs must never contain transcript content, metrics only. This
  repo has no real clinical data in it yet at all (mock data only, per
  [[project_wilson_procurement_scope]] — the DPA/procurement question
  blocks real data, not mock-data development).

## Cost model

### Rate assumed

Claude Sonnet 5 (Extractor): **$3.00 / $15.00** per 1M input/output tokens
— the account's `claude-api` skill reference (cached 2026-06-24). Lucy's
own doc, dated 2026-07-27, named Sonnet 4.6 at the same rate; Sonnet 5 has
since superseded it as the current Sonnet-tier model, matching Issue #22's
scoping decision to match lucy's tier, not its specific point-release.

### What actually runs today

Exactly one thing spends money: `npm run eval:extraction`
(`eval-extraction.yml`), a **workflow_dispatch-only** live sweep of the
3-fixture corpus in `fixtures/extraction/cases.ts` against `wilson-evals`.
Deliberately no push or schedule trigger — matching the lesson lucy's own
doc records after a push-triggered eval workflow started billing on every
commit before anyone noticed. `npm run eval:dry` (every PR, via `ci.yml`)
makes no API calls at all — it validates the same fixtures structurally
against the real field manifest and prompt wiring.

The runner itself enforces a **$1.00 per-run ceiling** (`CEILING_USD` in
`scripts/eval-extraction.ts`), checked after every call, stopping the sweep
rather than exceeding it — a corpus-size guard, not a real forecast. With
only 3 small fixtures, one full sweep is expected to cost a small fraction
of a cent; there is no measured number yet because no live sweep has run
as of this unit's merge.

### Monthly budget

| Bucket | What lands here | Cap / alert |
|---|---|---|
| **wilson-evals** | Manual `eval-extraction.yml` runs | **$10 / $5** — Steve's decision, Issue #22, matching lucy's own evals cap as a starting point |
| **wilson-nonprod** | Nothing yet | n/a — not wired |
| **wilson-prod** | Nothing yet | n/a — not wired |

Re-baseline this section against `wilson-evals`' own console numbers once a
live sweep has actually run — same caveat lucy's doc carries for its own
pre-measurement estimates.
