# Continuous safe optimization

Apply this overlay during every Oracle run. Optimization is normal operation and does not
require a separate user request.

The safety, access, completeness, durability, retry, concurrency, and publication contracts in
[`durable-orchestration.md`](./durable-orchestration.md),
[`continuous-ingestion.md`](./continuous-ingestion.md),
[`readiness-and-completeness.md`](./readiness-and-completeness.md), and
[`failure-modes.md`](./failure-modes.md) remain authoritative. An optimization is never
permission to weaken them. Keep unrelated healthy routes moving while benchmarking or
changing one route.

## Optimize terminal throughput

Optimize for completed, reconciled work rather than raw request rate. Prefer:

- more terminal work units and valid unique records per hour;
- fewer browser launches, timeouts, source errors, database transactions, and checkpoint
  writes;
- lower runtime, database overhead, memory use, and publication latency; and
- deterministic restart and replay.

Reject request-rate gains that increase source pressure, caps, errors, incomplete results, or
recovery risk.

## Find and measure the active bottleneck

Continuously classify each route's limiting stage as source latency, browser startup, session
bootstrap, list pagination, detail traversal, normalization, checkpoint writes, Neon loading,
publication, CPU, memory, disk, or network. Optimize only the measured bottleneck. Do not add
compute to a source-limited municipality.

Maintain a baseline per source, operation, tenant, and execution mode:

- terminal units/hour and valid unique records/hour;
- p50/p95 latency plus error and timeout rates;
- browser launches/reuses, list pages, and details fetched;
- bytes transferred;
- database rows per transaction and transaction count;
- checkpoint-write count and duration; and
- CPU and memory utilization.

Recalculate the baseline after source drift, VM wake, adapter or execution-mode changes, or a
meaningful workload change. Store benchmarks and decisions with the durable run evidence, not
only in chat or dashboard state.

## Run bounded experiments autonomously

For a plausible safe optimization:

1. Freeze and sign the current checkpoint.
2. Select a small, fixed source-work sample.
3. Run the control and candidate against equivalent work, changing one variable only.
4. Reconcile reported, captured, and stable source identities exactly.
5. Compare terminal throughput, errors, timeouts, resource use, and source pressure.
6. Accept or reject the candidate and persist the evidence.
7. Resume from the preserved checkpoint.

No user approval is needed for a non-destructive, bounded, reversible experiment that stays
within existing source policy, permissions, cost, and deployment blast radius. Human-required
actions listed in `durable-orchestration.md` still require human approval.

Adopt a candidate only when:

- reported and captured counts match the control;
- stable source identities match exactly, with no loss or duplication;
- timeout and error rates do not materially increase;
- source pressure remains within policy;
- checkpoint resume and replay remain deterministic; and
- terminal throughput improves materially.

Prefer at least a 5% measured throughput improvement. Accept a smaller gain only when it
materially reduces cost, browser launches, or operational risk, and record that reason.

## Roll back automatically

Every accepted optimization must have a source- or feature-specific switch, a known safe
fallback, and checkpoint compatibility wherever practical. Invalidate it on source drift or a
material rise in errors.

Roll back immediately when reconciliation differs, source throttling appears, errors rise
materially, browser or memory stability worsens, or checkpoint advancement becomes less
reliable. Resume from the last compatible committed checkpoint; never reset completed work.

## Evaluate candidates in this order

Within the existing source-access and concurrency contracts, evaluate:

1. Eliminate redundant work.
2. Reuse an authorized warm session within its valid worker lifetime.
3. Skip detail requests proven unnecessary for reconciliation.
4. Prefer official bulk, list, or API sources.
5. Pipeline independent stages.
6. Batch database and checkpoint writes.
7. Improve fair scheduling.
8. Increase inter-source concurrency.
9. Test intra-source concurrency cautiously.
10. Add compute only after proving CPU or database capacity is limiting.

Do not persist browser cookies, challenge tokens, or CAPTCHA state to obtain warm-session reuse.
Do not restart healthy workers merely to test a candidate.

## Reuse vendor improvements safely

When a candidate succeeds for a vendor family, identify compatible tenants, then run the same
small tenant-specific reconciliation pilot before enabling it. Keep per-tenant switches and
fallbacks. Never infer identical behavior across Accela, Tyler, Citizenserve, eSuite,
Click2Gov, or OpenGov tenants.

## Optimize loading and publication

Drive all writes through `query-db-loading-matching` and the established publication skills:

- incrementally load safe terminal rows when a configured backlog threshold is exceeded or a
  source completes;
- use high-water manifests to avoid rescanning committed artifacts;
- reuse byte-identical property artifacts by verified digest between immutable publication
  manifests; and
- coalesce publication execution until a source completes, the unpublished loaded delta
  exceeds `max(10,000 rows, 1% of public rows)`, coverage semantics change materially, or the
  user explicitly requests publication.

Every loaded-watermark advance still immediately marks the current publication stale and
queues a replacement immutable snapshot as required by `continuous-ingestion.md`. Coalescing
must not hide that state, mutate an existing snapshot, or permit `COMPLETE` while loaded and
published watermarks differ.

## Report optimization activity

Append these fields to the existing required status report without repeating its other fields:

- current bottleneck and active execution mode;
- last benchmark;
- accepted and rejected candidates;
- measured throughput, cost, browser-launch, or risk change;
- active rollback state; and
- next optimization candidate.
