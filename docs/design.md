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

**The mockup screens are the layout authority (added 2026-08-25, after
the chips build).** This section records interaction decisions and
deviations; it is a synthesis, never a substitute for opening the
screen. The seven flow screens are committed at
`docs/mockups/screen-01.png`–`screen-07.png` (rendered from the
repo-root zip, which stays the source): 01 Start · 02 Recording (n/a —
wilson owns no microphone, below) · 03 Read-back · 04 Follow-ups ·
05 Review · 06 Open fields (a dialog over Review, not a separate page) ·
07 Ready (honest reframe of the mockup's "Filed" — no submission
claims, below). Two precedence rules complete the authority (added in
the amendment's own review round). **Recorded copy rules override
mockup copy everywhere**: the mockups carry filing and storage claims
the rules below ban — screen 01's "before it is filed", 05's "Sign off
and file", 06's "this never blocks filing" / "File as it stands", 07's
whole filing receipt, and the chrome's "Nothing stored" badge and
"Filed" terminal state — and every one of them takes the honest
vocabulary instead; layout authority covers structure and interaction,
never copy that violates a recorded rule. **Recorded interaction rules
override mockup widgets where a deviation is recorded here**: screen
04's repeat-decision moment shows "I don't know" / "Rather not say"
chips — excluded (yes / no only, below; #47 tracks the uncertainty
machinery gap); screen 03's "inferred" badge on a derived value is not
built — every proposal is presented as a reading of its supporting
quote (the Read-back pairing rule), never as a bare inference. Binding
consequences, learned from Issue #44: a UI unit's spec names the
screen(s) it implements and enumerates its intended deviations with
reasons before its criteria freeze; its PR's manual-check note
includes a side-by-side of the built surface against the named screen;
its reviewer pass states fidelity or lists deviations. Extended
2026-08-26, after per-surface side-by-sides passed a build whose
assembled product Steve rejected: a UI or conversation unit's PR
additionally carries a **full-session artifact** — the complete
transcript and a screenshot of every surface state a scripted
end-to-end run traverses — and its reviewer pass reads that session
as a user, against the charter's own bar (would a clinician prefer
this to the paper form?), before reading the diff. The rule binds
units filed or amended after this amendment; #42 (Start) and #43
(Read-back) merged before it — their composition gap against screens
01/03 is the chrome unit's scope (#67), and each takes its fidelity
side-by-side the next time its surface changes. Recorded, reasoned
deviations are first-class — this section is full of them — silent
divergence, in either direction, is the defect.

