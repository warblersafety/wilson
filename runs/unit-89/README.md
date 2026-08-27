# Unit #89 — full-session artifact

design.md's extended proof rule (2026-08-26): a UI or conversation unit's
PR carries the complete transcript and a screenshot of every surface state
a scripted end-to-end run traverses, and its reviewer pass reads that
session as a user before reading the diff.

## How this run was produced

`scripts/artifact-session.mjs` (Playwright) against `npm run dev` on
`localhost:3000`, no model calls — its header carries the exact recipe.
The run seeds `wilson.talk-session.v1` with the session `IntakeFlow` persists
after a Read-back confirm — a real `startTalk()`ed session whose record
already carries `Page1.SecA_Patient.PatientIdentifier` = "MRN 44-1902" and
`Page1.SecA_Patient.AgeValue` = "61", plus the clinician's opening
narrative as its first transcript turn — then drives the deterministic
chip paths ("I don't have that", and "No" at each repeat decision) to the
end of the walk. Typed answers are not driven: they call the extractor,
and no `ANTHROPIC_API_KEY` is present in this environment.

`session.txt` holds the per-turn record (the ask, and whether the
transcript ends with it), the complete 117-turn transcript, and the
rendered text of each later surface.

## What the run traversed

| Screenshot | Surface |
| --- | --- |
| `01-start.png` | Start (screen 01), before seeding |
| `02`–`05-followups-turn-*.png` | Follow-ups, four consecutive topic asks |
| `06`, `07-followups-repeat-*.png` | Follow-ups, both repeat decisions (suspect product, concomitant meds) |
| `08-review.png` | Review (screen 05) |
| `09-review-paper-facsimile.png` | Review with the Form 3500 facsimile shown |
| `10-open-fields.png` | Open fields (screen 06, drawn over Review) |
| `11-ready.png` | Ready |

59 turns driven, 117 transcript turns, **0 double-renders**.

`before/` is the same run against the pre-fix render (`Transcript` fed
`session.transcript` directly): every turn ends with the ask the teal
bubble below it repeats verbatim — Steve's 2026-08-26 rejection. Compare
`before/followups-turn-2.png` with `03-followups-turn-2.png`: identical
but for the removed gray duplicate.

## Known, out-of-scope things this session shows

- **Every ask is template-generated** ("What's the yes (yes or no), the no
  (yes or no), and the doesn't apply (yes or no)?"), 59 turns where the
  mockups promise 9 topics, raw manifest labels on the rail, Review, and
  the open-fields dialog. That is unit #90's whole scope — the ask-copy
  contract (`docs/ask-copy.md`). This unit is display-only and changes
  none of it.
- **The Ready surface shows a PDF-generation failure.** `api/generate-pdf.py`
  is a Vercel Python function; `next dev` does not serve it, so the fetch
  404s locally. Not a defect — the same page works on a Vercel deploy.
- Two turns log "identical text earlier in history": distinct topics whose
  template copy renders byte-identical. Also #90.

> **Note (unit #96).** `scripts/artifact-session.mjs` and
> `scripts/artifact-seed.ts` no longer exist — they were replaced by
> `scripts/gate-case-driver.mjs`, which walks Start through Ready with
> typed turns as well as chips (`CASE=C1`). This file records what was
> run at the time; the reproduce instructions above are historical.
