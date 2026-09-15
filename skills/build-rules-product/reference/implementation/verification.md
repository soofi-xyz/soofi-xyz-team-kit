# Verification and operational evidence

Use [the baseline](PRD.md#evidence-baseline). The 2026-09-15 read-only assessment
passed `pnpm check` and 374 tests in 33 files at Filter `451a667`. This is a dated
baseline, not evidence for future edits or deployed AWS resources.

## Local commands

Run the repository's existing commands for the change:

```bash
pnpm check
pnpm lint
pnpm format:check
pnpm test
pnpm cdk:synth
```

`pnpm test` excludes cloud E2E tests. Run synth with the intended environment and
inspect resource replacements/IAM changes before deployment. Existing just recipes
are `type-check`, `lint`, `format`, `test`, `build`, `deploy`; the old PRD's
`just check` and `just cdk:synth` aliases are not present. Align command naming as a
separate change or use the real commands; do not report nonexistent aliases passed.

## Scenario matrix

| Area | Required checks for relevant changes |
| --- | --- |
| Caller input | CSV and Parquet, object/prefix, blank IDs, explicit S3 bypass, full graph input |
| Rule selection | Default phone, context matching, multiple manifests, inactive/no match, shared-rule deduplication/conflicts, explicit subset precedence and duplicates |
| Candidates | Phone, email, both with AND semantics, missing candidates, rejected candidates, empty/unsupported/incompatible scopes |
| Query/time | Filter versus report, report-only debt projection, exact `__NOW__`, NY midnight/DST, unsupported placeholders and compiler shapes |
| Artifacts | JSON and debt-ID CSV, selected candidate fields, stripped reports, detailed reports, mode-specific statistics, partial Map result indication |
| Sync | Accepted/rejected/missing/duplicate graph debt, explicit label semantics, prefix restrictions, timeout/non-2xx, pinned evaluation instant, no batch queue or S3 writes |
| Capacity | Priority/reserve/aging, unknown consumer, disabled passthrough, ambiguous callback, cleanup, reconciliation, native-redrive untracked-load limitation |
| Snapshots | Concurrent generation, head advancement, stale READY, missing TTL, SUPERSEDED, heartbeat lease loss versus transient faults, eager/consume flag combinations |
| Writeback | Phone-only opt-in, default-off/mixed/email/debt-only rejection, missing vertices, deduplication, idempotent date identity, independent workflow failure/DLQ |
| Migration | Legacy and canonical discovery, retained resources, tenant region/signing, allowed/denied S3 and API grants, prerequisite ordering |

Use existing Vitest and aws-sdk-client-mock conventions. Read the relevant test
files before adding coverage. Keep contract tests tied to observable behavior,
not documentation wording or implementation structure alone.

## Environment verification

Use the selected AWS profile and verify account/region through the existing access
flow. Discover the real workflow/alias and input/ruleset locations. Use approved
small DEV fixtures before broader runs; do not synthesize production identifiers
or claim a local fixture represents the deployed Lexicon.

1. Run supplied-input and full-population batch paths; check returned artifacts,
   execution status and any `failed_files_count` before certifying a full result.
2. Run phone, SMS and email requests with actual active context matches. Test
   approved positive/negative fixtures for each configured scope and context.
   A missing fixture or unknown deployed rule means coverage is unverified.
3. Invoke the qualified sync alias with known loaded/missing debts and compare
   compatible phone rules with batch report mode. Record request/rule identity and
   latency samples; measure warm p95 before making latency claims.
4. Verify capacity with the opt-in `pnpm test:e2e:capacity` harness only against the
   approved environment. Check quotas, reserves, cleanup and saturation signals.
5. For eligibility certification, explicitly opt in a phone-only DEV fixture, await
   the independent ingest workflow, then assert the expected debt/phone/date facts
   and idempotent replay. The existing `pnpm test:e2e` omits the opt-in flag, counts
   historical edges globally and can pass on zero facts; treat it as a legacy smoke
   until repaired, not proof of this run's writeback. Parent success is insufficient.
6. Capture effective snapshot flags, graph head, manifest freshness and generation
   outcomes; CI settings are not proof of deployed activation.

## Metrics and interpretation

Batch metrics use `CDM` with current Filter dimensions: predicted cost, actual cost,
suggested debts and suggested phone counts. Read `src/handler.ts` for the metric
payload actually emitted; do not assume every PRD-proposed metric exists. S3 results
and statistics remain the authoritative run artifacts. Cost estimates are directional
operational signals, not billing records. The current cost model combines Lambda
ARM64 GB-seconds/request prices, worker memory/file count, and Glue DPU-hours from
preparation execution time; keep pricing assumptions distinct from measured usage.

Capacity metrics use `Socapital/Filter` and cover active weight, queue age/depth,
admission, lease/config/callback/reconciliation failures, overrides, Persist
503/504 and adaptive reductions. The capacity dashboard exists. Verify Lexicon
registration and the company Main Dashboard separately; the local runbook records
that cross-repository integration as follow-up work.

The following `CDM` series remain required for the evaluator:

| Metric | Target dimensions |
| --- | --- |
| `rules_single_entity_latency_ms` | `service=Rules`, `ruleset` |
| `rules_single_entity_evaluations` | `service=Rules`, `ruleset`, `accepted` |
| `rules_single_entity_errors` | `service=Rules`, `error` |
| `rules_single_entity_cache_hit` | `service=Rules`, `cache=ruleset|persist-url` |

Add these without changing decisions or allowing telemetry failures to replace a
valid response. Resolve whether deploy-injected Persist discovery still needs the
proposed persist-url cache dimension. Coordinate metric registration/dashboards
with Porygon. Treat the 300 ms warm p95 as an open measured requirement, not an
assertion established by provisioned concurrency.

## Evidence to return

Record revision, environment/account/region, commands and results, fixtures/ruleset
identities, execution/request identifiers, artifact locations, measured latency,
recovery checks and unverified areas. Redact sensitive values; link authorized
artifacts rather than copying production contact records into reports.
