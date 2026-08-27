# The round gate — the reviewer that looks before Steve does

Both rejected UI builds (2026-08-25 chips; 2026-08-26 v1.1) reached
Steve because nothing between "all units merged" and "Steve looks" ever
experienced the assembled product. The per-unit session artifact
(design.md's proof rule) closes that at unit scope; this gate closes it
at round scope. It is a filter in front of Steve's charter-v1.2
acceptance, never a replacement for it: what reaches him should already
have survived a reader who looked.

Approved by Steve 2026-08-27. Unit #94. **Amendments to this file take
a doc-review pass (CLAUDE.md's review rule), and any edit that removes
or weakens a checklist entry, a case, or the strike rule must quote
Steve's authorizing words and their date in the diff — absent that
quote, reviewers treat the edit as a defect, not an improvement.**

## Definitions

- **A round** is the set of units merged to `dev` since the previous
  gate verdict (or, for the first run, since this file merged).
- **Gate-relevant paths**: `src/app/**`, `src/components/**`,
  `src/prompts/**`, `docs/ask-copy.md`. A file that starts carrying
  clinician-facing strings gets added here in the same PR that makes
  it do so.

## When it runs

After a round's last unit merges to `dev`, and **before a promotion PR
is prepared** (the hook lives in CLAUDE.md's promotion rule; it binds
`dev → staging` preparation — `staging → main` copies the already
posted verdict forward, no new run). Whether the gate is needed is a
**mechanical test, not a judgment**: it runs unless
`git diff --name-only <previous-verdict-SHA>..dev` touches no
gate-relevant path. A no-gate promotion PR pastes that command's
output as its evidence. A Steve-reported defect after a no-gate
promotion is a strike, same as after READY — the skip is inside the
gate's falsifiability, not an exit from it.

## How it runs

1. **A fresh session** — no hand in any of the round's builds, on the
   review tier the model split reserves for risk-bearing passes —
   is launched with exactly this prompt (fixed here so the round's
   sessions never author their own judge's framing):
   > Run the round gate per docs/round-gate.md against dev at
   > <SHA>. Build it, drive every case yourself, judge against the
   > checklist, commit the evidence, post the verdict. You may explore
   > beyond the scripted cases at will; the cases are the floor, not
   > the ceiling.
2. **The reviewer drives the product itself** — builds the named `dev`
   SHA locally and takes every case below through the app end to end,
   using the case-driver tooling where it helps and deviating from it
   wherever suspicion leads. Fake-model locally: **copy, layout, and
   screen fidelity are model-independent; flow and length are NOT** —
   under the fake driver they are certified only *as exercised by the
   scripted extractions*, and the verdict must say so in those words.
   The real-model residual is exactly what the charter v1.2 live evals
   and Steve's own acceptance pass cover; the gate never claims it.
3. **Evidence is committed, not described**: per case — the full
   transcript, a screenshot of every surface state, the exported PDF,
   and the session bundle (#92's export) — committed under
   `runs/gate/<dev-SHA>/` (lucy's `runs/` precedent). Independence
   here is procedural, not provable: a fresh session, a fixed prompt,
   and a bundle Steve can audit at will are the guarantees, and the
   verdict is only as good as the committed evidence.
4. **Verdict posted** on the standing handoff and copied onto the
   promotion PR when prepared. It **names the `dev` SHA it drove**,
   links `runs/gate/<SHA>/`, and answers every checklist entry with
   evidence (quotes, screenshots, counts). Two verdicts exist:
   - **READY FOR STEVE** — no entry failing. **A READY verdict is
     void the moment `dev` advances past its SHA** (any merge except
     the promotion itself); the promotion PR's head must match the
     verdict's SHA.
   - **NOT READY** — findings listed; each becomes new intake per
     CLAUDE.md's no-reopen rule; the gate reruns once the units
     addressing them merge. Steve is not pinged. **Escalation valve**:
     a case failing two consecutive runs for a cause outside the
     round's own units (an undecided design issue, say) is marked
     "blocked on #N" in the verdict, drops out of the pass
     requirement, and the block goes into the needs-Steve digest — it
     surfaces through the existing channel instead of stalling
     promotion silently.

## The case set (v1 — entries are added freely, removed only by Steve)

The verbatim inputs for all cases are pinned by the case-driver unit;
where no build unit carries the driver, it is filed as its own intake
(done at this unit's merge: see the driver unit).

- **C1 — reference case**: the amoxicillin narrative from the design
  mockups, dictated once, follow-ups answered plainly.
- **C2 — Steve's case**: verbatim from his 2026-08-26 staging test —
  "patient developed nagging cough while on lisinopril. reported
  yesterday, cough is non-serious but ongoing" — minimal data,
  non-serious; mostly *not* asking is the correct behavior. The
  clinician also states "no relevant history" and "nothing else to
  add" (exercises the text-ask negatives and the sentinel check,
  entry 5).
- **C3 — messy multi-drug**: two suspect products, three concomitants,
  labs, information volunteered out of ask order, one cross-turn
  correction ("actually the 19th, not the 20th") **and one same-turn
  contradictory pair ("500 mg — no, 875 mg") to force a collision**
  (entry 7).
- **C4 — device involved**: an EpiPen-class combination product — the
  Section E gate must open and its asks must run.
- **C5 — reluctant reporter**: heavy "I don't have that" / "rather not
  say", partial answers forcing rule-9 re-asks, a repeat decision
  answered "no".
- **C6 — second run**: complete C2 to Ready, start C3 via Ready's
  "Start over", in the same browser state. Pass bar while #93 is
  undecided: no C2 data bleeds into C3 and no dishonest claims; the
  known mid-interview-resume gap (#93) is *reported* in the verdict as
  standing intake, never verdict-bearing, until its design lands.

## The checklist (seeded from the two rejections; every future Steve
finding becomes a permanent entry — removals are Steve's alone)

Each entry is answered with evidence, not a checkmark:

1. **Read every question aloud.** Does each read like a person wrote
   it? Any raw form-field wording, template artifact, "(yes or
   no)"-class construction, or option-code leakage anywhere — asks,
   acknowledgments, correction offers, open-fields rows, Review labels?
2. **Count the asks per case.** Within docs/ask-copy.md's budget for
   the case's shape, under the scripted extractions? Is anything asked
   that the clinician already answered, or asked twice in identical
   words back-to-back?
3. **Screen integrity.** Does any string render twice simultaneously
   (the double-bubble class)? Does any screen contradict the
   transcript or the record?
4. **Side-by-side every surface against its mockup screen.** Same
   product? Composition, warmth, hierarchy — not token values.
   Recorded deviations (design.md) are fine; unrecorded drift is the
   defect.
5. **Copy honesty.** No filing/submission claims, privacy copy scoped
   per design.md, footer and open-fields counts truthful — including
   no phantom unknowns and no "Unknown"/sentinel printed on the PDF
   against stated words (C2 exercises this).
6. **The charter's question, answered in prose with reasons: would a
   clinician prefer this to the paper form?** This entry can fail the
   gate on judgment alone.
7. **Machinery voice.** Out-of-ask acknowledgments, correction offers,
   collisions (C3 forces one): visible, human, truthful?
8. **Gates truthful.** Gated-off topics honestly labeled, reachable
   from Review, never counted as gaps — and C4 proves the device gate
   opens.
9. **PDF spot-check per case.** Exported values against the transcript
   — the silent-mis-fill sweep.
10. **The wince line.** Anything Steve would wince at that fits no
    entry above gets reported anyway; "no rule covered it" is not a
    pass.
11. **Surface coverage.** Enumerate every surface design.md names —
    the six surfaces, the report chrome, the open-fields dialog, and
    each gate's opened state — and point to the evidence each was
    visited. Any surface without evidence = NOT READY, automatically:
    completeness is judged against the product's own enumeration,
    never against what a drive happened to traverse.

## The strike rule (the gate's own falsifiability)

**Any defect Steve reports on a build that carried a READY verdict —
or that reached him through a no-gate skip — is a strike.** There is
no finding-vs-rejection distinction to classify: the checklist entry
and the strike are recorded together, in the same PR, by the session
that receives his report — one motion, no discretion. **Two strikes
within three consecutive gate runs = the gate is broken**: stop
trusting it, take the failure to a design conversation, and do not
paper over it with more checklist entries. Strikes are recorded in
this file, under this rule.

Strikes to date: none.
