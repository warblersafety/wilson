# Charter: wilson

## What this is, and why

wilson is a peer to [lucy](https://github.com/murmurpv/lucy), which lives
in the MurmurPV org — wilson itself lives in `warblersafety`, a deliberate
separation, not an oversight. Both submit adverse drug reaction reports to
the FDA; lucy is conversational patient intake, wilson is the equivalent
for clinicians.
Where lucy produces a MedWatch 3500B-style patient record, wilson targets
**Form FDA 3500** — the healthcare-professional voluntary MedWatch report.

The goal is to make reporting for the clinician as fast and friction-free
as possible.

## Who uses it, and how

A clinician, working alone, originates an adverse-event report from
scratch — not derived from any prior patient submission. The interaction
model leans conversational, following lucy's lead, but this is open to
change once the design conversation gets into specifics; a clinician
already knows the clinical facts in structured terms, unlike a patient
telling a narrative, so the right shape may differ from lucy's.

Environment: hosted on Vercel, like lucy. Anticipated load is light —
individual clinicians, not sustained high-volume traffic.

## Intended use and failure consequences

wilson is positioned as an aid, not a diagnostic or classification
authority. The clinician is expected to review and sign off before
anything is submitted — that review is the actual safety boundary, the
same trust boundary lucy uses (models produce proposals, code/humans own
writes). **wilson v1 has no coding/classification suggestion feature at
all** — cut, not stubbed (decided 2026-08-22, superseding this
section's prior framing): no candidate product/diagnosis/lab/device
suggestions are surfaced to the clinician anywhere in v1. See Non-goals
for what that decision does and doesn't rule out for later.

**Review-depth conclusion:** this isn't throwaway — it's real clinical
adverse-event data headed toward an FDA submission — but the clinician
sign-off before anything is sent is the load-bearing safety control, not
wilson's own correctness. The risk that matters is a bug that *silently*
mis-fills a field or drops data — not "a bug means bad data reaches FDA
unreviewed," since nothing reaches FDA without a human reviewing it
first. Review effort should weight PDF field-mapping correctness heavily;
it does not need production-grade infrastructure rigor everywhere.

## Non-goals (for now)

- **The lucy → wilson case-processor handoff** (wilson receiving a
  patient-submitted record from lucy for clinician completion). lucy's own
  design doc defers this same integration — "versioned contract deferred
  until that integration is scheduled" — for the same reason: the process
  isn't understood well enough yet to design the contract. Likely future
  work, not forgotten, just not this charter.
- **Multi-user / shared clinic workflow** (multiple staff, shared
  records). Starting with single-clinician, self-service use; broadening
  to a hospital/clinic workflow is future scope if single-user proves out.
- **Coding/classification suggestions (the "Suggestion layer").** Not
  deferred pending procurement — cut from v1 as a deliberate scope
  decision; reopening it needs a new charter conversation, not just a
  design.md update. This supersedes an earlier, narrower framing that
  only excluded MedDRA: research (`docs/coding-databases.md`) found a
  free, mostly self-hostable data-source stack that would have made a
  Suggestion layer buildable without MedDRA, but Steve decided against
  building one for v1 regardless of source. MedDRA itself remains
  excluded from wilson's scope entirely even if this is revisited later —
  it has no discounted licensing tier for a vendor building a product
  around it, and Form 3500 has no field that accepts a code anywhere for
  it to fill even if licensed.

## Test floor

No blanket coverage-percentage gate — lucy already worked out a shape that
fits this kind of deterministic-logic-plus-LLM-suggestion system better,
and wilson reuses it: every unit's frozen acceptance criteria maps to a
concrete proof artifact (unit test, fixture suite, eval-dry structural
check, e2e, or an explicit manual-check note), mechanically enforced in CI
via typecheck/test/build jobs. Any model-touching eval suites get a free
"dry" structural check (no API calls, runs every PR, validates corpus/
vocabulary/wiring) with live sweeps as a separately-triggered job — same
split lucy uses for its triage and conversation evals.

## End condition (v1, falsifiable)

A clinician can originate an adverse-event report end-to-end in the app:
answer through the conversational/wizard interface, review a correctly
field-mapped Form 3500 PDF generated from the interaction, edit any
field, and export it. Proven by tests covering PDF field-mapping
correctness against a fixture corpus.

The lucy handoff, multi-user workflow, and coding/classification
suggestions are explicitly out of this end condition — see Non-goals.
