# Unit #90 part 2b — full-session artifact

design.md's extended proof rule. `scripts/artifact-session.mjs` against
`npm run dev`, no model calls, `SHOT_TURNS=6` — the same settings as
`runs/unit-90-part2/`, so the two correspond file by file.

## What changed, in numbers

| | v1.1 | part 1 | part 2b |
| --- | --- | --- | --- |
| Turns to walk the whole form | 59 | 28 | **23** |
| Open-fields count after a full dismissal | — | 109 | **77** |
| Device / availability / purchase questions asked | all | all | **none** |

23 is exactly what `docs/ask-copy.md` states for "the ungated
single-product no-device walk": **21 authored asks plus the two repeat
decisions.** The contract's own number, reached by walking rather than by
counting the inventory.

The case is an antibiotic rash — no device, no product problem, no
OTC/compounded/cannabinoid/cosmetic product type — so rule 5 keeps six
asks out of it. `session.txt` contains the string "device" zero times.

## What to look at

- **`03-followups-turn-2.png`** — the rail's Product availability row
  reads **"not in report"**. Rule 5 is explicit that gated-off is never
  confirmed-absent, so it says what it is rather than showing a check or
  a blank. The same screenshot shows the facsimile's **DATE OF REPORT:
  2026-08-27** — rule 4's auto field, stamped for the preview because the
  exported PDF carries it, so the surface whose job is "this is what the
  form will look like" is not the one place it's missing.
- **`10-review.png`** — `date of this report 2026-08-27` on the Review
  card, and the Product availability card reading **"Not part of this
  report."** instead of five `—` rows. Rendering a gated section's fields
  as a wall of dashes is the confirmed-absent reading rule 5 forbids, on
  the surface the clinician signs off from; a first version of this
  README claimed those rows were absent when they were merely empty
  (reviewer pass, PR #107, F4). The card also has no Edit button, because
  reopening a gated section's fields cleared the very evidence its gate
  reads and foreclosed the section permanently (F3).
- **`12-open-fields.png`** — 77, down from 109, because a gated-off
  topic's fields are not gaps.

## What this artifact cannot show

The lab-table row gate and the derive rules both live on the extraction
turn, and the scripted walk drives chips only (a typed answer calls the
extractor, and this environment is keyless). `gates.test.ts` and
`derive.test.ts` cover them; the round gate (#96) is where a build meets a
live extractor.

Screenshots are comparable to `runs/unit-90-part2/` — same dev-chrome
suppression, same `SHOT_TURNS`. They are NOT comparable to
`runs/unit-100/` or earlier, which predate that suppression.

## Known, and out of scope here

- **The progress line still reads "TOPIC 1 OF 34"**, and gates make that
  worse rather than better: only 28 topics are now reachable in this
  case, so the denominator counts topics the clinician will never see.
  design.md's round-2 unit replaces it with the nine rail rows driving
  progress; this artifact is the strongest argument yet for doing that.
- **A gated-off section has no click-path back**, `ReportDate` is shown
  at Review but not editable, and a gate that opened can still be closed
  by a path this PR only guards rather than fixes. All three are one
  missing thing — no way to record "the clinician wants this part of the
  form" that is not a field value — and #99 now covers all three. The
  ReportDate half is why **this PR does not close #90**: AC-3 asks for
  "editable at Review", and that is the one part that did not land.
- The count is per field, not per fact (round 2's curated Review).
- Ready still shows a PDF failure: `next dev` does not serve the Vercel
  Python function.

> **Note (unit #96).** `scripts/artifact-session.mjs` and
> `scripts/artifact-seed.ts` no longer exist — they were replaced by
> `scripts/gate-case-driver.mjs`, which walks Start through Ready with
> typed turns as well as chips (`CASE=C1`). This file records what was
> run at the time; the reproduce instructions above are historical.
