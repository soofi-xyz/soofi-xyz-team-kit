# Daily phone eligibility writeback

Use [the baseline](PRD.md#evidence-baseline). Filter is a producer of selected graph
facts through Persist; the older blanket read-only claim is obsolete.

## Activation and scope

Set `run_eligibility_ingest: true` only for the intended daily phone-call eligibility
run. Default false preserves ordinary phone segments, SMS, email, campaigns and
data filters. Do not infer activation from null/missing `rule_context`, from the
presence of phones, or from a successful Filter execution.

The run must be phone-only. Validate scope compatibility before enqueueing; never
publish an email/mixed-scope or debt-only pass list as daily `eligible_to_call`
facts. Context-selected SMS rules with phone candidates are still not the daily
phone-call eligibility run.

## Independent workflow

The Filter state machine emits a fire-and-forget EventBridge event with source
`filter.eligibility` and an output bucket/prefix pointer. The EventBridge rule now
starts a dedicated STANDARD ingestion workflow:

```text
PlanEligibilityIngest
  → ProcessEligibilityWorkItems (Distributed Map, max concurrency 2)
  → AggregateEligibilityIngest
```

Do not restore the older direct ingest-Lambda target from stale repository prose.
The parent Filter execution does not await completion; distinguish “results
produced/event emitted” from “graph eligibility facts ingested.”

The planner reads result parts, produces bounded work items and writes an ingestion
manifest under `<outputPrefix>/eligibility-ingest/manifest.json`. Preserve bounded
memory and conservative Persist concurrency when increasing scale.

## Graph contract

Normalize/deduplicate debt-phone pairs, resolve existing graph vertices, and use
GraphSON `vertexRefs` for `debt` and `phone_number` vertices. Emit `eligible_to_call`
edges through `POST /persist/ingest`; never create substitute debt/phone vertices
for unresolved keys or write directly to Neptune.

Read deployed Lexicon compatibility before activating a new edge/vertex producer.
Preserve deterministic edge construction in `src/eligibility/graphson.ts`. Current
`src/eligibility/tagger.ts` derives the fact date from the original output prefix's
UTC date: `effectiveAt` is that date at midnight UTC and `runIdentifier` is the date.
This is separate from the NY date used for rule windows. If the prefix lacks a date,
the implementation falls back to today's UTC date; verify the original prefix
before replaying so retry time does not change fact identity.
Record missing/ambiguous resolution counts and verify an intended retry does not
create duplicate logical eligibility facts.

Current bounds are 5,000 result debts per normalization batch, 400 natural keys
per resolution query and 500 edges per ingest request. Preserve the complete
reference set required by each ingest payload.

## Failure and recovery

Route EventBridge delivery/start failures and failed/timed-out/aborted ingest
executions to the alarmed DLQ. Inspect the independent ingest execution and manifest
before replaying or redriving. The manifest describes work items; read ingest totals
from the independent workflow's terminal output. Check normalized/resolved/missed
pairs and `edgesUpserted`: missing vertices can yield skipped pairs even when the
workflow succeeds. Parent Filter success alone cannot clear an ingest incident or
certify that graph facts exist.

Use `pnpm eligibility-dry-run` with the repository's documented arguments to inspect
planned normalization, references and counts before authorized live ingestion.
Dry-run validation is not evidence of successful graph writes. Use approved DEV
fixtures to test idempotency, missing vertices and lexicon rejection. The existing
`pnpm test:e2e` harness omits writeback opt-in, counts all historical edges and can
pass on zero facts. It cannot certify this run; require an explicit opt-in fixture,
independent ingest completion, and reads scoped to the expected debt/phone/date.

Source anchors: `src/eligibility/{results-source,tagger,vertex-resolver,graphson,persist}.ts`,
`src/handler.ts` plan/process/aggregate handlers, `lib/filter-stack.ts`,
`bin/eligibility-dry-run.ts`, `test/eligibility-*.test.ts`,
`test/handler-eligibility-distributed.test.ts` and the opt-in eligibility E2E test.
