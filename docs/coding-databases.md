# Coding/classification data sources for the Suggestion layer

**Status: reference material for a non-goal.** wilson v1 ships with no
Suggestion layer at all (charter Non-goals, decided 2026-08-22, Issue
#27) — this research stays valid if that's revisited later, but nothing
here is near-term integration guidance.

Research from the 2026-08-22 design conversation on Issue #24, correcting
`docs/design.md`'s prior framing that the Suggestion layer's data source
"doesn't exist yet." It does — eight of the nine sources below are free,
and all eight are fully self-hostable with zero runtime dependency on any
external service once downloaded (nothing calls out to an external API at
request time, for any of them). Three of the eight — RxNorm, SNOMED CT,
and UMLS — carry a different kind of obligation instead: a free UMLS/UTS
license that must be renewed annually to keep using the data for *new*
records, a compliance task rather than a technical dependency. This doc is
the source-by-source detail; `docs/design.md` links here rather than
duplicating it.

## Why this matters for wilson specifically

Form FDA 3500 has no field that accepts a *code* anywhere — every field a
coding suggestion could inform (`DescEvent`, `Prod1Diagnosis`, product
identity, lab data, device identity) is free text on the actual PDF. So a
Suggestion layer can only ever nudge a clinician toward better phrasing or
a more precise product match — never populate a coded field, because none
exists. That headroom is what makes the free sources below viable: none of
them need to reproduce a specific regulatory vocabulary exactly, they just
need to help a clinician land on a more useful answer than they'd have
typed unprompted.

## The sources

| Source | What it's for | Form section / fields it feeds | Access | License / cost | Self-hosting |
|---|---|---|---|---|---|
| **NDC Directory** (FDA/openFDA) | Drug product identity — name, manufacturer, NDC code | D/F: `Prod1Name`, `Prod1NDC_ID`, `Prod1ManuComp` (and Prod2/concomitant-med equivalents) | Bulk CSV/JSON download, or REST API | Public domain (CC0), no registration | Fully self-hostable — zero runtime dependency |
| **RxNorm** (NLM) | Normalizes informal drug names ("the water pill") to a formal generic/brand name | Same D/F product-identity fields, as a front-end to NDC lookup | Bulk RRF files, monthly | Core content public domain; free UMLS license (annual report required) | Self-hostable, no runtime API call — annual reporting only, not a payment |
| **ICD-10-CM** (CDC/CMS) | Diagnosis/indication codes | D: `Prod1Diagnosis`, `Prod2Diagnosis` ("Diagnosis for use (Indication)") | Direct PDF/XML download from CDC | Public domain, no license at all | Fully self-hostable |
| **SNOMED CT US Edition** (NLM) | Broader clinical terminology — reactions, medical history, indications | B: `DescEvent`, `OtherHistory`; D: Diagnosis fields | Tab-delimited flat files, semi-annual release | Free UMLS/UTS account, signed Affiliate License, annual report | Self-hosted, no runtime call — but the free license must stay current to keep using the data for *new* records (lapsing limits you to reading pre-existing ones) |
| **LOINC** (Regenstrief Institute) | Lab test/observation names and codes | B: the lab data table (`TestData`/`TLowRange`/`THighRange`/`TDate`, Rows 1–8) | CSV/DB download | Free registration; perpetual use for any commercial or non-commercial purpose, just requires an acknowledgment/copyright notice | Fully self-hostable |
| **FDA Device Classification DB** (openFDA) | Device product codes | E: `Procode` | Bulk CSV/JSON, or REST API | Public domain (CC0), no registration | Fully self-hostable |
| **GUDID** (FDA AccessGUDID) | Device UDI lookup — serial/lot/catalog/expiration by identifier | E: `UDInum`, `SerialNum`, `LotNum`, `CatNum`, `ExpDate` | XML/pipe-delimited, daily/weekly/monthly full releases | Public domain, no account needed at all | Fully self-hostable |
| **UMLS Metathesaurus** (NLM) | Cross-vocabulary mapping layer — ties RxNorm/SNOMED CT/LOINC/ICD-10-CM concepts together, so one lookup can resolve across vocabularies instead of separate one-off integrations | Supports all of the above rather than feeding one field directly | Bulk RRF download | Same free UMLS/UTS license as SNOMED CT | Same ongoing-license caveat as SNOMED CT |
| **MedDRA** (MSSO) — excluded, see below | Reaction/adverse-event terminology matching FDA's own internal vocabulary exactly | B: `DescEvent`, in principle | No public bulk download — subscriber-only distribution | Paid, tiered by organization type/revenue. Reduced/no-fee tiers exist for regulatory authorities, non-profits, and small direct-care providers under €10M revenue — but a software vendor building a product around it falls under a separate paid "System Developer" subscription, not those tiers | No free path at all |

## Why MedDRA is out of scope, not deferred

The earlier framing in `docs/design.md` treated MedDRA as *the* coding
database, blocked on procurement, with everything else implicitly a
fallback. Both halves of that turned out to not hold:

- **The form doesn't need it.** There is no field on Form 3500 to write a
  code into — `DescEvent` is free text. A MedDRA-grade suggestion could
  only ever nudge phrasing, exactly like the free sources above.
- **Wilson's reporting path doesn't need it either.** MedDRA-coding is
  really a *mandatory-reporter* obligation — manufacturers submitting E2B
  reports to FDA are required to use MedDRA terms under ICH regulations.
  Form 3500 is voluntary healthcare-professional self-reporting, a
  different regulatory track; FDA's own MedWatch intake for that track
  doesn't require the reporter to submit a MedDRA-coded term. Any MedDRA
  coding that eventually happens to a wilson-originated report is FDA's
  own downstream process, unaffected by whether wilson exists.
- **There's no discount path for wilson's actual position.** MedDRA's
  reduced/free tiers are built for regulators, non-profits, and small
  direct-care providers — not for a vendor building a product around the
  vocabulary, which needs the paid "System Developer" subscription
  regardless of size.

Net: MedDRA is not a blocked-pending-procurement item for wilson. It's a
source that doesn't fit this product's scope, cost, or reporting pathway,
and the free stack above covers every codeable field the form actually
has.

## Suggested integration order, if/when the Suggestion layer is built

Not a commitment — a starting point for whoever scopes that unit, and
not itself the reopening this order would require: per charter
Non-goals, cutting the Suggestion layer was a deliberate scope decision,
and reopening it needs a new charter conversation before this list (or
any part of it) becomes a scoped unit.

1. **NDC/RxNorm (product identity)** — strongest fit. Suggestions here are
   close to unambiguous ("is this the drug you meant"), which makes
   "advisory, never authoritative" easy to keep honest in the UX.
2. **ICD-10-CM (diagnosis/indication)** — second-strongest fit, same
   reasoning, one step fuzzier than product identity.
3. **LOINC (lab data)**, **FDA Device Classification / GUDID (device
   identity)** — narrower, but genuinely useful for the sections they
   cover, and equally low-risk to integrate.
4. **SNOMED CT (reactions, medical history)** — weakest fit of the free
   sources: it's not FDA's canonical reaction vocabulary the way MedDRA
   would have been, so a suggestion here is "a broadly relevant clinical
   term," not precise regulatory phrasing. Still legitimate and free, just
   the one worth being explicit with the clinician about being the least
   precise of the six other free sources above (excluding UMLS, which
   isn't itself a suggestion source — see item 5).
5. **UMLS as the integration layer**, once more than one of RxNorm/SNOMED
   CT/LOINC/ICD-10-CM is in play — one registration and one client
   instead of four separate one-off integrations.
