# Performance and downstream consumers

## Measure stages separately

Record entity count, candidate fan-out, rule/query/model identity, data revision,
report mode, cache state, effective concurrency and environment for each timing.
Separate selection, materialization, queue wait, artifact loading/compilation,
source evaluation, projection/aggregation and optional publication. Record solver
or downstream action time separately from Rule Filter time.

Report wall-clock duration, source-query latency distributions, throughput,
retries, saturation and memory/cost estimates. Compare warm/cold and cache-hit/miss
runs; identify whether preparation was reused. A quoted total without this context
is not a product performance guarantee. Do not embed meeting-specific durations,
population sizes or fixed rule counts as service requirements.

## Optimization procedure

1. Identify the dominant measured stage and establish a representative baseline.
2. Inspect the selector and generated evaluation queries with the source owner's
   supported profiling tools. Measure returned cardinality, repeated traversal,
   candidate expansion and metadata volume.
3. Consider bounded ID batches, safe predicate pushdown, selective projection,
   governed derived indexes, snapshot reuse and compatible query-fragment sharing.
4. Prove decision/candidate equivalence and per-rule report attribution before
   adopting a rewrite. Preserve null/absence, time, ordering and scope semantics.
5. Measure end-to-end improvement at the same load and source visibility. Increase
   concurrency only within global/source budgets; more workers can increase queueing
   and retries instead of improving throughput.

Combining rules into one query can reduce requests and repeated work, but does not
guarantee a cheaper execution plan. Rule ordering can affect performance without
changing conjunction semantics; it must not alter result or report meaning.
Derived indexes need correct refresh/lag semantics. Never claim traversal sharing,
index coverage or production speedup from a parser fixture alone.

## Consumer handoff

Publish accepted entity IDs and requested metadata with selection, rule/model,
evaluation-time, source-visibility and completeness evidence. Agree how the consumer
handles stale, partial or unavailable results and whether it needs reevaluation
before acting. Supply documented types/nullability; do not make the consumer infer
metadata meaning from column names.

A solver can enrich/filter candidates further, compute scores and allocate scarce
resources or time slots. Rule Filter determines eligibility under the selected
rules; it does not own ranking, allocation or execution of the downstream action.
Its own worker-capacity admission protects infrastructure and is distinct from the
business capacity optimized by a solver.

Debt is an example source entity for such a handoff, not a required solver domain.
Use Abra for solver design and Xatu/Oranguru for communication-runtime integration.
The existing [solver parity reference](../../assemble-communication-runtime/reference/current-solver-parity.md)
is an optional consumer example. It does not define the generic product's output
schema, score model, rules or scheduling policy.
