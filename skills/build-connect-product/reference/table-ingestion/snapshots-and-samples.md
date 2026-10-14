# Maintained snapshots, historical context and samples

Keep snapshot maintenance outside the extraction/delivery critical path. Use the
same source/configuration contracts but its own serialized application state,
ledger, table snapshots and freshness metrics.

## 1. Independent snapshot workflow

Trigger refresh from completed extraction results and run a scheduled reconciler
that discovers missed successful results. Paginate fully, keep a backlog cursor
and explicitly report bounded batches; never drop excess work. Record per-result
and per-table application identity so retries and missed events are recoverable.

Require a complete, unsampled baseline before creating a maintained table.
A delta covers affected entities and cannot initialize a full snapshot. Reject
unknown sampling/completeness provenance. A newly registered table remains
`awaiting_baseline` until a verified complete load exists. A subset/sample cannot
be promoted to a full baseline by changing a caller's mode label.

Apply runs in committed extraction ordering under a source-specific snapshot
lease. A Map concurrency of one within a workflow does not serialize two workflow
executions. Use the global lease and Glue concurrency settings together. Keep the
snapshot watermark distinct from the ingestion/consumer checkpoint pointer.

Implement three actions:

| Action | Behavior |
| --- | --- |
| Baseline | Atomically replace/create each eligible Iceberg table from complete typed input; empty baseline clears that table |
| Merge | Upsert emitted rows by stable record key; empty delta is a no-op; never create a missing table from a delta |
| Maintenance | Compact and expire eligible snapshots according to retention, preserving snapshots pinned by live plans/replays |

Attach output execution/time lineage separately from observation columns. Guard
updates so older runs cannot overwrite newer row versions. Use a total order
such as `(observedAt, executionId)` with an explicit tie policy; resolve duplicate
source keys deterministically or fail conflicting input before `MERGE`. An older
run may insert a previously unseen identity when policy allows replay. Do not
infer deletion from absence in a delta; only a complete baseline removes hard
source deletions under this contract.

Add compatible new columns. Reject unsafe narrowing/type changes. When a delta
omits a formerly projected column, exclude it from matched-row updates so old
values are not replaced by synthetic null; a later full baseline can deliberately
change the full schema. Preserve separate business observation and snapshot
lineage names.

Write per-table reports and snapshot IDs. Publish an `APPLIED` receipt and advance
the complete-result watermark only when all required tables have succeeded.
Keep partial reports for retry and never label `awaiting_baseline` or failed
schema updates a complete result. Use idempotent per-table application markers to
recover if table commits succeeded but ledger publication failed. Test this gap.

## 2. Historical context eligibility

A current table name or latest snapshot is insufficient for a mapping-aware
historical read. Require an exact receipt matching the source execution/time and
configuration/context contract of the pinned previous ingestion generation.
Require that table's `snapshotId`, complete-context provenance and any append-key
boundary. Time-travel to that snapshot; do not refresh its identity mid-run.

Run the registered category/predicate and deterministic latest-row selection over
historical context and the current source increment. Bound results per entity;
for example two registered categories may contribute at most two latest rows.
Do not carry all historical events when the mapping needs only latest context.

If compatible context is absent/incomplete, choose the registered entity-bounded
JDBC strategy and record the reason. If the ledger/object cannot be read due to
access, transport or corruption errors, fail or retry that error; do not silently
reinterpret it as permission to make a large database query. Do not expire a
snapshot while a pinned run still needs it.

## 3. Samples and selected-table work

Support two sample sources with a common explicit entity scope:

- `materialized`: read the successful prior result's pinned plan/input-audit
  datasets. Use its original source/configuration identity. A candidate projection
  can select existing columns but cannot manufacture columns the old input never
  read. Report missing requested columns and fail a required consumer-schema
  contract instead of claiming the candidate was fully exercised.
- `jdbc`: query current registered source rows for the requested entities using
  the same projection, exclusions, source predicates and linkage as normal reads.
  Permit newly projected candidate columns declared in the physical schema, and
  record current-read provenance. Register a candidate schema/source version
  before testing genuinely new physical fields; pin the effective output schema.
  Require no prior execution. Default to at most 50,000 explicit IDs and bounded
  chunking; reject larger samples instead of dropping the entity predicate.

Select a deterministic entity sample once, materialize its ID artifact and pin
it in the plan so retrying the same run cannot change the population. A supplied
projection override is authoritative even when invalid: presence selects override
mode; absence selects the registered projection. Restrict its URI scope, validate
safe identifiers and schema, and retain digest/revision in the plan/result audit.
Do not fall back to another manifest while reporting the requested one.

Keep output-only reserved columns out of source SELECT lists, raw manifests and
ordinary hashes. A materialized historical input does not contain later generated
observation columns; report that limitation. A live JDBC sample may explicitly
annotate current values as `sample_authoritative` for testing downstream mappings,
using a single pinned instant, but it must never claim a production transition or
be sent through automatic production checkpoint/snapshot promotion.

Selected-table and backfill modes reuse the reader/normalizer. Preserve date
bounds and entity scope, write typed output and complete metadata, and return
`checkpointEligible=false` with a null candidate. Keep their result namespaces
separate from the production stream's visibility. Do not advance the normal
cursor merely because the backfill read a more recent record.
