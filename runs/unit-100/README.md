# Units #100 / #101 / #103 — full-session artifact

design.md's extended proof rule. Produced by `scripts/artifact-session.mjs`
against `npm run dev`, no model calls — its header carries the recipe, and
`npx tsx scripts/artifact-seed.ts` prints the seed.

## What changed on screen

**The open-fields dialog (#101), `10-open-fields.png`.** Its heading went
from **"122 fields are still open"** to **"105 fields are still open"**,
and — the part that matters more than the number — its first rows are no
longer the four age-unit checkboxes. Every entry is now a fact the
clinician was actually asked for and answered "I don't have that" to.
Compare against `runs/unit-90/10-open-fields.png`, whose list opens with
`age unit: years — not asked yet`.

Derive companions are still visible: they render on their anchor's Review
row, which is what rule 3's "visible at Review" says. `review.test.ts`
asserts a bare weight keeps its lb/kg rows on the card while they stay out
of the dialog.

**Re-ask frames (#100)** don't appear in this run: the scripted walk
dismisses whole asks, so nothing is ever partially answered. They are
covered by `ask.test.ts`, which drives every ask through every
single-field-resolved state. The three bulk-mapped asks now read

> And the rest of your contact details?

instead of enumerating nine field names. `session.txt`'s first turn —
"And the sex?" — is rule 9's ordinary frame, unchanged.

**Rule 8 (#103)** is a documentation amendment with no rendered change.

## Unchanged from `runs/unit-90/`

28 turns, 55 transcript turns, 0 double-renders, 0 template echoes, all
seven surface states traversed. Every screenshot but `10-open-fields.png`
is byte-identical to the previous run.

## Still true, and still out of scope here

- The count is per **field**, not per **fact**: one "none of those" to the
  outcome question leaves seven rows in the dialog, one per checkbox.
  Smaller version of the same problem, and already queued — design.md's
  round-2 curated Review rendering collapses checkbox groups.
- Gated topics are still asked, `date of this report` is still blank, and
  Ready still shows a PDF failure (`next dev` does not serve the Vercel
  Python function). All #90 part 2 or environment, as `runs/unit-90/`
  records.
