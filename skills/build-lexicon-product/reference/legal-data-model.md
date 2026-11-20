# Legal data model (Trak) and its metrics

Use this when a task touches SOC's legal collections data from the vendor Trak:
claims, legal costs, judgments, remits, or the legal metrics. It says where each
piece lives today, what the metric support can and cannot express, and which
gaps belong to Dialga.

Re-read the sources at the current `main` before relying on any name below.
Never turn a count, release ID or digest from this page into a contract.

## Where it lives

| Piece | Location | Owner |
| --- | --- | --- |
| Vocabulary: vertices, edges, properties, enums | `Spring-Oaks-Capital-LLC/lexicon` `src/data/lexicon.json` (added in lexicon PR #963) | Legacy Lexicon |
| Metric spec (23 metrics) | `docs/trak-legal-metrics.md` in the same repository | Story owner |
| What is built and why the rest is not | `docs/trak-legal-metrics-build.md` | Story owner |
| Count and sum definitions (`BACKFILLING`) | `src/data/metric-definitions/{claim_stage,claim_placement,claim_forward,claim_judgment,claim_event,payment_remit}/` | Legacy Lexicon, via the Jirachi short-definition path |
| Snapshot, ratio, median and cohort metrics | `Spring-Oaks-Capital-LLC/legal-metrics-report` (report-1 Athena SQL), published to Prism Marketplace as `LegalMetricsReport` | Report (Bronzor) |
| Date-only business time | Persist `lambda/metrics/{catalogSchema,businessTime,compiler}.ts` (persist PR #515) | Persist (Conkeldurr) |

None of this is in `prismteam-ai/model`. No governed Model release defines the
legal vocabulary, so these are **legacy-only definitions** in the sense of the
[metric catalog contract](business-financial-metric-catalogs.md). Migrating
them needs a governed Model release of the legal vocabulary first. Until one
exists, report the migration as a Model vocabulary gap. Never create an
extension from the Lexicon copy to house them.

## Vocabulary

- `debt_has_claim` (debt → `claim`): one debt can have several claims.
- Reports from the vendor are out-edges of `claim`:
  - to `company`: `claim_placed_with_company`, `claim_forwarded_to_company`, `claim_legal_stage_changed`, `claim_legal_event_recorded`, `claim_judgment_reported` and `claim_balance_reported`;
  - to `lawsuit`: `claim_sued_in_lawsuit`.
- `claim_has_cost` (claim → `cost`) and `cost_billed_by_company` (cost → company). A cost line is a vertex; credits are negative `cost.amount`.
- Payments: `claim_has_payment`, `payment_collected_by_company` and `payment_remitted_by_company` (payment → company). The remit edge carries `client_net_amount`, `vendor_commission`, `costs_recovered_amount` and `vendor_payment_code`.
- `company.company_type` marks `LEGAL_VENDOR` and `LAW_FIRM`.
- `fee_code` and `close_code` on `claim_placed_with_company` are free text. Turning them into enums waits on Trak's confirmed code lists.

## Metric families

Each family has one root, a single-hop `DEBT` scope path and one status-event
out-edge read `EACH_EVENT`. All of them roll up to `GLOBAL` over
`company_represents_debt`.

| Family | Root | Scope path | Status-event edge |
| --- | --- | --- | --- |
| `claim_stage` | `claim` | `debt_has_claim` | `claim_legal_stage_changed` |
| `claim_placement` | `claim` | `debt_has_claim` | `claim_placed_with_company` |
| `claim_forward` | `claim` | `debt_has_claim` | `claim_forwarded_to_company` |
| `claim_judgment` | `claim` | `debt_has_claim` | `claim_judgment_reported` |
| `claim_event` | `claim` | `debt_has_claim` | `claim_legal_event_recorded` |
| `payment_remit` | `payment` | `debt_has_payment` | `payment_remitted_by_company` |

The claim families' business key is `claim.claim_number`. A claim reached from
more than one debt is excluded (`CROSS_SCOPE_IDENTIFIER`).

### Date-only properties

`judgment_date` and `event_date` are lexicon `format: date`. The family time
block gains an optional `date_only_properties` list (`<label>.<property>`
refs). Persist then dates those values as written, not as midnight UTC shifted
into `America/New_York`, which would put each row on the previous day. A Persist
without persist PR #515 ignores the list. Keep the list in any migrated catalog
schema, and treat a definition that dates by a date-only property as wrong on a
Persist that ignores the list.

## Gaps for Dialga

Each gap needs new Model or compiler support, not configuration. Jirachi hands
these back; do not hide them in prompts.

| Spec # | Metric | What it needs |
| --- | --- | --- |
| 11 | Legal spend | A sum over a two-hop scope (`debt_has_claim` → `claim_has_cost`), or a sum of a linked vertex property across many linked vertices. The report builds it today. |
| 15 | Judgment value awarded | An election on the latest report by a non-`status` property (`effective_at`, then `first_seen_snapshot`, then `created_at`), and a sum of several properties. Today each claim counts once and the three amounts are separate definitions. |
| 23 | Rows with unexplained codes | Trak's confirmed `fee_code` and `close_code` lists, then enums in the vocabulary. |
| 21 | Remit match rate | The ingestion run's unmatched count, which is not in the graph. |
| Others | Snapshots, ratios, medians, cohorts | A Model shape for them, or keep them in Report. |

Coordinate each new metric ID with Persist's closed definition set before its
Model release reaches a Persist deployment, as the catalog contract requires.
