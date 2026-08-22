# Design: wilson

## Stack

Reuse lucy's: Next.js/TypeScript frontend on Vercel, Python for the
PDF-filling piece. lucy already solved "structured record → filled
MedWatch PDF" for 3500B (`api/generate-pdf.py`, `scripts/fill-3500b.py`);
Form 3500 is the same kind of fillable-PDF problem for a sibling form. Same
org, same hosting, proven pattern — no reason found to deviate.

No server-side persistence, matching lucy: state lives client-side, Vercel
functions are pure in/out. Real reason, not just consistency-for-its-own-
sake — wilson touches patient-adverse-event data even when entered by a
clinician, and this keeps the same privacy posture lucy already committed
to.

"No server-side persistence" only covers app-level storage — it says
nothing about content sent to a model provider for the Talker/Extractor,
or captured in Vercel's own function/request logs, and neither of those is
"persistence" in the sense above even though both put PHI-bearing content
somewhere outside the app's control. Matching lucy's actual practice, not
just its persistence claim: model calls are server-side only, same
per-environment key-splitting as lucy's `SECRETS-AND-COSTS.md`, and
logging captures usage metrics (token counts) only, never request/response
bodies. **Open item, not yet resolved:** whether the model provider used
for wilson has a no-retention/no-training data processing agreement in
place is a procurement question for Steve, not something this design can
guarantee in code — same status as the exact Form 3500 field list, named
here rather than assumed solved.

## Architecture

**Principle carried over from lucy: code owns control flow and writes;
models produce proposals, never authoritative writes.** Where wilson
differs from lucy is *how much machinery that proposal step needs* — a
clinician states facts directly (drug, dose, dates, reaction), rather than
telling an ambiguous narrative a model has to mine for evidence.

| Component | Job | Writes record? |
|---|---|---|
| **Talker** | Converse: guide one topic at a time, plain language instead of raw form-speak — this is what makes wilson faster than the form itself, not just a re-skin of it | Never |
| **Agenda** | Deterministic field-state machine: track each field as `answered` / `unknown` / `declined`, decide what's next, tolerate partial completion — a clinician not having every fact on hand is a normal, expected path | State only |
| **Extractor** | Deterministic parsing/normalization of the clinician's direct answers into structured field values (dates, drug names, dosage formats) | Proposes only |
| **Suggestion layer** | Once a medical coding database is available: surface a handful of candidate codes/classifications | Never — advisory only, kept out of the record until a clinician explicitly accepts a candidate |
| **Assembly/Export** | Deterministic mapping from the structured record to the Form 3500 PDF | Deterministic |

lucy's quote-provenance validator (checking each extracted field against a
literal transcript quote) is not carried over wholesale — but it is not
simply dropped either. The Talker never resolves a clinician's answer into
a structured value itself; that interpretation happens at the Extractor,
and the Extractor's proposal is checked against the specific conversation
turn it came from before being treated as accepted — lighter than lucy's
literal quote match (clinicians phrase things referentially: "the water
pill," "about a week before"), but still a real grounding check against
what was actually said, not a bare claim the model can silently invent.
Deterministic format validation (valid date, known drug string) alone was
not sufficient — it verifies shape, not correspondence to the
conversation, and that's the gap lucy's validator existed to close.

**Suggestion acceptance is an explicit, separate action — never a
default.** No candidate is ever pre-selected; a suggestion field starts
empty regardless of ranking. Accepting a candidate requires a distinct
affirmative action, never bundled into generic wizard-advance (e.g.
"Next"). Once accepted, the field stays visually distinguished from a
clinician-entered value through review and export — the clinician always
sees which fields came from their own answer versus an accepted
suggestion. This exists specifically to prevent a technically-compliant
build where a pre-filled top suggestion plus "Next" reads to the clinician
as settled fact rather than a choice they made.

**Review-stage edits re-enter the same pipeline, not a side door.** The
charter's end condition requires the clinician be able to edit any field
after reviewing the generated PDF. An edit at that stage is not a raw
patch onto the record: it re-enters Extractor validation (format/grounding
as applicable) and triggers PDF regeneration, the same as an edit made
during the original conversation. There is no write path to the record
that skips validation, including the one closest to the FDA-bound
artifact.

## Data shape

The record groups fields by the form's own section structure, pinned
against the actual current FDA 3500 PDF
(`fda.gov/media/76299/download`, confirmed current — filename
`FDA_3500_Stat_Sec_Ext_09-15-2025.pdf`). This supersedes the
search-derived list originally stated here, which was wrong, not just
incomplete: it named four groups (Reporter/Patient/Event-Problem/Suspect
Product) and misidentified Section C as Suspect Products. The form
actually has seven sections: **A. Patient Information**, **B. Adverse
Event, Product Problem (or Product Use Error)**, **C. Product
Availability**, **D. Suspect Products**, **E. Suspect Medical Device**,
**F. Other (Concomitant) Medical Products**, **G. Reporter**. Full
field-level enumeration lives in `src/lib/form-3500-fields.ts`, built and
structurally tested against this same PDF. How these seven sections group
into the Talker's conversation flow is a later unit's decision, not this
one's.

Every field carries a **state**, not just a value — `answered` / `unknown`
/ `declined` — directly supporting the Agenda's tolerance for incomplete
information. Suggested/candidate codes from the suggestion layer live
separately from the record itself; a field's real value is only ever set
by an accepted answer or an explicitly accepted candidate, never by the
suggestion layer writing through.

## Main structural risks

- **PDF field-mapping correctness** — same top risk lucy identified for
  its own Assembly/Export. Needs a fixture corpus and tests proving the
  mapping, per the charter's test floor.
- **In progress, on Issue #3.** The Form 3500 field list is being pinned
  in `src/lib/form-3500-fields.ts` against the current, authoritative FDA
  PDF; not yet in the tree as of this commit. The section-level structure
  is corrected already (see Data shape above) — the original draft of
  this document got it wrong, not just under-specified below the section
  level, as assumed here previously.
- **The coding database doesn't exist yet.** v1 either ships without the
  suggestion layer or stubs it; either way, nothing about the record's
  correctness should depend on it existing.
- **Keeping "advisory, not authoritative" honest in the actual UX**, not
  just in this document — the charter's review-depth conclusion weights
  this heavily. Addressed above (no pre-selected candidates, acceptance is
  a distinct action, accepted suggestions stay visually distinguished),
  but it's the first unit's job to prove the built UI actually matches
  this, not just the design.
- **Model-provider data handling for PHI-bearing content is not yet
  resolved.** Server-side-only calls and metrics-only logging are decided
  above; whether the provider carries a no-retention/no-training
  agreement is a procurement question for Steve, open until resolved.
