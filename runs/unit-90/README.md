# Unit #90 — full-session artifact

design.md's extended proof rule: a UI or conversation unit's PR carries
the complete transcript and a screenshot of every surface state a scripted
end-to-end run traverses, and its reviewer pass reads that session as a
user before reading the diff.

## How this run was produced

Playwright against `npm run dev` on `localhost:3000`, no model calls —
same driver as `runs/unit-89/`. It seeds `wilson.talk-session.v1` with the
session `IntakeFlow` persists after a Read-back confirm (record carrying
`PatientIdentifier` = "MRN 44-1902" and `AgeValue` = "61", plus the
clinician's opening narrative), then drives the deterministic chip paths
("I don't have that", "No" at each repeat decision) to the end of the
walk. Reproduce the seed with `npx tsx scripts/artifact-seed.ts`.

## What changed, in one line of the transcript

The walk's first question is **"And the sex?"** — rule 9's short re-ask
frame, because the narrative already gave the identifier and the age, so
PB-1 asks only for the fact still open. v1.1 opened with *"What's the
year(s) (yes or no), the month(s) (yes or no), and the week(s) (yes or
no)?"*

## Counts

| | v1.1 (`runs/unit-89/session.txt`) | this run |
| --- | --- | --- |
| Turns to walk the whole form | 59 | **28** |
| Template-generated questions | 59 | **0** |
| Raw manifest labels on Review / open-fields / rail | yes | **none** |
| Consecutive-identical asks | 2 | **0** |

The 28 turns are the contract's 21 ungated asks, the 5 gated asks the walk
still reaches (gate evaluation is the sibling PR's scope), and the two
repeat decisions.

## What the run traversed

| Screenshot | Surface |
| --- | --- |
| `01-start.png` | Start (screen 01), before seeding |
| `02`–`07-followups-turn-*.png` | Follow-ups: the rule-9 re-ask, then five authored asks in a row |
| `08`, `09-followups-repeat-*.png` | Both repeat decisions, in the contract's authored wording |
| `10-review.png` | Review (screen 05) — every row labelled by its display name |
| `11-review-paper-facsimile.png` | Review with the Form 3500 facsimile shown |
| `12-open-fields.png` | Open fields (screen 06) — display names, and rule 8's "you didn't have it" |
| `13-ready.png` | Ready |

`session.txt` holds the per-turn record, the complete 55-turn transcript,
and the rendered text of each later surface.

## Known, out-of-scope things this session shows

- **`date of this report` renders as a blank.** ReportDate is rule 4's
  auto field — stamped at export — and the stamping is the sibling PR's
  scope. It is correctly excluded from the open-fields dialog and its
  counts here.
- **Gated topics are still asked**: product availability, purchase, and
  the three device asks all appear. Gate evaluation (rule 5) lands with
  the derive rules.
- **The progress line still reads "TOPIC 1 OF 34".** design.md's round-2
  unit makes the nine rail rows drive progress and ordering; the contract
  records that it is compatible with this inventory, since asks keep their
  topic ids.
- **The Ready surface shows a PDF-generation failure.**
  `api/generate-pdf.py` is a Vercel Python function that `next dev` does
  not serve, so the fetch 404s locally. Not a defect.
