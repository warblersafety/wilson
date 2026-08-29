# Ask copy and field disposition — the conversational contract

This document is the authored inventory of everything wilson says to a
clinician and every decision about which of the manifest's 227 fields are
asked at all. It exists because the v1.1 rebuild generated question text
mechanically from manifest labels (`ask.ts`'s last-colon-segment rule plus
"(yes or no)") and shipped questions like *"What's the yes (yes or no),
the no (yes or no), and the doesn't apply (yes or no)?"* — rejected by
Steve on first contact with the deployed build (2026-08-26). The Talker's
charter-stated job is plain language; plain language is authored, not
derived.

Authority: this inventory is the source of truth for clinician-facing
copy and for ask coverage. The mockup canvas remains the authority for
what screens *look* like (design.md's layout-authority rule); where the
canvas shows question text or implies coverage, THIS document wins.
design.md's "Ask copy contract" section binds units to it.

Counts, stated for the CI check the UX-floor unit adds: **34 topics, 227
fields, all dispositioned below. The ungated single-product no-device
walk contains exactly 21 authored asks** (3 patient + 2 what-happened +
1 outcome + 1 history + 1 labs + 1 comments + 8 suspect-product + 1
concomitant + 3 reporter). Conditional asks (death date)
and gated asks (availability, purchase, device) are excluded from that
count, as are rule 9's re-ask frames and clarifications and the
Machinery copy section's strings — authored, but never primary asks.
Hard ceiling: 24 — an amendment that pushes past it returns to a
design conversation first.

## Rules

1. **Authored copy only.** Every question, acknowledgment, correction
   offer, collision prompt, open-fields row, and field label a clinician
   sees comes from this inventory (or from design.md's recorded copy
   rules). Generating question text from manifest labels is a defect.
   The template path in `ask.ts` is removed, not kept as a fallback — a
   topic without authored copy is a build error caught by test.
2. **An ask asks for facts; extraction maps facts to fields.** An
   authored ask owns an explicit field set, which may exceed the old
   3-field slice because facts ≠ fields (one weight fact = 3 manifest
   fields; the whole lab table = one ask). The `MAX_FIELDS_PER_ASK`
   slicing is retired for authored asks. Dismiss chips ("I don't have
   that" / "rather not say") apply to exactly the ask's *askable* fields
   — never to derive/auto companions. A partially answered ask ends
   only through rule 9's re-ask path — never by silently resolving
   facts the clinician didn't address.
3. **Derive fields are never asked.** A derive field is filled as a
   companion of a sibling fact, grounded on the same quote:
   - Unit checkboxes from a stated unit: `AgeYears/Months/Weeks/Days`
     from the age phrasing; `WeightLB/KG` from the weight phrasing;
     `StrengthUnit`/`DoseUnit` enums from "500 mg".
   - "Other" companions: `FreqOther`/`RouteOther` only when the stated
     value matches no enum option.
   - **One-hot groups are ASKED, not companions** (corrected 2026-08-27,
     #101's doc-review): `SexM/SexF`, `OngoingYes/No`, `ProYes/ProNo`
     and the Abated and Reappear trios fill together from one answer,
     which is a *filling* mechanic, not a disposition. Every one of them
     is voiced — PB-1 asks the sex, SP-4 asks whether therapy is
     ongoing, SP-7 and SP-8 are nothing but their trios, RA-1 asks
     whether you're a health professional — so each belongs to its ask's
     field set: the walk waits on it, a dismiss chip reaches it, and it
     appears as an open gap when unresolved. An earlier version of this
     list called them companions "rather than being asked", which is
     both false about the inventory and, since companions now need an
     anchor to count as open (below), would have made a missing patient
     sex appear on the open-fields dialog nowhere at all. A one-hot
     group is a fact's ONLY representation, so it can never name an
     anchor — which is exactly why it must not be a companion.
   - **Stated-only rule for units, with one recorded exception**: a unit
     is derived only from the clinician's words. Exception: a bare age
     defaults to years (unqualified clinical ages are years; infant ages
     are always qualified). A bare weight gets NO default — lb/kg is
     genuinely ambiguous — the value writes and the unit stays open,
     visible at Review. **When a companion counts as OPEN, amended
     2026-08-27 (#101):** a derive companion is an open gap — listed in
     the open-fields dialog, counted with the rest — **once the fact it
     hangs off has been answered, and not before**. Each companion names
     its anchor; a companion with no anchor (the stated-only reporter
     country, a therapy duration nobody stated) fills from the
     clinician's words or not at all and is never a gap. A checkbox
     anchor must be answered *true*: a product not returned to the
     manufacturer has no return date to give.
     Anchor state, not disposition, is the discriminator, and the
     difference is the whole point. A stated bare weight makes lb/kg a
     live, answerable question — this rule's own worked example. An age
     nobody gave makes its four unit checkboxes noise, and listing them
     headed a 28-question session with "122 fields are still open",
     first four rows those very checkboxes, on the surface immediately
     before sign-off. Rule 5 already excludes write-target rows for a
     related reason; this is the companion case, and it needs the
     anchor test rather than a blanket exclusion because the asks voice
     some companions out loud (PA-1's "and when?", DV-3's "who
     reprocessed it?", CM-1's "with rough start and stop dates").
     **Alternatives close together**: where companions are mutually
     exclusive answers to one question — which unit is this? — answering
     any of them settles the question, so its siblings stop being gaps.
     A stated age derived as years leaves no open question about months,
     weeks or days. Independent facts are not alternatives: a
     concomitant medication's start and stop dates hang off the same
     anchor and stay open separately.
     The per-companion anchor table, the exclusive groups, and the
     anchorless exceptions are carried with the dispositions in
     `src/lib/ask-inventory.ts` and asserted field-by-field there; this
     rule states the semantics they implement.
     A companion left open is always visible on its anchor's Review row,
     whether or not it is currently a listed gap.
   - A sex stated outside the form's M/F boxes checks neither box and
     leaves both unwritten; wilson does not force the form's vocabulary
     onto the clinician's words.
4. **Auto fields are system-filled.** `ReportDate` is stamped with the
   current date at export, shown and editable at Review, never asked.
5. **Gates.** A gated topic is out of the walk while its gate is
   closed: excluded from asks, the open-fields dialog, and
   written/unknown counts; its rail row reads "not part of this report
   — add from Review if needed". **Gated-off is never
   confirmed-absent**: Review renders every gated-off section
   collapsed with an add affordance (the normal reopen path), and a
   validated extraction proposal for a gated field opens its gate — no
   silence is converted into a recorded "none". **Timing**: gates are
   re-evaluated on every `nextStep()` walk; a gate opened late (a
   product type stated at SP-6 opening availability/purchase) makes
   the walk reach the newly opened topic on its next pass — that
   mid-flow insertion is accepted and recorded here, because the
   alternative (evaluate once at arrival) silently skips exactly the
   cases the gate exists to include. Gates in force:
   - **Section E (all three device topics)**: a medical device is part
     of the report — any Section E field has a validated proposal, or
     the clinician says so in the narrative, any answer, or through
     Review's add affordance. No ask voices devices; the add
     affordance is the guaranteed path, so nothing is foreclosed.
   - **product-availability** and **suspect-product purchase**: the
     report involves a product problem / use error / manufacturer
     switch (`RepError`, `Defects`, `DiffManu`), a device, or a
     product type in {OTC, compounded, cannabinoid, cosmetic}. Pure
     adverse-reaction reports skip both — and can regain both late,
     per Timing above.
   - **Lab rows are write-targets, never ask-targets**: LD-1 is the
     only lab ask; rows fill from its answer (and later volunteered
     turns) in stated order; no row is ever independently "open" —
     openness attaches to LD-1's own resolution, so an empty row 4 is
     never a phantom gap in open-fields or the counts. Row N+1
     accepts content only while row N holds content other than the
     literal "None" (rule 7's text-ask negative).
6. **Display names.** Every field has a short human name (tables below),
   used by acknowledgments, correction offers, collisions, the
   open-fields dialog, and Review rows. Raw manifest labels and PDF ids
   never render. Checkbox facts render as fact phrases ("outcome:
   hospitalization"), never as "true/false".
7. **Checkbox negatives are real answers.** "None of those" / "no"
   resolves checkbox facts as answered-`"false"` (the existing literal
   representation), grounded on the negative quote — resolved and
   unchecked, not `unknown`. **Text-ask negatives are real answers
   too**: a clear "none" / "nothing" to a prose or table ask (MH-1,
   LD-1, AC-1) writes the literal "None" to the ask's primary field
   (`OtherHistory`, `TestData1`, `AdditionalComments`) as an answered
   value — never `mark_unknown`, because the PDF filler prints unknown
   text fields as "Unknown" (`scripts/fill-3500.py`'s sentinel), which
   would state the opposite of what the clinician said on the
   FDA-bound form. Companions and further rows stay untouched.
   **Answering a checkbox group answers the whole group, added
   2026-08-27 (#90 part 2):** the members the clinician named are
   `"true"`, the rest `"false"`. The completion is derived from the
   answer that triggered it, not separately grounded — a written action
   carries no quote of its own, so provenance is checked once, on the
   triggering candidate, by the validator. Saying "grounded on the same
   quote" would describe a check nothing performs. A
   clinician who answers "she was hospitalised" has answered the outcome
   question, not one seventh of it, and the alternative — leaving the
   unnamed six `unasked` — re-asks the same question forever and shows
   six phantom gaps at Review. The bound is this rule's own reasoning,
   and it takes one form per group kind (amended 2026-08-28, #126):
   where the ask reads every member out loud, OC-1's *every one of them
   is voiced above, so no box is ever written false unheard*; where
   naming one member entails the rest, its counterpart — *none is ever
   written false unentailed.* Which writes can trigger a completion is
   scoped per group kind below (amended 2026-08-28, #126); a
   volunteered member that does not qualify completes nothing, its
   group completing later when its ask voices it. An `unknown` or
   `declined` completes nothing either — "I don't
   know if she was hospitalised" is not an answer to the question. This
   is mechanical and lives in `src/lib/derive.ts`, not in the extractor
   prompt: a rule this consequential should not vary run to run.
   **The bound's two halves, by group kind (amended 2026-08-28,
   #126):** being on screen is not the same as being heard — and
   hearing is not the only honest ground; entailment is the other.
   - **Where the ask's copy reads every member out loud**
     (`voicesEveryMember` in `src/lib/ask-inventory.ts`: OC-1's
     seven outcomes, RA-2's four recipients), completion applies
     only to a group whose own ask was the one on screen — hearing
     the list is what makes the unnamed members' `"false"` honest,
     so a member arriving any other way completes nothing until the
     ask voices it. Unchanged.
   - **Where naming one member entails the rest** (`exclusive` in
     the inventory — the one-hot alternatives: sex, therapy
     ongoing, health professional, the Abated and Reappear trios,
     and their kin; the per-fact declaration is authoritative), the
     entailment carries on the clinician's own words, not on a list
     being read: "58-year-old man" settles the sex question wherever it
     is said. Completion applies to a validator-grounded `"true"` write
     on any of four paths — the ask's own turn, a Read-back confirmation
     of a narrative proposal, a rule-8 volunteered write (announced and
     correctable, as rule 8 provides), or a tapped collision chip that
     clears the same conflict check (#154). Boundaries are named here,
     not counted — a hand-maintained tally is exactly what has gone stale
     on this rule already: an action that is not `answer "true"` —
     `"false"`, `unknown`, `declined` — is out of scope and still takes
     the field-level path (#155), a tapped collision chip included; and
     a single turn proposing `"true"` for two DIFFERENT members of the
     same exclusive fact writes both — collision detection is keyed on
     field id, not fact, so two distinct fields never collide with each
     other (#169). Recorded because a contract that overstates its own
     reach is how the next unit inherits a bug. A Read-back confirmation
     is the clinician answering, not machinery guessing — proposals being
     confirmable before anything writes is the whole reason Read-back
     exists — so the "unheard" reasoning does not reach it. Before this
     amendment the in-ask bound applied blanket: a narrative-confirmed
     `SexM` completed nothing, the record held a male patient with
     `SexF: unknown`, the open-fields dialog read "sex: female — you
     didn't have it", and the walk re-asked a fact Read-back had just
     confirmed (gate run #1, C3 — entries 2 and 5).

     **A write to an exclusive group is a write of the whole fact,
     atomic (amended 2026-08-28, #126).** Rule 3 already holds that a
     one-hot group is a fact's ONLY representation; this makes that
     operational. The named member `"true"` and every sibling
     `"false"` are one operation derived from one grounded quote —
     never a member write that afterwards meets its siblings one at a
     time. No member-level write survives to collide with an
     already-resolved sibling, so the question of what completion does
     when it meets one does not arise.

     **The atomic write supersedes prior `unknown` and `declined`
     member states.** Those recorded the fact before it was known or
     while it was withheld, and the clinician has now stated it.
     Superseding an absence of value is not the silent replacement the
     follow-up sweep's invariant guards — that invariant protects
     *stated* values. A clinician who dismissed PB-1 and later says
     "he's male" ends with sex answered, not with `SexM: "true"`
     beside a surviving `SexF: unknown`.

     **A conflicting later statement is a correction of the fact, at
     fact granularity.** Where a grounded statement conflicts with an
     exclusive fact already answered, the sweep offers one correction
     named by the fact — "You said female for sex — it's recorded as male.
     Replace it?" — and accepting it rewrites the group atomically. A
     member-level offer is never the right shape for a one-hot member: a
     per-field offer on `SexF`, accepted against an answered `SexM`, is
     exactly how a report ends with both sex boxes checked on an
     FDA-bound form. The sweep's own offer path honours that, and since
     #154 so does a tapped collision chip's own resolution:
     chip-grammar.ts's resolveCollisionTap() shares the sweep's own
     conflict check (conflictingExclusiveSibling()) rather than a second
     copy of it, so a conflicting tap surfaces the identical "Replace
     {fact}" offer, never a raw write — outside the boundaries named
     above (#155, #169), which remain gaps against this rule, not
     exceptions to it.

     **Naming the fact names the whole write.** design.md requires
     every out-of-ask write to be named in that turn's visible reply.
     For an exclusive fact, announcing its value — "Also noted —
     therapy status: ongoing." — names the entire fact; the sibling
     `"false"`s are that same fact's representation rather than
     separate writes, so no per-member naming is owed. Recorded here
     because it is an exemption to another file's rule; design.md
     carries the mirror sentence.

   A multi-select whose options the ask does not enumerate completes
   nothing: PB-3 asks for "race or ethnicity" without naming its seven
   boxes, and they are not alternatives — Hispanic ethnicity is
   orthogonal to race on this form, so "she's White" says nothing at all
   about `EthnicLatino` and writing it `"false"` would be wrong, not
   merely unheard. Such a fact is answered by ONE member instead: the
   clinician answered the question, the walk moves on, and the remaining
   boxes stay open and answerable — listed on the open-fields dialog as
   the fact's own still-open row, and at Review field by field (rule 8's
   open-fields unit, #127; this clause said "at Review" alone before, which
   disagreed with `src/lib/ask-inventory.ts` and with the dialog's own
   purpose). Each fact declares which
   case it is (`exclusive` / `voicesEveryMember` in
   `src/lib/ask-inventory.ts`), so a new checkbox group cannot inherit
   completion by accident.
   **And a completion must be visible.** A checkbox answered `"false"`
   renders as "No" on Review — where an unchecked box would otherwise be
   indistinguishable from one never asked, which would put six
   machine-written negatives on the record with nothing on the surface
   the clinician signs off from to show them.
8. **Voice.** Second person, contractions, no exclamation marks,
   mockup screen-04's register. **One TOPIC per ask, at most two
   question marks** (amended 2026-08-27, #103; amended again the same
   day after review). The original wording, "one question mark per ask",
   was violated by six of this document's own authored asks: WH-1 and
   SP-2 are imperatives and carry none, SP-4/DV-2/DV-3/RA-2 are
   two-part and carry two. The first amendment said "one question per
   ask", which is no better — DV-3 and RA-2 plainly ask two. What the
   rule actually protects is that an ask covers one topic a clinician
   holds in mind at once, so its parts can be answered together.
   **That half is an authoring judgment and no check can hold it** — an
   ask satisfies it by declaring it ("Two housekeeping items —"), so it
   is recorded here by example and enforced at authoring, not by CI.
   Saying so plainly matters because the judgment has a consequence rule
   2 does not: a dismiss chip covers the whole ask, so one tap on RA-2
   resolves the identity-withholding choice along with the
   also-reported-to boxes and labels it "you didn't have it". The
   mechanical half, which CI can hold: **no exclamation marks, and no
   more than two question marks**, with the six asks above the recorded
   set that depart from one. A seventh is a copy change someone has to
   justify. Patterns:
   - Out-of-ask write: `Also noted — {name}: {value}.`
   - Unknown/declined tap: `Marked {name} as not on hand.` /
     `Marked {name} as declined.` A bulk-mapped ask's `{name}`
     follows the record (added 2026-08-28, #125): while the fact
     has nothing on the record there is no "rest", and the
     acknowledgment names the fact plainly — "your contact
     details" / "the device details" / "the purchase details";
     once part of the fact is on the record — a partial answer or
     a narrative fill — the "rest of" name is the accurate one.
   - Correction offer: `You said {new} for {name} — it's recorded as
     {old}. Replace it?`
   - Collision: `I heard two values for {name}: {a} and {b} — which
     should I write?`
   - Open-fields row: `{name} — not asked yet` / `— you didn't have
     it`. (The dialog lists `unknown` and unasked fields only —
     design.md surface 5 and `open-fields.ts` exclude `declined`, so
     no declined row copy exists.)
   **The open-fields unit is the fact, not the field — added
   2026-08-29 (#127).** The dialog and every chrome count that
   reconciles with it (the footer and Ready's
   written/unknown/declined line) answer one question: how many
   things can this clinician still usefully answer? That question's
   unit is the askable fact, not the form field. On merged `dev`
   `2e4d1b4` the dialog counts fields: one dismissed OC-1 becomes
   seven rows, one WH-2 four, one PB-3 seven, and the one-hot sex
   pair two. C4's sign-off surface headlines "105 fields are still
   open" over a walk the clinician answered to the end, and its
   first screenful is nine multi-member rows — sex ×2, race/
   ethnicity ×7 — interleaved with four single-field ones. That is
   #101's rejected shape re-entering through multi-member facts
   (gate run #1, entries 5 and 10; #101 excluded derive companions
   without answered anchors, and a multi-member fact is not a
   companion, so nothing excluded it).

   **The unit noun is authored, not left to the build.** All three
   surfaces say "fields" today, and all three would be false the
   moment they count facts: C4 would headline a number in the low
   forties over a form with 105 genuinely unfilled fields. Rule 1
   applies here as everywhere — the strings change with the unit:
   - Open-fields heading: `{n} items are still open.` / `1 item is
     still open.`
   - Chrome footer and Ready: `{n} items written · {n} unknown ·
     {n} declined`, and screen 07's "Fields" label becomes "Items".
   "Item" rather than "question" or "field": a row is a fact, which
   is neither — one ask can carry several facts (PB-1 asks
   identifier, age and sex), so "question" would overcount asks,
   and "field" is the noun this rule exists to stop using. It is
   also what the dialog visibly is: a list of items to answer. The
   form's own field count remains true and remains reachable at
   Review, which renders every field.

   The unit rule:
   - A multi-field fact appears as ONE row under its fact name and
     counts once, whatever its member count: a dismissed OC-1 is
     "outcome — you didn't have it", never seven rows. The row's
     reason follows the ask's resolution ("not asked yet" / "you
     didn't have it"); member detail stays at Review. **Every
     multi-field fact, not only the checkbox ones** — the
     bulk-mapped text facts rule 9 already treats as one (RC-1,
     DV-1, SP-9) are the same failure in the same dialog: C4 lists
     "the device details" as nine rows, "your contact details" as
     eight, "the purchase details" as eight. Collapsing checkbox
     facts alone would leave C4 headlining 66 — smaller than 105
     and the same shape Steve rejected.
   - **The name is the fact's, qualified by its instance.** Use
     `standaloneName` / `plainStandaloneName` where the fact
     declares them, via `standaloneFactNamesFor()` — and pass it
     the STILL-OPEN subset of the fact's fields, never the whole
     `fieldIds`. Its discriminator is whether the set it is handed
     covers the fact entirely, not what the record holds, so
     passing `fact.fieldIds` would make a half-held RC-1 read "your
     contact details" — the referent bug #125 removed. Repeat
     instances share one authored string: `suspectProduct(2)`'s
     "therapy status" is byte-identical to instance 1's, so a
     confirmed second product would render "therapy status — not
     asked yet" twice with nothing to tell the products apart. A
     row for a repeat instance carries that instance's marker, the
     way display names already do ("product #2"). Note the fact
     name is the authored one, not the display-name prefix its
     members happen to share: PB-3's fact is "race or ethnicity"
     while its member labels read "race/ethnicity: White".
   - One-hot alternatives are one fact (rule 3): one row when open
     ("sex — you didn't have it"), never a row per box. This
     governs the still-OPEN case, and that is the common one —
     rule 7's own negative means a dismiss completes nothing, so a
     dismissed PB-1 leaves both sex members `unknown` and produces
     two rows today. The case where the fact is answered by
     entailment already leaves the dialog whole (#126), so this
     clause no longer carries that job.
   - **A fact that rule 7 COMPLETES — `exclusive` or
     `voicesEveryMember` — is not open and contributes nothing**,
     whatever its members' states look like field-by-field. Since
     #126 that covers more ground than the field-level reading
     suggests: an exclusive fact is completed by an in-ask answer,
     a Read-back confirmation, and a rule-8 volunteered write
     alike. **Scoped to completing facts deliberately.** A fact
     that merely RESOLVES from one member (`factResolvesFromOne` —
     PB-3, SP-6) leaves its remaining members genuinely `unasked`
     and genuinely answerable, so it stays listed: answering
     "White" moves the walk on, and the other six boxes are still
     things this clinician can usefully answer, which is this
     rule's own test. They appear as the fact's one row, still
     open, not as six. This settles a disagreement that predates
     this rule: rule 7 above says such boxes stay answerable "at
     Review", while `ask-inventory.ts` says "from the open-fields
     dialog". **The dialog is correct and rule 7's clause is
     amended to say so** — a box the clinician can answer belongs
     on the surface that exists to list what they can still answer.
   - **Rule 3's exclusive companion groups get one row too**, and
     they are not `AskFact`s, so a build keyed on `ask.facts` alone
     would miss them. A stated bare weight leaves `WeightLB` and
     `WeightKG` both listable — two rows for the single authored
     clarification "Was that pounds or kilograms?" (rule 9). One
     question, one row, named for the question it asks. Companions
     otherwise keep rule 3's anchor test (#101) unchanged; lab rows
     keep rule 5's write-target exclusion; gated topics keep rule
     5's exclusion.
   - Auto fields (rule 4) sit outside every chrome count: they are
     wilson's writes, not the clinician's answers, and Start
     opening on "1 item written" for a date the clinician never
     gave is the same overcount at the other end of the walk. Two
     consequences, both intended and both named rather than
     discovered later. First, `ReportDate` is already excluded from
     the DIALOG (`isListableGap` is false for the `auto`
     disposition), so this changes the chrome counts only — it
     moves no headline number, and it is not what makes the
     fixture and a gate run agree. Second, it reverses PR #107's
     nit a: the facsimile is handed the STAMPED record, so with
     auto excluded a fresh session reads `written === 0` and the
     caption would say "nothing written yet" above a paper already
     printing DATE OF REPORT. The caption describes what the
     CLINICIAN has supplied, so it says so: `227 items, none from
     you yet` — the stamped date is wilson's, and the caption stops
     claiming the paper is blank when it is not.

   **What a fact's state IS, for counting — added with the build
   half, closing a gap this passage left open.** "The same facts in
   the same states" is not self-evident for a fact whose members
   differ: a half-filled RC-1 has three fields answered and six
   never asked. Stated once here rather than re-decided per surface,
   because two surfaces deciding it differently is how a footer ends
   up saying "items" while still counting fields:
   - **written** — at least one member answered. The clinician gave
     something, and a fact they have partly filled is a fact they
     have written, whatever remains.
   - **unknown** — no member answered, and at least one `unknown`.
     They were asked and did not have it.
   - **declined** — no member answered, and at least one `declined`.
   - counted nowhere otherwise, exactly as an `unasked` field is
     today.
   A fact can therefore be **written and still open** — the partly
   filled RC-1 is both, and both statements are true: they have
   given contact details, and there is more they could give. That is
   the honest shape, and it means the dialog's count is NOT the
   arithmetic complement of the three buckets. The reconciliation
   this rule owes is that all three surfaces read the same facts
   through the same states — not that one is derivable from the
   others by subtraction. The field-granularity arithmetic gate run
   #1 observed was an artifact of every fact being exactly one
   field, and this passage should not have promised to preserve it.

   The three surfaces stay mutually consistent by counting the same
   facts in the same states — the reconciliation gate run #1
   verified must survive the unit change — and the gate cases'
   headline numbers are pinned by fixture so a regression is
   visible in CI rather than at the next gate run. C6 is not
   pinnable as the harness stands (`gate-cases.test.ts` filters it
   out of `WALK_CASES`; `simulateCase` stops at `start-over`), so
   the fixture pins the five it can drive and says five. The pinned
   numbers are post-change and must be shown to RECONCILE: each
   case's drop from its pre-change headline equals the
   members-minus-facts arithmetic this rule predicts for that
   case's own open facts, not merely a smaller plausible number.
   Not decided here: reopen granularity (#79) and the rest of the
   round-2 design conversation — this rule decides display and
   count units only.
9. **Partial answers and clarifications.** An ask whose answer left
   some of its facts open is re-asked through one authored frame
   composed from display names — several still open: `Got it. Still
   need: {names}.` · one still open: `And the {name}?` A frame is
   never byte-equal to the primary ask, so the
   no-consecutive-duplicates check holds across the pair. Dismiss
   chips on a re-ask cover exactly the re-ask's named facts. Where
   rule 3 deliberately leaves an ambiguity open, the clarification is
   authored, not improvised: a bare weight gets "Was that pounds or
   kilograms?" (PB-2). Re-ask frames and clarifications are authored
   copy under rule 1 and sit outside the primary-ask count.
   **Bulk-mapped asks are one fact, amended 2026-08-27 (#100):** an ask
   whose entire field set carries ONE fact, filled from a single answer
   — RC-1 (your contact details), DV-1 (the device's identifiers), SP-9
   (the purchase) — counts as one fact for re-ask purposes and carries
   its own authored line. Field COUNT is not the discriminator and must
   not be used as one: SP-6 owns nine fields and correctly names two
   facts, "product type" and "expiration date". The bound that follows
   is that no re-ask names more than four facts. The reason is that
   enumerating its fields is the recite-the-field-list failure this
   whole contract exists to remove. The frames it would otherwise
   produce read "Got it. Still need: your first name, your address,
   your city, your state/province, your ZIP, your phone, and your
   email." — authored strings every copy-equality check passes, and
   still the thing Steve rejected. Their lines: RC-1 "And the rest of
   your contact details?" · DV-1 "And the rest of the device details?"
   · SP-9 "And the rest of the purchase details?" No other ask changes;
   PB-1 still re-asks "And the sex?".
   **First voicing, added 2026-08-28 (#125, reworked after
   doc-review):** every frame above presumes its primary ask was
   voiced, and the machinery must not render one where it wasn't. A
   topic can reach its turn already partially resolved — narrative
   extraction confirmed at Read-back, or facts volunteered
   out-of-ask under rule 8 — and on dev `7f8f1bd` the re-ask frames
   rendered there as the topic's FIRST utterance: C4's entire
   device-identity ask was "And the rest of the device details?",
   eight identifiers the clinician never saw (gate run #1, entry 1).
   The rule, by arrival state:
   - **All facts open** — the primary copy, always.
   - **Some resolved, some open** — the **arrival frame**:
     `I've got {resolved names}. Still need: {open names}.` For the
     three bulk-mapped asks, whose single fact cannot split into
     fact names, the ask half is an authored line instead — RC-1
     `What are the rest of your contact details?` · DV-1 `What are
     the rest of the device details?` · SP-9 `What are the rest of
     the purchase details?` — prefixed by `I've got {held field
     display names}. `, never rendered bare: the held prefix is
     what gives "the rest" its referent. These are new strings,
     byte-distinct from the re-ask lines above, which stay
     re-ask-only; enumerating a bulk ask's open FIELDS instead is
     the recite-the-field-list failure this contract exists to
     remove, so the ask half never lists them. The arrival frame
     counts as the ask's voicing; later partials re-ask through the
     normal frames above; the composed still-need half inherits
     this rule's four-fact bound (which holds: every ask outside
     the bulk trio names at most four facts). Dismiss chips on an
     arrival frame cover exactly its open side — the named
     still-need facts, or the bulk remainder — never facts already
     on the record: the same scoping this rule gives re-asks.
   - **All facts resolved** — the ask is skipped: no utterance and
     no frame. Rule 3's authored clarifications are the recorded
     exception to the voicing precondition: a clarification
     attaches to its fact's live ambiguity, not to its ask's
     voicing — a bare weight's "Was that pounds or kilograms?"
     renders whenever that ambiguity is live, arrival included,
     with the value on the rail as its referent.
   **Voiced means voiced this report.** Voicing state is intake
   state: "Start over" clears it with the rest (C6's boundary), and
   nothing carries it across reports — a PB-1 voiced in the last
   report was not voiced in this one.
   Arrival frames and the three bulk arrival lines are authored
   copy under rule 1 and sit outside the primary-ask count with the
   rest of this rule's strings.

## Inventory

Format per topic: gate (if any), asks in order (`id — "copy"` with the
facts→fields mapping), then derive/auto/conditional notes and display
names. Mirror topics reference their pattern once; the expansion is
normative.

### patient-basics (A)

- **PB-1** — "Who is the patient — an identifier like an MRN or
  initials, their age, and sex?"
  → `PatientIdentifier`; `AgeValue` (derive: age-unit checkboxes, bare
  number = years); sex → `SexM`/`SexF` one-hot.
- **PB-2** — "What's the patient's weight — and date of birth, if you
  record it?"
  → `WeightValue` (derive: `WeightLB`/`WeightKG`, stated-only, no
  default — a bare weight gets rule 9's authored clarification "Was
  that pounds or kilograms?", never a guess); `DateBirth`.
- **PB-3** — "For FDA's demographics — the patient's race or ethnicity,
  if you record it? More than one is fine."
  → the seven race/ethnicity checkboxes, multi-select from words.

Display names: patient identifier · age · age unit (years / months /
weeks / days) · date of birth · sex · weight · weight unit (lb / kg) ·
race/ethnicity: American Indian or Alaska Native / Asian / Black or
African American / Hispanic or Latino / Middle Eastern or North African /
Native Hawaiian or Pacific Islander / White.

### event-what-happened (B)

- **WH-1** — "Describe what happened — the event, product problem, or
  medication error, in your own words." → `DescEvent`. (In practice the
  opening narrative fills this; the ask exists for the reopen path.)
- **WH-2** — "When did it happen — and is this an adverse reaction, a
  product problem like a defect, a medication error, or a problem after
  switching manufacturers?"
  → `EventDate`; type checkboxes `RepAdverse`/`RepError`/`Defects`/
  `DiffManu`, multi.

Auto: `ReportDate` (rule 4). Display names: event description · date of
event · date of this report · report type: adverse event / medication
error / product problem / different-manufacturer problem.

### event-outcome (B)

- **OC-1** — "How serious was the outcome — hospitalization,
  life-threatening, disability or permanent damage, an intervention to
  prevent permanent harm, a congenital anomaly, death, another serious
  medical event — or none of those?"
  → the seven outcome checkboxes, multi; "none" resolves all seven as
  answered-false (rule 7) — every one of them is voiced above, so no
  box is ever written false unheard.
- **OC-2** *(conditional: `Death` true)* — "What was the date of death?"
  → `DeathDate`.

Display names: outcome: death / hospitalization / life-threatening /
disability or permanent damage / required intervention / congenital
anomaly / other serious event · date of death.

### event-medical-history (B)

- **MH-1** — "Any relevant history — preexisting conditions, allergies,
  pregnancy, tobacco or alcohol use?" → `OtherHistory`.

Display name: relevant history.

### event-lab-data (B)

- **LD-1** — "Any relevant tests or labs? For each: the test, the
  result, the reference range if it's useful, and the date."
  → table rows 1–8 in stated order (`TestDataN`, `TLowRangeN`,
  `THighRangeN`, `TDateN`); rows are write-targets per rule 5 — never
  independently open. (Known manifest id defects: the rows-3–7 date
  ids and row 7's high-range id carry a `Row8.` prefix; leaf names are
  unique, so the mapping is unaffected.)

Display names: test {n} · test {n} result range (low / high) · test {n}
date.

### event-additional-comments (B)

- **AC-1** *(always the final ask of the walk)* — "Anything else FDA
  should know?" A negative writes the literal "None" per rule 7's
  text-ask negative — answered, printing "None" on the form — never
  `mark_unknown`, whose export sentinel would print "Unknown": the
  opposite of what the clinician said.

Display name: additional comments.

### product-availability (C) — GATED (rule 5)

- **PA-1** — "Is the product itself still available — do you have it or
  a picture of it, or was it returned to the manufacturer, and when?"
  → `EvalYes`/`EvalNo`/`EvalRetd` one-hot; `PicYes`; `ReturnDate`
  conditional on returned.

Display names: product available · returned to manufacturer (date) ·
picture of the product.

### suspect-product-N (D) — pattern for instances 1 and 2

Eight authored asks per active instance (purchase is a ninth, gated).
"The suspect product" reads "the second suspect product" for instance 2.

- **SP-1** — "What's the suspect product — name, strength, and
  manufacturer or compounder, if known?"
  → `ProdNName`; `ProdNStrength` (derive `ProdNStrengthUnit`);
  `ProdNManuComp`.
- **SP-2** — "Lot number, and the NDC or other unique ID — if they're
  on hand." → `ProdNLotNum`; `ProdNNDC_ID`.
- **SP-3** — "How was it taken — dose, how often, and by what route?"
  → `ProdNDose` (derive `ProdNDoseUnit`); `ProdNFreq` (derive
  `ProdNFreqOther`); `ProdNRoute` (derive `ProdNRouteOther`).
- **SP-4** — "When did therapy start and stop — or is it still ongoing?
  If the dose was reduced instead, when?"
  → `ProdNTherapyStartDate`; `ProdNTherapyStopDate`; ongoing →
  `OngoingYes/No` one-hot; `ProdNTherapyReduceDate`. Duration
  (`ProdNTherapyDuration` + `DurUnit`) fills from stated words only
  ("about a week", "five days as needed") — never computed from the
  dates: a computed span is wilson's arithmetic grounded on quotes that
  stated no duration, and under PRN or intermittent dosing it can
  contradict the clinician's own stated exposure. Absent stated words
  it stays open, visible at Review.
- **SP-5** — "What was it prescribed or used for?" → `ProdNDiagnosis`.
- **SP-6** — "Anything notable about the product type — brand, generic
  or biosimilar, OTC, compounded, cannabinoid, or cosmetic? And the
  expiration date, if known."
  → the eight product-type checkboxes, multi; `ProdNExpDate`.
- **SP-7** — "After stopping or reducing it, did the event improve —
  yes, no, or doesn't apply?" → Abated trio one-hot.
- **SP-8** — "Was it given again — and if so, did the event come back?"
  → Reappear trio one-hot; "wasn't restarted" → `ReappearNA`.
- **SP-9** *(GATED, rule 5)* — "Where and when was it purchased — the
  store or website, and the date?"
  → the eight purchase fields, extraction-mapped from one answer.

Display names: product name · strength · strength unit · NDC or unique
ID · manufacturer/compounder · lot number · dose · dose unit · frequency
· route · therapy start date · therapy stop date · dose reduced on ·
therapy duration · therapy ongoing · diagnosis for use · product type:
brand / generic or biosimilar / OTC / compounded / cannabinoid /
cosmetic (retail) / cosmetic (professional) / other · expiration date ·
improved after stopping · returned after restarting · purchase: place /
address / city · purchase state/province · purchase ZIP ·
purchase country · purchase website · purchase date. (Instance 2: same
names prefixed "product #2".)

### device-identity / device-usage / device-history (E) — GATED (rule 5)

- **DV-1** — "What's the device — brand or common name, manufacturer,
  and model, serial, lot, catalog, or UDI numbers as available? And its
  expiration date, if it has one." → all ten identity fields,
  extraction-mapped.
- **DV-2** — "Who was operating the device — a health professional, the
  patient, or someone else? If it was implanted or explanted, when?"
  → operator checkboxes one-hot-ish (multi allowed); `ImplantDate`;
  `ExplantDate`.
- **DV-3** — "Two device-history checks — was it a reprocessed
  single-use device, and if so who reprocessed it? And was it ever
  serviced by a third-party servicer?"
  → Reuse pair one-hot + `ReprocInfo` conditional on yes; Serviced trio
  one-hot.

Display names: device brand name · common device name · procode ·
device manufacturer · model # · device lot # · catalog # · device
expiration date · serial # · UDI # · operator (health professional /
patient / other) · implant date · explant date · reprocessed single-use
device · reprocessor · serviced by third party.

### concomitant-medication-1..10 (F) — repeat group, one ask

- **CM-1** *(instance 1 only)* — "Is the patient on other medications?
  Name them, with rough start and stop dates if you have them."
  → rows fill in stated order (`ProdN`, `StartN`, and end dates `End1`/
  `End2` for rows 1–2 but the manifest's `Cell4` ids for rows 3–10 — a
  known id defect; leaf position determines the mapping); the count
  proposes from the answer through the existing repeat-decision
  machinery, and rows beyond it are skipped as today.
- **CM-2-{n}** *(later instances, on a repeat decision's "yes")* —
  "What's the second medication — its name, and rough start and stop
  dates?", with the ordinal naming the instance: **second, third,
  fourth, fifth, sixth, seventh, eighth, ninth, tenth** for instances
  2 through 10. Amended 2026-08-27 (#111) — this group previously
  authored ONE string for all of instances 2–10 ("What's the next
  medication — …"). Once a repeat count is decided no repeat-decision
  turn separates the instances, so a clinician who answered "three
  medications" was asked the byte-identical question on two consecutive
  turns, and at capacity eight times in a row. That is the defect rule
  9 names as the property its own frames protect — "a frame is never
  byte-equal to the primary ask, so the no-consecutive-duplicates check
  holds across the pair" — holding across the re-ask pair and failing
  across the repeat-instance pair. It is also the shape of the v1.1
  build rejected on 2026-08-26: the same sentence twice, with nothing to
  tell the clinician the second one is a new question.
  The fix follows the suspect-product group's per-instance pattern one
  section earlier — SP-1 reads "the second suspect product" for
  instance 2 — which is why that group's repeat never lands on
  CONSECUTIVE turns. It is not why that group is clean: SP-2 through
  SP-9 are byte-identical across instances, so a two-product walk
  repeats seven asks nine turns apart, and only the distance hides it
  (doc-review on #111; filed as #117). Do not read this amendment as
  a statement that the suspect-product group is done.
  **The ordinal counts MEDICATIONS, not turns**: instance 2 is "the
  second medication" because row 1 holds the first. Bare "medication"
  rather than "other medication", because the turn immediately before
  instance 2 has always established the topic.
  **That last clause is a premise, not an observation, and the walk does
  not currently enforce it.** CM-1 is skipped whenever `Row1.Prod1` is
  already resolved — which the opening narrative's read-back does — so
  the turn actually carrying the topic is the group's repeat decision
  ("Is there another medication to add?"), and #43 wiring narrative
  repeat-count proposals through read-back would remove that turn too.
  With both gone, "What's the second medication?" can land directly
  after "Was there another suspect product?", where a clinician
  reasonably reads it as the second suspect drug and the answer writes
  to a concomitant row. So: **every CM-2-{n} must be reached either
  immediately after this group's repeat-decision turn or after
  CM-2-{n-1}, and instance n only when rows 1..n-1 are accounted for.**
  A unit that breaks that adjacency (#43, #77's count revision) must
  re-author this copy, not just preserve the ordinal.
  Display names keep "other medication {n}" (below): a Review row has no
  preceding turn to lean on.
  Additions after the count is decided remain #77's open design
  question; nothing here forecloses it.

Display names: other medication {n} · other medication {n} start ·
other medication {n} stop.

### reporter-contact-info (G)

- **RC-1** — "Your contact details for the report — name, address,
  phone, and email?" → all nine fields extraction-mapped from one
  answer; `Country` stated-only.

Display names: your last name · your first name · your address · your
city · your state/province · your ZIP · your country · your phone ·
your email.

### reporter-about-you (G)

- **RA-1** — "Are you reporting as a health professional, and what's
  your occupation?" → `ProYes`/`ProNo` one-hot; `Occupation`
  enum-mapped ("internist" → Physician).
- **RA-2** — "Two housekeeping items — have you also reported this to
  the manufacturer, a user facility, a distributor, or a packer? And
  should FDA withhold your identity from the manufacturer?"
  → `ManuComp`/`UserFac`/`DistImp`/`Packer` multi; `IdentityNo`.

Display names: health professional · occupation · also reported to:
manufacturer / user facility / distributor / packer · withhold identity
from manufacturer.

## Machinery copy

The walk's non-ask strings, authored here so rule 1's coverage is
total and the copy-equality check carries no exemptions:

- Repeat decisions — suspect products: "Was there another suspect
  product?" · concomitant medications: "Is there another medication to
  add?"
- Count follow-through (groups with more than two slots): "How many in
  total?" — rendered with the group's count chips as today.
- Volunteered-repeat hint, prefixed to the group's repeat decision:
  "You mentioned another one earlier — "
- Done message: "That's everything I need to ask. Review the report
  before you sign off."
- Rule 8's voice patterns and rule 9's re-ask frames and
  clarifications complete the set.

## Consequences for the machinery (the build unit's scope)

1. Authored ask groups drive the loop; the template path and its 3-slice
   are deleted. A topic with no authored asks (gated off) is skipped
   with the rail state above. Count proposals from a topic-turn answer
   (CM-1) require loosening `extract.ts`'s repeat-decision-only gate on
   `repeatDecision` proposals.
2. One display-name module (field id → short name + fact phrase) feeds
   acknowledgments, correction offers, collisions, open-fields, and
   Review rows. The facsimile's existing hand-authored `shortLabel`s
   stay.
3. The extractor prompt gains the derive rules; the validator accepts a
   companion proposal grounded on its sibling's quote. The narrow
   "never propose enum/checkbox" instruction in the per-turn prompt is
   superseded (the narrative pass already proposes them).
4. `ReportDate` auto-stamps at export.
5. Gate evaluation per rule 5, including the open-fields/count/rail
   exclusions and lab-row overflow.
6. Checkbox negatives write `"false"` through the existing
   representation; PDF mapping semantics verified against the existing
   export tests.
7. The UX-floor unit adds CI checks, over an exhaustive enumeration of
   the pure copy helpers — every topic, both repeat instances, every
   gate state, and every voice pattern (Machinery copy and rule-9
   frames included) with fixture values, never just the reference
   path: rendered copy equals this inventory with no exemptions; no
   rendered string contains any manifest label, field-id-shaped
   substring (`Page\d`, `Prod\d.`, `Sec[A-G]_`), or PDF option-code
   string; no "(yes or no)"-class template markers; no consecutive
   duplicate ask strings in a scripted full walk; the ungated ask
   count equals this document's stated count and is ≤ 24; every field
   id this inventory names exists in the manifest and every manifest
   field carries a disposition; and a stated group-negative exports a
   PDF printing neither "Unknown" nor any other sentinel. Rule 9's
   first-voicing rule joins the enumeration (#125): for every topic,
   instance, and gate state, the copy helpers — given declared
   voicing and resolution state — return the primary copy or the
   arrival frame for a partial arrival, never a bare re-ask frame or
   an unprefixed bulk line; and the bulk dismiss acknowledgment
   names plainly while the fact has nothing on the record, "rest of"
   once part of it does. The helpers' contract is what the floor
   certifies; that the walk feeds them true voicing state — the
   first-utterance property as a clinician experiences it — is walk
   history, which the browser-level gate holds (entries 1 and 2),
   not the floor.

Deliberately NOT decided here (Steve's design conversation, informed by
his staging test): #79 reopen granularity, #77 repeat-count revision,
#47 repeat-decision uncertainty. The phase-2 unit that makes the 9-row
rollup drive progress display is compatible with this inventory (asks
keep their topic ids).
