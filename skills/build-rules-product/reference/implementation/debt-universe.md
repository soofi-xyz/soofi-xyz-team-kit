# Shared debt-universe snapshots

Use [the baseline](PRD.md#evidence-baseline). Preserve the difference between a
cached population of debt IDs and current facts used to evaluate those debts.
Rules still reads current graph facts during evaluation.

## Input routing

Caller-provided `input_s3_uri` bypasses snapshot preparation. When omitted, the
service resolves the singleton current graph head itself; callers do not supply
graph cycle, graph-ready time or run type to choose a snapshot.

With snapshot consumption disabled, preserve the legacy path:
Persist async all-debt query → poll → Glue Python Shell CSV sharding → ListFiles.
With consumption enabled, reuse a fresh READY snapshot, wait for a live generator,
or acquire a generation lease and mint the current snapshot.

FULL_DAILY `Persist Graph Ready` events track the head when either snapshot flag
is enabled. Eager minting additionally requires the eager flag. Do not mint for
arbitrary graph events or infer full readiness from an unrelated ingest success.

## Freshness and identity

- Keep the current lease identity at singleton key `current`, with a separate head
  pointer representing the current Persist graph cycle.
- Reuse READY only when `expiresAt` is present/unexpired and `manifest.graphCycleId`
  matches the live head. TTL deletion is eventual; enforce freshness in application
  reads as well.
- Publish READY with a transactional head check and revalidate afterward. Mark an
  overtaken generation SUPERSEDED and reacquire/mint; do not consume or page it as
  an infrastructure failure.
- Keep S3 generation prefixes immutable:
  `filter/debt-universe/{businessDate}/{cycleKey}/gen_n`.
  Generate debt-ID CSV shards and `_SUCCESS` evidence in the dedicated bucket.
- Preserve 90-day current-object/manifest retention and 30-day noncurrent versions
  at the inspected baseline. Do not conflate those with a permission to reuse a
  stale snapshot for 90 days.

## Lease recovery

Heartbeat generation leases. A named `DebtUniverseLeaseLost` conditional-write
failure may mark FAILED and page. Retry transient heartbeat infrastructure faults;
after retry exhaustion, stop without marking FAILED so stale-heartbeat recovery
can reclaim GENERATING. Preserve the execution consume buffer and five-hour
lazy-wait bound; ordinary lazy timeout is not a PagerDuty incident.

Eager terminal failures can produce both PagerDuty and a failed-generator DLQ
alarm. Correlate them as one incident; successful generation does not imply the
independent Filter evaluation or eligibility writeback succeeded.

## Current activation caveat

The two snapshot flags currently come from CI env/CDK context and require a
deployment. Both DEV and PROD CI set them true at the baseline; older Filter
AGENTS/CLAUDE prose claiming PROD stays false is stale. Verify actual deployed
values before reporting enabled/disabled state.

Runtime-operable activation is a remaining requirement. Do not copy the deploy-
time flag design into new features. Migrate to validated runtime configuration
with safely provisioned infrastructure and explicit rollback tests; do not
silently change the existing release while updating this documentation.

## Verify

Cover explicit S3 bypass, disabled legacy fallback, READY reuse, stale/missing TTL,
head advancement during generation, SUPERSEDED recovery, conditional lease loss,
transient heartbeat failure, eager-off/consume-on tracking, and simultaneous waiters.
Use the snapshot tests plus an approved DEV graph-ready fixture for live proof.

Source anchors: `src/debt-universe/{store,handlers,keys,types}.ts`,
`lib/filter-stack.ts`, `bin/app.ts`, `.github/workflows/ci-cd-{dev,prod}.yml`,
`glue/prepare_input.py`, and `test/debt-universe-*.test.ts`.
