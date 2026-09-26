# Synchronous single-debt evaluation

Use [the baseline](PRD.md#evidence-baseline). This capability already exists;
do not scaffold a second evaluator.

## Discovery and request

Discover `/rules/sync/evaluator-function-arn`, which points to the provisioned
`live` alias, and invoke with IAM `lambda:InvokeFunction`.

```json
{
  "debt_identifier": "D001",
  "ruleset_id": "phone",
  "include_rules_report": false,
  "evaluation_instant": "2026-09-15T12:00:00Z"
}
```

- Require a non-blank canonical `debt_identifier`; trim it. Do not accept `debt_id`
  aliases as the documented public contract.
- Omit `evaluation_instant` to evaluate now; otherwise pass a valid ISO timestamp.
  Preserve its campaign day-window meaning across midnight.
- Omit `ruleset_id` for `phone`. Current non-phone IDs require explicit
  `rule_s3_uris`; the ID is then a caller-facing label echoed in the response,
  not a catalog selector or a validated catalog identity.
- Optional `rule_s3_uris` is a non-empty list of explicit rule prefixes under the
  configured Lexicon root. Reject prefixes outside that root before loading rules.
- `include_rules_report` controls response audit fields, not evaluation mode.
- Do not pass batch population inputs, candidate scopes, rule context or batch
  reporting switches. The current evaluator classifies against phone semantics;
  batch email support does not imply synchronous email support.

## Execution

Resolve deploy-injected `PERSIST_API_URL` and `LEXICON_RULESETS_URI`. Load/compile
rules through the shared warm cache, build the single-ID report query, make one
bounded Persist call, classify, and return. Do not queue through batch capacity,
start Step Functions, invoke Glue, write S3 results, or emit batch cost metrics.

The cache currently keys normalized explicit URIs and context with a 300-second
TTL. Batch workers load directly instead. Cache failures are evicted. The cache
does not currently include manifest versions/ETags in its key; rules changed in
place may remain cached until TTL. Runtime time placeholders are replaced after
cache lookup, so no date-key change is needed merely to advance the clock.

## Response

```json
{
  "debt_identifier": "D001",
  "accepted": true,
  "ruleset_id": "phone",
  "ruleset_version": "1.0.0",
  "evaluated_at": "2026-09-15T12:00:00Z",
  "latency_ms": 143,
  "result": {
    "debt_identifier": "D001",
    "balance": 100.25,
    "first_name": "Jane",
    "last_name": "Doe",
    "postal_code": "12345",
    "tu_score": 650,
    "preferred_language": "en",
    "phone_numbers": [{ "phone_number": "5551112222", "day_windows": [] }]
  }
}
```

`evaluated_at` is completion wall-clock time, not an echo of `evaluation_instant`.
Store the original request instant as well as the response for replay evidence.
The example is abbreviated; preserve phone enrichment fields from the
[batch schema](batch-contract.md#result-locations-and-schemas). Return only passing
phones in `result` and strip rule reports from it. Explicit subsets report version
`custom`; the caller label does not establish the identity of the selected rules.

For rejection, return `accepted: false`, `result: null`, and one of:
`not_loaded_to_graph`, `debt_rule_failed`, `no_phone_numbers`,
`no_passing_phone_numbers`. When audit output is requested and a debt exists,
return top-level `rules_report` and `phone_numbers` with each phone's
`phone_rules_report`, including failed candidates. Do not confuse that audit list
with the accepted result's phone list.

Fail invalid inputs/rules and transport errors as Lambda invocation errors.
Use existing Persist tags such as `persist_timeout`, `persist_non_2xx`, and
`persist_result_not_unique`. More than one matching graph debt is an integrity
error. Never synthesize a rejection for a timeout or malformed rule.

## Current limits and open requirement

Current CDK config is Node 22, ARM64, 1024 MB, a 45-second Lambda timeout,
32,000 ms Persist timeout, and provisioned concurrency 1. The old PRD's 220 ms
Persist budget and <=300 ms warm p95 are **unverified target requirements**.
Do not promise them or reduce the timeout to 220 ms without measuring the graph
path and agreeing the compatible service contract.

The handler logs/returns latency, but the promised `CDM` single-entity latency,
count, error and cache-hit metric series are still missing. See
[known gaps](known-gaps.md) and [verification](verification.md).

Source anchors: `src/evaluate-debt.ts`, `src/config.ts`, `src/ruleset-loader.ts`,
`src/neptune-client.ts`, evaluator CDK construction and `test/evaluate-debt.test.ts`.