**Scope of that authority, narrowed 2026-08-26 (the second rejected UI
build).** The canvas is the authority for composition and look only.
It is a happy-path pitch render: a handful of hand-written example
questions for a product whose manifest forces dozens, no
checkbox-heavy topics, no error/empty/repeat states — so "fidelity to
the canvas" is unfalsifiable exactly where a build lives or dies, and
its look lives in hand-tuned inline styles its own token file does not
carry. Question text, ask coverage, field disposition, and every other
clinician-facing string are governed by `docs/ask-copy.md` (the ask
copy contract below); where the canvas shows or implies copy or
coverage, the contract wins, the same way the recorded copy rules
already do.

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
3. **Follow-ups** — the topic-at-a-time loop (authored asks per
   `docs/ask-copy.md`), now with the conversation transcript visible
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
   allowed to be lossier than what it replaces. **Fixed-choice
   (checkbox/enum) fields are ordinary conversational asks** (decided
   2026-08-25, Issue #44): bundled into topic asks like any other
   field, answered by dictation or typed text, extracted under the
   same fixed-choice contract the narrative pass carries — the
   proposal names one of the field's legal options, checked
   mechanically against the manifest, and cites a supporting quote.
   They are never a persistent widget panel: screen 04 is a single
   conversational thread, and a standing checkbox/enum section appears
   on no screen. (An earlier version of this sentence prescribed
   "widget sections in lucy's chip grammar" — a synthesis error that
   reached a build before it was caught; lucy's widget grammar fits
   lucy's turn-by-turn eliciting of a patient, not wilson's
   dictation-first receiving from a clinician.) The one-tap "I don't
   have that" / "rather not say" affordances remain on field asks —
   deterministic `unknown`/`declined` writes, no model call.
   Consequences in the existing machinery, all in scope for the
   implementing unit: `nextStep()`'s text/date-only filter and its
   skip of all-fixed-choice topics (today the dechallenge/rechallenge
   blocks and the reporter section are never asked at all) are
   superseded; the per-turn validator's `["text","date"]` default no
   longer applies — the per-ask path takes every field type, as the
   narrative pass already does; and `reopenTopic()` reopens
   fixed-choice fields too — the widget that made them "directly
   editable in place" no longer exists, so the conversational re-ask
   is their only edit path, and without it an answered-but-wrong
   checkbox would be permanently uncorrectable. Raw
   manifest strings and PDF `/Opt` codes never reach the clinician —
   a rule the v1.1 build violated on three surfaces because it had no
   mechanism; it is now carried by `docs/ask-copy.md`'s display-name
   layer and enforced by the UX floor's CI checks.
4. **Review** — field-led sectioned cards (form sections A–G), every
   topic editable; an edit reopens the topic as a normal question
   (the existing reopen path). The rendered Form 3500 PDF stays one
   click away rather than leading the layout — legible values and
   obvious gaps beat pen-sized paper for editing; the paper is there
   for trust. (Chosen over paper-led review.)
5. **Open fields** — what's still `unknown` or unasked **and actually
   answerable**, listed with its reason, each answerable from here;
   "file as it stands" always
   available ("finish as it stands" in the built copy — the mockup's
   "File as it stands" takes the no-submission-claims vocabulary
   below). A partial report is a valid report; this surface nudges,
   it never gates. Presented as a dialog over the Review surface
   (screen 06), not a separate page — it is enumerated as a surface
   because it carries its own rules and state, not its own screen.
   *Amended 2026-08-27 (#101).* "Unasked" alone listed fields no
   clinician could act on, so this surface asks a narrower question:
   **is this field answerable now?** `ask-copy.md` decides, and the
   answer is not a single property. An auto field is determined, not
   open. A lab write-target row past LD-1's anchor is never
   independently open (rule 5). A conditional ask whose condition does
   not hold was never in play. And a derive companion is open only once
   the fact it hangs off has been ANSWERED — anchor state, not its
   disposition (rule 3): a stated bare weight makes lb/kg a live
   question, an age nobody gave makes its four unit checkboxes noise.
   Excluding companions by disposition instead was tried and rejected
   in review, because it also hid facts the asks voice out loud. Without
   any of this the dialog headed a 28-question session with "122 fields
   are still open", first four rows those very checkboxes, immediately
   before sign-off. A companion is visible on its anchor's Review row
   whether or not it is currently listed here.
6. **Ready** — honest completion: the filled PDF to download,
   answered/unknown/declined counts, and the reminder that wilson
   stores nothing on its own servers, so the download is the
   clinician's copy — phrased within the privacy copy rule below: it is
   a claim about wilson's storage, never about the model-provider path.
   **No submission claims**: wilson fills and exports the form, like
   lucy; there is no MedWatch e-submission pipeline, so no "filed with
   FDA" language and no confirmation numbers anywhere in the UI.

**The report chrome (recorded 2026-08-25; silently omitted by the
original synthesis).** Every mockup screen renders the six surfaces
inside one persistent frame: a left topic rail — nine curated
section/repeat-group rollup rows per the screens, not one row per
topic (the topic map has 34 entries; Suspect product #1's topics
collapse to one row, the ten concomitant slots to one), each row's
state (done, current, `unknown`, untouched) computed from its
constituent fields' actual states, never from `topicStatuses()`'
positional walk, which cannot express `unknown` and mis-reports
out-of-order fills under dictation-first — a right Form FDA 3500
facsimile filling live from field states: an HTML rendering derived
from the same field-mapping source the PDF exporter uses (one mapping
truth, with an equality test against exported values for the
reference case), labeled as a preview, honest about partial coverage,
and never itself the sign-off artifact (the real PDF stays
Review/Ready's on-demand artifact) — the patient banner ("Form FDA
3500 · draft · patient identifier"), and a status footer ("18 fields
written · 2 unknown — a partial report is a valid report"). Banner and
badge copy is subject to the privacy-copy rule below — the mockups'
"Nothing stored" pill overclaims while the DPA item is open. The first
version of this section dropped the chrome without recording a
decision — the same silent-synthesis defect as the widget-sections
sentence above. It is part of the decided model and builds as its own
unit (#67).

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

**Follow-up turns are mined for everything still open (decided
2026-08-25; supersedes the deferral that stood here; rules tightened
the same day by the amendment's own doc-review and reviewer passes).**
Every follow-up turn is extracted against the open field set — the
ask's own fields first (prompt ordering only, never conflict
precedence), plus anything the clinician volunteered beyond them
("stopped the 19th, and she's also on lisinopril") — the mockups'
"answer several topics at once and I'll sort them" affordance.
Maximum information per interaction is the principle: the clinician's
words are the expensive resource, and sorting them into the record is
the model's job, never the clinician's. The rules, each carrying a
deterministic unit test in the implementing unit's frozen criteria:

- **Open means state `unasked` or `unknown`** — deliberately wider
  than `isResolved()`'s `unasked`-only test that `nextStep()` and
  `narrativePassFields()` use; the widened pass carries its own
  predicate rather than reusing theirs. Repeat-instance 2+ slots are
  excluded from "open" on the reasoning `narrativePassFields` already
  records (cross-instance attribution is the charter's weighted risk):
  a volunteered later instance surfaces as a repeat-count proposal the
  clinician answers at the group's normal "was there another?"
  decision, and that instance's fields are filled by its own authored
  ask (suspect products) or the group's authored later-instance ask
  (concomitant medications — `docs/ask-copy.md` CM-2), never
  attributed by the sweep.
- **Writes follow the clinician's own state.** `unasked` fields the
  sweep writes directly, and every out-of-ask write is named in that
  turn's visible reply (field and value) and recorded in the
  transcript — no widened write is ever invisible. `answered`,
  `unknown`, and `declined` are clinician-established states the
  sweep never writes: a proposal targeting one becomes a **correction
  offer** in the reply ("you said 8/20 for therapy stop date — it's
  recorded as 8/19; replace it?"), one tap to accept (a deterministic
  write through the normal path, recorded in the transcript),
  ignorable without effect. The offer replaces the
  direct-apply-on-resolved behavior `talk.ts` documents today: an
  in-conversation correction still takes one turn, but it is
  confirmed, never silent — closing both silent paths at once (no
  machinery overwrite of an explicit answer, "I don't have that," or
  refusal; no silent drop of a volunteered correction either).
- **The citation pool is the current turn only, enforced in the
  validator (a turn-index constraint), never just the prompt.** The
  opening narrative is confirmed once, at Read-back, and is never
  re-mined by a later turn's sweep — otherwise a proposal the
  narrative pass missed (or the validator rejected) could re-enter
  turns later citing the narrative and be written with no read-back
  pairing, converting the read-back from a gate into something a
  later turn routes around. This is also #59's resolution, pinned
  here.
- **Within one turn, two proposals for the same field are a
  collision, not a sequence**: the turn writes neither and asks
  which — the same rule Read-back applies to same-field duplicates
  (#52).
- **Reopen semantics.** A Review edit reopens its topic for a normal
  re-ask (screen 05's per-section Edit). Reopened fields retain their
  prior values until a replacement is written — reopen never wipes —
  are writable only by the reopening ask's own turns, not by the
  background sweep, and the flow returns to Review with the changes
  visible. Every other topic stays protected throughout.
- **Cost posture.** The cached prefix carries the full manifest and
  option lists, invariant across the session; the per-turn suffix
  names which fields are currently open (a prefix that shrank with
  the open set would never hit cache; #53's reordering applies). The
  implementing unit's proof includes a measured cached-vs-uncached
  per-turn cost against the narrow-scope baseline — above roughly
  twice the cached narrow baseline, the widening returns to Steve for
  re-decision before the unit merges — and the measurement is re-run
  by any unit that restructures the per-turn prompt. Repeat decisions
  are unaffected: chip taps, no model call.

**Ask copy contract (added 2026-08-26).** Everything wilson says is
authored, never generated: `docs/ask-copy.md` holds the inventory —
per-topic authored asks (21 in the ungated single-product walk, hard
ceiling 24), a disposition for all 227 fields (ask / derive / auto /
gated), gates that keep device, availability, and
purchase topics out of reports they don't belong to, derive rules so
unit checkboxes and "other" enums fill as companions of stated facts
rather than being asked (a one-hot group is a fact's only
representation, so it is asked, not a companion — ask-copy.md rule 3),
and short display names used by every
acknowledgment, correction offer, open-fields row, and Review label.
Template generation of clinician-facing text is a defect; the UX
floor checks in CI — over an exhaustive enumeration of the pure copy
helpers (every topic, instance, gate state, and voice pattern, never
just the reference path) — that shipped copy equals the inventory and
that no rendered string contains a raw manifest label, field-id, PDF
option code, or template marker.

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
