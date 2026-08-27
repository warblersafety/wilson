# The round gate — the reviewer that looks before Steve does

Both rejected UI builds (2026-08-25 chips; 2026-08-26 v1.1) reached
Steve because nothing between "all units merged" and "Steve looks" ever
experienced the assembled product. The per-unit session artifact
(design.md's proof rule) closes that at unit scope; this gate closes it
at round scope. It is a filter in front of Steve's charter-v1.2
acceptance, never a replacement for it: what reaches him should already
have survived a reader who looked.

Approved by Steve 2026-08-27. Unit #94.

## When it runs

After the last unit of a round containing UI or conversation units
merges to `dev`, and **before a promotion PR is prepared** (the hook
lives in CLAUDE.md's promotion rule). A round that never touched a
clinician-facing surface needs no gate run; saying so in the promotion
PR is the record.

## How it runs

1. **Drive the assembled app** (dev tip, local build) end-to-end
   through every case below, using the same session-artifact harness
   the round's units already produce — fake-model locally: copy,
   layout, flow, length, and screen fidelity are model-independent.
   Real-model behavior is covered separately by the charter v1.2
   live-eval requirement; the gate never substitutes for it. The
   case-driver script is round tooling, delivered and maintained by
   the round's build units alongside their per-unit artifacts.
2. **Capture per case**: the full transcript, a screenshot of every
   surface state traversed, the exported PDF, and the session bundle.
3. **A fresh reviewer** — a session with no hand in any of the round's
   builds, on the review tier the model split reserves for risk-bearing
   passes — reviews the artifacts against the checklist. Product level
   only; diffs are the per-unit passes' job.
4. **Verdict posted** where the next reader will meet it: on the
   standing handoff at minimum, and copied onto the promotion PR when
   that is prepared. Two verdicts exist:
   - **READY FOR STEVE** — every checklist entry answered with
     evidence (quotes, screenshots, counts), none failing.
   - **NOT READY** — findings listed; the round reopens (new or
     reopened units) and the gate reruns after. Steve is not pinged.

## The case set (v1 — grows; entries are added freely, removed by Steve)

- **C1 — reference case**: the amoxicillin narrative from the design
  mockups, dictated once, follow-ups answered plainly.
- **C2 — Steve's case**: the lisinopril cough (2026-08-26 screenshot) —
  minimal data, non-serious, mostly *not* asking is the correct
  behavior.
- **C3 — messy multi-drug**: two suspect products, three concomitants,
  labs, information volunteered out of ask order, one mid-flow
  correction ("actually the 19th, not the 20th").
- **C4 — device involved**: an EpiPen-class combination product — the
  Section E gate must open and its asks must run.
- **C5 — reluctant reporter**: heavy "I don't have that" / "rather not
  say", partial answers that force rule-9 re-asks, a repeat decision
  answered "no".
- **C6 — second run**: complete C2, then begin C3 in the same browser
  state — resume behavior is part of the product (#93).

## The checklist (seeded from the two rejections; every future Steve
finding becomes a permanent entry — removals are Steve's alone)

Each entry is answered with evidence, not a checkmark:

1. **Read every question aloud.** Does each read like a person wrote
   it? Any raw form-field wording, template artifact, "(yes or
   no)"-class construction, or option-code leakage anywhere — asks,
   acknowledgments, correction offers, open-fields rows, Review labels?
2. **Count the asks per case.** Within docs/ask-copy.md's budget? Is
   anything asked that the clinician already answered, or asked twice
   in identical words back-to-back?
3. **Screen integrity.** Does any string render twice simultaneously
   (the double-bubble class)? Does any screen contradict the
   transcript or the record?
4. **Side-by-side every surface against its mockup screen.** Same
   product? Composition, warmth, hierarchy — not token values. Note
   that recorded deviations (design.md) are fine; unrecorded drift is
   the defect.
5. **Copy honesty.** No filing/submission claims, privacy copy scoped
   per design.md, footer and open-fields counts truthful — including
   no phantom unknowns and no "Unknown"/sentinel printed on the PDF
   against stated words.
6. **The charter's question, answered in prose with reasons: would a
   clinician prefer this to the paper form?** This entry can fail the
   gate on judgment alone.
7. **Machinery voice.** Out-of-ask acknowledgments, correction offers,
   collisions: visible, human, truthful?
8. **Gates truthful.** Gated-off topics honestly labeled, reachable
   from Review, never counted as gaps — and C4 proves the device gate
   opens.
9. **PDF spot-check per case.** Exported values against the transcript
   — the silent-mis-fill sweep.
10. **The wince line.** Anything Steve would wince at that fits no
    entry above gets reported anyway; "no rule covered it" is not a
    pass.

## The strike rule (the gate's own falsifiability)

A Steve rejection after a READY verdict is a **strike**, and the miss
becomes a checklist entry the same day. **Two strikes within three
rounds = the gate is broken**: stop trusting it, take the failure to a
design conversation, and do not paper over it with more checklist
entries. Strikes are recorded in this file, under this rule.

Strikes to date: none.
