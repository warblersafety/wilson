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
writes). We do not have access to a medical coding database yet (e.g. for
MedDRA-style reaction coding likely asked on the form); once available,
wilson may surface a handful of suggested candidates to speed the
clinician up, but it must never assert or imply an authoritative
classification.

**Review-depth conclusion:** this isn't throwaway — it's real clinical
adverse-event data headed toward an FDA submission — but the clinician
sign-off before anything is sent is the load-bearing safety control, not
wilson's own correctness. The risk that matters is a bug that *silently*
mis-fills a field, drops data, or lets a suggestion read as more
authoritative than "just a suggestion" — not "a bug means bad data reaches
FDA unreviewed," since nothing reaches FDA without a human reviewing it
first. Review effort should weight PDF field-mapping correctness and
honest framing of any AI-assisted suggestions heavily; it does not need
production-grade infrastructure rigor everywhere.

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
answer through the conversational/wizard interface, see any coding/
classification suggestions clearly marked advisory-only, review a
correctly field-mapped Form 3500 PDF generated from the interaction, edit
any field, and export it. Proven by tests covering (a) PDF field-mapping
correctness against a fixture corpus, and (b) that no suggestion ever
reaches the record as an authoritative write without going through
review.

The lucy handoff and multi-user workflow are explicitly out of this end
condition — see Non-goals.
