# Units #100 / #101 / #103 — full-session artifact

design.md's extended proof rule. Produced by `scripts/artifact-session.mjs`
against `npm run dev`, no model calls, `SHOT_TURNS=6` — the same settings
as `runs/unit-90/`, so the two runs are directly comparable file by file.

## What changed on screen

**The open-fields dialog (#101), `12-open-fields.png`.** Exactly one
screenshot in this run differs from `runs/unit-90/` — verified with `cmp`,
all thirteen compared — and this is it.

Its heading went from **"122 fields are still open"** to **"109"**. Every
entry is now something the clinician was either asked for directly, or
could answer because they already gave the fact it hangs off.

**109, not the 105 an earlier round of this PR produced, and the four
extra are the interesting ones.** The first attempt excluded the whole
`derive` disposition. The reviewer pass showed that was wrong: `derive` is
a catch-all bucket, so a blanket exclusion also hid PA-1's *"returned to
the manufacturer, and when?"*, DV-3's *"who reprocessed it?"*, CM-1's
*"with rough start and stop dates"* — and a bare weight's lb/kg, which is
the case rule 3 is written around. The rule is now anchor state: a
companion is open once the fact it hangs off is answered.

Under that rule this run lists four age-unit rows, because the seeded
narrative says "61-year-old" and nothing has derived a unit from it. That
is honest — wilson genuinely does not know whether "61" is years — and it
is temporary: rule 3's bare-age default is #90 part 2's work, and once it
lands, `AgeYears` is answered and the exclusive-group rule closes the
other three. `ask-inventory.test.ts` asserts exactly that transition.

Derive companions remain visible on their anchor's Review row whether or
not they are currently listed; `review.test.ts` asserts both halves.

**Re-ask frames (#100)** do not appear in this run: the scripted walk
dismisses whole asks and never partially answers one. `ask.test.ts` covers
them instead, driving every ask through every single-field-resolved state.
The three bulk-mapped asks now read *"And the rest of your contact
details?"* rather than enumerating nine field names. `session.txt`'s first
turn — "And the sex?" — is rule 9's ordinary frame, unchanged.

**Rule 8 (#103)** is a documentation amendment with no rendered change.

## Unchanged from `runs/unit-90/`

28 turns, 55 transcript turns, 0 double-renders, 0 template echoes, all
seven surface states. Twelve of thirteen screenshots byte-identical.

## Still true, and still out of scope here

- The count is per **field**, not per **fact**: one "none of those" to the
  outcome question leaves seven rows. 26 asks covering 45 distinct facts
  still render as 109 rows. Same problem one level down; design.md's
  round-2 curated Review rendering already owns collapsing checkbox
  groups.
- Gated topics are still asked, `date of this report` is still blank, and
  Ready still shows a PDF failure (`next dev` does not serve the Vercel
  Python function) — all #90 part 2 or environment, as `runs/unit-90/`
  records.

> **Note (unit #96).** `scripts/artifact-session.mjs` and
> `scripts/artifact-seed.ts` no longer exist — they were replaced by
> `scripts/gate-case-driver.mjs`, which walks Start through Ready with
> typed turns as well as chips (`CASE=C1`). This file records what was
> run at the time; the reproduce instructions above are historical.
