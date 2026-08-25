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
differs from lucy is degree, not kind: a clinician's input — including
the opening dictation the interaction-model section below is built on —
is still a narrative the Extractor mines for evidence, but it states
facts in clinical shorthand (drug, dose, dates, reaction) with far less
ambiguity than a patient's story, so the proposal machinery is lighter,
not absent. (An earlier revision of this paragraph claimed clinician
input wasn't narrative at all — the premise behind the "deterministic
parsing" Extractor this document used to describe, corrected 2026-08-25.)

| Component | Job | Writes record? |
|---|---|---|
| **Talker** | Converse: guide one topic at a time, plain language instead of raw form-speak — this is what makes wilson faster than the form itself, not just a re-skin of it | Never |
| **Agenda** | Deterministic field-state machine: track each field as `answered` / `unknown` / `declined`, decide what's next, tolerate partial completion — a clinician not having every fact on hand is a normal, expected path | State only |
| **Extractor** | Model-backed extraction of structured field values (dates, drug names, dosage formats) from the clinician's words, grounded against the conversation before anything is accepted (see below) | Proposes only |
| **Assembly/Export** | Deterministic mapping from the structured record to the Form 3500 PDF | Deterministic |

wilson v1 has no Suggestion layer — cut, not stubbed (charter Non-goals,
decided 2026-08-22, Issue #27). This table previously carried a
Suggestion layer row describing candidate product/diagnosis/lab/device
matches sourced from `docs/coding-databases.md`'s free data stack;
that research stays valid as reference, but no component here builds
against it for v1.

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

**Review-stage edits re-enter the same pipeline, not a side door.** The
charter's end condition requires the clinician be able to edit any field
after reviewing the generated PDF. An edit at that stage is not a raw
patch onto the record: it re-enters Extractor validation (format/grounding
as applicable) and triggers PDF regeneration, the same as an edit made
during the original conversation. There is no write path to the record
that skips validation, including the one closest to the FDA-bound
artifact.

## Interaction model and UI (decided 2026-08-25)

The charter left the interaction model provisionally conversational,
"open to change once the design conversation gets into specifics." That
conversation happened 2026-08-25, working from Noah's mockups (`Wilson
voice reporting UI mockups.zip`, repo root — a Claude Design canvas
grounded in this repo's actual machinery: the 227-field manifest, the
topic map, the `answered`/`unknown`/`declined` field states, the repeat
decision) and from lucy's shipped UI. This section records the outcome;
the v1 wizard it replaces was never pinned down in this document, which
is how it shipped as a bare form-walker no clinician would prefer over
the paper form.

**The shape: dictation-first, then targeted follow-ups.** lucy walks a
patient through their story turn by turn because a patient needs
eliciting; a clinician already knows the clinical facts, so wilson's job
is to *receive* them fast and ask only for what's still missing. The
flow is six surfaces:

1. **Start** — two pinned questions (chosen to fill the most fields:
   suspect product + reaction; timing + outcome) above one large
   free-text composer the clinician dictates or types into. No separate
   landing page; this is the landing.
2. **Read-back** — the narrative shown back with each proposal's
   **supporting quote** highlighted inline (inline-highlight treatment,
   chosen over gutter-mapping and value-chips: prose first, nothing to
   learn), beside a "what I'd write from this" panel listing every
   proposed field. The highlight marks what the clinician *wrote*; the
   panel pairs it with the value wilson would *write down* — for
   referential phrasing ("admitted her overnight" → Outcome:
   Hospitalization) the value was never in the text, and the pairing
   must present it as a reading of the quote, never as if the value
   itself appeared in the prose. A proposal whose quote can't be
   uniquely located still appears in the panel — the panel, not the
   highlighting, is the complete list. **Nothing is written to the
   record until the clinician confirms here**; edits to the narrative
   re-enter extraction, never patch the record. Confirmation applies the
   accepted proposals through the same Agenda write path as any answer.
3. **Follow-ups** — the existing topic-at-a-time loop (bundled fields,
   max three per ask), now with the conversation transcript visible
   (wilson already accumulates it; v1 never rendered it). **Field asks**
   carry the full answer grammar — answer / "I don't have that" /
   "rather not say" — because fields have `unknown` and `declined`
   states to write. **Repeat decisions** ("Was there another suspect
   product?") write a count, where "decided" means *confirmed not to
   exist* for every instance beyond it — the group's remaining slots
   are skipped and the question is never re-asked. Their chips are
   **yes / no** — never an uncertainty chip, which would have nothing
   valid to write and would silently convert "I don't know" into
   "confirmed none," foreclosing products on an FDA report (doc-review
   on the amendment PR, finding 2; representing that uncertainty needs
   machinery, not copy — filed as follow-up intake, not smuggled into a
   UI unit). For a group with more than two slots (concomitant
   medications: ten), yes/no alone is lossy the same silent way — a
   bare "yes" writing 2 drops medications 3+ with no further ask
   (reviewer pass, same PR) — so there "yes" leads to a deterministic
   count follow-through: "how many in total?" as choice chips where
   every option is a valid total to write. The chip grammar must be
   able to carry every count v1's free text could; the rebuild is never
   allowed to be lossier than what it replaces. Enum/checkbox fields use widget
   sections in lucy's chip grammar (yes/no, choice, always-present
   "not sure" and "skip"); raw manifest strings and PDF `/Opt` codes
   never reach the clinician.
4. **Review** — field-led sectioned cards (form sections A–G), every
   topic editable; an edit reopens the topic as a normal question
   (the existing reopen path). The rendered Form 3500 PDF stays one
   click away rather than leading the layout — legible values and
   obvious gaps beat pen-sized paper for editing; the paper is there
   for trust. (Chosen over paper-led review.)
5. **Open fields** — what's still `unknown` or unasked, listed with its
   reason, each answerable from here; "file as it stands" always
   available. A partial report is a valid report; this surface nudges,
   it never gates.
6. **Ready** — honest completion: the filled PDF to download,
   answered/unknown/declined counts, and the reminder that wilson
   stores nothing on its own servers, so the download is the
   clinician's copy — phrased within the privacy copy rule below: it is
   a claim about wilson's storage, never about the model-provider path.
   **No submission claims**: wilson fills and exports the form, like
   lucy; there is no MedWatch e-submission pipeline, so no "filed with
   FDA" language and no confirmation numbers anywhere in the UI.

**Voice: wilson owns no microphone.** Dictation is the device's own
keyboard feature (iOS/macOS/Android/Windows all provide it), typed into
the composer like any text. Consequence, and the copy rule that follows
from it: the app never receives audio, so the UI may say "wilson never
hears your voice — dictation happens on your device, and only text you
approve is sent," and must never claim on-device *processing* (whether
the OS transcribes locally or in its vendor's cloud varies by platform
and is the clinician's device posture, not ours). An app-owned
push-to-talk mic (the mockups' docked-bar treatment) is possible later
work if OS dictation proves too fiddly — it would reopen the audio
data-flow question alongside the provider-DPA item above, so it is a
deliberate non-goal this round.

**Privacy copy tells the whole data path.** Submitted text — the
narrative and every follow-up answer — is processed by wilson's model
provider server-side, and whether that provider carries a
no-retention/no-training agreement is the open procurement item in Main
structural risks. Until it is resolved, no clinician-facing copy may
state or imply that submitted text is unseen or unretained by third
parties: "wilson keeps nothing" claims must be explicitly scoped to
wilson's own storage, and the start surface's privacy line must say
plainly that submitted text is processed by wilson's model provider.
The audio rule above is the same principle — copy claims exactly what
the machinery delivers, nothing more.

**Extraction scope.** The opening narrative is extracted against the
full topic map — that pass (new; v1's extractor is scoped to the
current ask's fields) is what makes dictation-first work. Two decisions
inside it, both made here rather than left to the implementing unit:

- **Fixed-choice fields are in scope for the narrative pass.** v1's
  validator hard-rejects every checkbox/enum candidate
  (`not_extractable_field_type`) — 91 of the 227 fields, including the
  entire outcome block. Carrying that exclusion into dictation-first
  would make "admitted her overnight" fill the dates but silently never
  the Hospitalization checkbox: an internally inconsistent form, the
  exact silent-mis-fill class the charter weights heaviest. So the
  narrative pass proposes fixed-choice fields too, under a tighter
  contract than free text: a proposal must name one of the field's
  legal options (checked mechanically against the manifest) *and* carry
  a supporting quote. Whether the quote really means that option
  ("admitted overnight" → Hospitalization) is exactly what the
  read-back pairing exists to put in front of the clinician.
- **The grounding check is named for what it is.** The validator
  verifies the cited quote exists in the clinician's words — presence,
  not semantic correspondence; its own header concedes a bad extractor
  could cite a real but unrelated quote for a fabricated value. v1's
  citation pool was one short answer; a full narrative widens it, and
  this design accepts that scale-up **because the read-back confirm
  step is the correspondence check**: every proposal is shown as
  value ← quote before anything is written, and the confirmation is by
  the clinician whose sign-off the charter already names as the
  load-bearing control. The narrative-extraction fixture corpus must
  include the real-quote/fabricated-value case so the failure mode
  stays visible in CI rather than theoretical.

Follow-up turns stay scoped to the ask they answer, matching v1's cost
posture; the mockups' "answer several topics at once and I'll sort
them" affordance for follow-ups is deferred until someone checks what
full-manifest prompts per turn cost with caching.

**Design system.** The warbler-safety tokens, transcribed verbatim from
warblersafety.com — the same system lucy ships as `brand-tokens.css`
and the same one Noah's mockups use. wilson takes its designated accent
(`--accent-wilson`, teal) where lucy takes the yellow. Fonts are Hanken
Grotesk (body) and Schibsted Grotesk (display), OFL-licensed, self-
hosted like lucy's. The palette deliberately contains no error/danger
color (the marketing site never needed one); wilson must invent one and
record the choice in its tokens file.

**Explicitly rejected**: the mockups' single-screen "density console"
(transcript, questions, and paper in one screen, sign-off in the
header) — it makes the read-back moment skippable, and the clinician's
sign-off is the charter's load-bearing safety control; the surfaces
exist to walk through it, not around it.

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
information.

## Main structural risks

- **PDF field-mapping correctness** — same top risk lucy identified for
  its own Assembly/Export. Needs a fixture corpus and tests proving the
  mapping, per the charter's test floor.
- **Resolved.** The Form 3500 field list (227 fields) is pinned in
  `src/lib/form-3500-fields.ts`, built and structurally tested against
  the current, authoritative FDA PDF. That work also corrected the
  section-level structure itself, which the original draft of this
  document got wrong (see Data shape above) — not just under-specified
  below the section level, as assumed here previously.
- **Resolved as a non-issue, 2026-08-22 (Issue #27).** Issue #24's
  research into coding-database sourcing (see `docs/coding-databases.md`)
  found a free, mostly self-hostable source stack that would have made a
  Suggestion layer buildable without MedDRA. Steve then decided wilson v1
  ships with no Suggestion layer at all, regardless of source (charter
  Non-goals) — so the licensing/ownership questions that research
  surfaced (RxNorm/SNOMED/UMLS's annual UTS report) aren't live risks for
  this repo right now. `docs/coding-databases.md` stays as reference for
  if a Suggestion layer is ever built later, not a current obligation.
- **Model-provider data handling for PHI-bearing content is not yet
  resolved.** Server-side-only calls and metrics-only logging are decided
  above; whether the provider carries a no-retention/no-training
  agreement is a procurement question for Steve, open until resolved.
