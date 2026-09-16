# Batch contract

Use [the baseline](PRD.md#evidence-baseline), [rule selection](rules-and-queries.md),
and [capacity onboarding](capacity-operations.md) together for new callers.

## Workflow input

| Field | Current behavior |
| --- | --- |
| `input_s3_uri` | Optional CSV/Parquet object or prefix. Both formats require `debt_id`; omit for the full graph population. |
| `rule_s3_uris` | Optional non-empty list of rule prefixes; overrides catalog selection. Each prefix contains exactly one JSON definition and one Gremlin query. |
| `rule_context` | Optional `{consumer, channel, calling_lane, campaign}`. `channel` accepts a string or string array. Selects matching catalog rulesets; consumer also informs capacity admission. |
| `candidate_scopes` | Optional non-empty array of `phone` and/or `email`; omission preserves phone candidates. Duplicate scopes normalize; reject unsupported scopes. |
| `save_rules_reports` | Default false. True selects report mode and produces detailed rule artifacts/statistics. |
| `skip_report_metrics` | Default false. Suppresses batch predicted/actual reporting; capacity/snapshot operational telemetry has separate controls. |
| `skip_phone_projection` | Default false. Requires report mode and no explicit `candidate_scopes`; evaluates debt rules without candidate fan-out. |
| `run_eligibility_ingest` | Default false. Opt in only for the intended daily phone eligibility run; use [writeback rules](eligibility-writeback.md). |

Do not expose worker fields such as `queryMode`, `candidateScopesProvided` or
`hasRuleSubset` as public workflow inputs. Select report mode through
`save_rules_reports`. `graphCycleId`, `graphReadyAt`, `business_date` and `runType`
are ignored for ordinary full-graph snapshot consumption; the service resolves
the current graph head itself.

## Rule selection versus candidates

`rule_context` chooses the applicable rules. `candidate_scopes` chooses which
contact populations must exist and pass. SMS/text is a channel using the `phone`
candidate scope. Choosing `phone` does not itself select SMS rules.

When both scopes are selected, all debt rules must pass, at least one phone must
pass all phone rules, and at least one email must pass all email rules. Run separate
executions for email OR SMS populations. Return only passing candidates from the
selected scopes. Validate scopes against the loaded ruleset; fail incompatible
combinations rather than silently widening the population.

In debt-only report mode, accept on debt rules alone. Do not use that pass list as
a contactable population without separately establishing contact eligibility.

## Caller examples

Resolve actual active Lexicon context fields and register the consumer before
running these illustrative requests; `example-*` values are not catalog entries.

SMS:

```json
{
  "input_s3_uri": "s3://tenant-input/sms/",
  "rule_context": { "consumer": "example-sms-consumer", "channel": "SMS" },
  "candidate_scopes": ["phone"],
  "save_rules_reports": true
}
```

Email only: set `channel` to `EMAIL` and `candidate_scopes` to `["email"]`.
For an intersection, set `channel` to `["SMS", "EMAIL"]` and candidates to
`["phone", "email"]`; preserve any required consumer/campaign/lane fields.
For historical phone behavior, omit both fields. For debt-only reports, set
`save_rules_reports: true` and `skip_phone_projection: true`, omit candidate
scopes, and select the intended debt rules.

## Result locations and schemas

A successful run returns:

```json
{
  "resultsS3Uri": "s3://output/filter/<execution-start>/<execution-name>/parts/results/",
  "resultsCsvS3Uri": "s3://output/filter/<execution-start>/<execution-name>/parts/results-csv/",
  "aggregatedStatisticsS3Uri": "s3://output/filter/<execution-start>/<execution-name>/aggregated-statistics.json"
}
```

Report mode additionally returns `rulesReportsS3Uri` pointing at
`parts/rules-reports/`. Use returned URIs instead of constructing keys. Per-file
artifacts use `<input-basename>_results.json`, `_results.csv`, `_statistics.json`
and `_rules_reports.json` in their corresponding directories. CSV contains
accepted identifiers under header `debt_id`; JSON contains `{ "results": [...] }`.

Each JSON result contains `debt_identifier`, nullable `balance`, `first_name`,
`last_name`, `postal_code`, `tu_score` and `preferred_language`.

- Phone output: `phone_numbers[]` with `phone_number`, `latest_phone_status`,
  `latest_rpc_contact_date`, `overall_call_start_time`, `overall_call_end_time`,
  `phone_usage_12_months`, `verified`, `verification_result`, and `day_windows[]`
  (`day_of_week`, `preferred_call_start_time`, `preferred_call_end_time`). Preserve
  the existing nullable/string types in `src/types.ts`.
- Email output: `eligible_email_candidates[]` with nullable string
  `email_identifier`, `email_address`, nullable number `contact_priority`, nullable
  boolean `verified`, and nullable UTC timestamp `verified_at`. The identifier is
  the Interprose `demographic_email_id`; metadata comes from the latest debt-scoped
  `person_email_status_changed` observation. Normalize source verification dates
  to midnight UTC; preserve null when absent.
- Strip rule-report maps from main results. Report artifacts contain
  `debt_identifier`, debt `rules_report`, phone identifiers with
  `phone_rules_report`, and selected email metadata with `email_rules_report`.

## Statistics: choose the correct mode

| Field | Filter mode | Report mode |
| --- | --- | --- |
| `input_debts_count` | Input rows | Input rows |
| `filtered_debts_count` | Accepted debts | Accepted debts |
| `filtered_phone_numbers_count` | Accepted phones | Accepted phones |
| `filtered_email_candidates_count` | Present for email runs | Present for email runs |
| `not_passed_rules_debts_count` | Input minus accepted; includes missing graph debts | Loaded debts rejected by rules/candidate requirements |
| `not_loaded_to_graph_count` | Omitted | Input minus returned graph debts |
| `not_passed_rules_statistics` | Omitted | Per-rule failure counts |

Use report mode to distinguish missing debts from exclusions. Never claim a rule
failed for every debt counted as `not_passed_rules_debts_count` in filter mode.
Per-rule counts need not sum to excluded debts: a debt can fail multiple rules.
Count a debt-rule failure once per failed debt. Count a phone/email rule against
a failed debt when all its candidates in that non-empty scope fail that rule.

Aggregate the per-file statistics without converting absent explanations into
zero measured failures. Inspect `failed_files_count` when present: it marks partial
counts from tolerated Map failures; do not report those as a complete population.
Read current Map failure tolerance and execution history before asserting full-run
success. Preserve successful artifacts for native redrive.

## Source and acceptance anchors

Read Filter `src/types.ts`, `src/handler.ts`, `src/classifier.ts`, `src/statistics.ts`
and `lib/filter-stack.ts`. Cover `handler-process-file`, `handler-list-files`,
`handler-aggregate-statistics`, `classifier`, `statistics`, and `filter-stack` tests.
See [verification](verification.md) for caller scenarios.
