# Execution, recovery and publication

## Pipeline and access

Resolve an existing deployment, its revision and public discovery pointers before
provisioning. Use the verified selected AWS profile, account and region. Keep graph
access behind Persist and artifacts behind authorized storage locations. Validate
selector/rule/projection references and bindings before expensive execution.

Separate population generation, partition evaluation, aggregation and optional
publication into independently observable stages. Use bounded workers and durable
artifacts for batch scale. Choose infrastructure from workload/recovery needs;
the generic contract does not require a fixed count of Lambdas, a particular queue
implementation, or a particular entity's schema.

## Capacity and retries

Admit graph-intensive batch work through a shared budget. Define weight from
estimated source load, not just entity count. Coordinate preparation, partition
and within-worker concurrency. Protect higher-priority workloads through explicit
policy, keep waiting work observable, and distinguish consumer metadata from
authenticated authorization.

Track grants before releasing waiting workers; reconcile ambiguous callbacks and
terminal executions. Release capacity on success, failure, timeout and cancellation
without erasing the original failure location. Use bounded retries for transient
source saturation and fail unsupported queries/configuration without retry storms.

Ensure resumed/redriven work acquires or remains covered by capacity accounting.
Preserve successful partition artifacts and prevent duplicate aggregation. Do not
claim that a controller accounts for native redrive unless verified. The
[existing controller](implementation/capacity-operations.md) has a documented
reacquisition gap; account for it when operating that service.

## Required outcome persistence and optional result publication

Persist the result of every record-level evaluation, including the rule
identifier(s) that filtered out a subject. Use the
[outcome-persistence contract](outcome-persistence.md): produce a versioned
outcome manifest, fire-and-forget its event through the approved Event → Queue
path and idempotently persist outcomes asynchronously. Keep source facts
immutable, do not wait for queue or persistence completion, and do not introduce
synchronous per-record persistence into the Filter evaluation path.

Expose evaluation and persistence as separate statuses. Track planned, queued,
persisted, duplicate, failed and DLQ outcomes. The queue and persistence worker
own retry, redrive and recovery without re-running an otherwise valid Filter
evaluation; the Filter producer does not maintain an outbox or reconcile
dispatch state.

Default to producing result artifacts. Enable durable result publication only
through an explicit, compatible consumer contract. Define which entities or
relationships are published, their logical identity, model compatibility,
effective time, provenance and replay semantics. Do not infer publication from
the presence of related candidates or from a successful evaluation.

Use Persist's public ingest interface for graph facts. Resolve existing identity,
record unresolved/ambiguous references and avoid manufacturing replacement
entities to make an ingest succeed. Preserve logical fact identity across retries.

For asynchronous publication, return separate evaluation and publication status.
Correlate publication work to its source run/artifacts; track planned, resolved,
skipped, written and failed counts. A manifest describes work, not proof of writes.
Handle event-delivery/start failures and worker failures through alarmed recovery
paths. Verify expected facts after completion and on idempotent replay.

The [existing writeback adapter](implementation/eligibility-writeback.md) is a
narrow optional consumer. It does not make its entity type, relationship label or
activation policy part of the generic Rule Filter product.

## Deployment and observability

Discover data/artifact interfaces through the platform's public contract. Scope
roles to the required query/ingest APIs, input/rule/projection artifacts, outputs
and operational resources. Keep signing region consistent with the target API.
Encode deploy-time prerequisites when stack construction resolves dependency
parameters; do not label all dependencies runtime-only by default.

Package through Build/Marketplace/Deployer when distributing to tenants. Preserve
existing discovery, stateful resources and caller contracts during migration.
Use reviewed CDK/CI changes and runtime activation/rollback controls. See
[implementation packaging requirements](implementation/marketplace-and-migration.md).

Measure Filter phase durations separately from outcome-persistence queue age,
worker duration, active load, selection/evaluation counts, errors, retries,
cache behavior and publication outcomes. Benchmark equivalent runs before and
after adding outcome persistence; define the no-regression threshold before
testing and do not release a Filter-phase regression beyond its measurement
tolerance. Carry entity/adapter and artifact versions in bounded run metadata;
avoid high-cardinality IDs as metric dimensions. Coordinate shared metric
definitions with Porygon. Keep sensitive entity data in authorized artifacts
rather than logs or generic documentation.
