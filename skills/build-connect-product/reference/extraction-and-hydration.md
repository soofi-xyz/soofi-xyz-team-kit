# Python/PySpark extraction, changes and entity bundles

Implement this data path in the target repository. Use the pinned plan and
registered source definition from [contracts](contracts.md). Use boto3/SDK calls
for metadata/secrets, and distributed Spark/JDBC for data. Maintain one shared
pipeline for the real Glue entry point and local integration tests.

## 1. Plan safe source reads

Resolve credentials only in the job through the verified secret reference. Use
the configured Glue connection/VPC, TLS, read-only database grants and a pinned
JDBC driver. Keep database names, source SQL and partition policies registered.
Never log credentials, complete JDBC URLs containing secrets or source rows.

Load the entity-root table and bridge tables as full current state because they
define scope/linkage. A table without a trustworthy update field must also remain
full current state. An uninitialized table needs a complete baseline even when
other tables already have checkpoints.

For timestamp windows, push `cursor >= lower AND cursor < upper` into the source
query. Use the committed upper boundary minus configured overlap as the next
lower bound and `Plan.observedAt` as the pinned upper boundary before reads.
Seed the baseline cursor and advance empty windows as specified in
[plan semantics](contracts.md#request-and-plan-semantics). For append windows,
use `key > previous_max AND key <= captured_max` only under a validated append-only
contract. First runs/baselines use complete reads; bounded backfills use their own
half-open date predicates and cannot move the live cursor.

Keep source-owned predicates, entity scope and exclusions in every applicable
read. Generate key predicates in native types so indexes remain usable:

```sql
SELECT contact_id, record_id, email, updated_at
FROM source.contacts
WHERE record_id IN ('R1', 'R2')
  AND updated_at >= TIMESTAMP '2026-01-01 12:00:00'
  AND updated_at < TIMESTAMP '2026-01-02 12:00:00'
```

Do not wrap the indexed `record_id` column in a string cast. Validate/quote bound
values using the declared key type, reject SQL injection and never interpolate
unvalidated caller text. For a registered source query, apply filters without
changing its joins/predicates or exposing undeclared columns.

Use `dbtable` with a reviewed subquery when partitioning; set registered
`partitionColumn`, `lowerBound`, `upperBound`, `numPartitions`, fetch size and
query timeout. Keep aggregate active connections across simultaneous reads under
the environment limit. JDBC bounds determine partition stride; they do not filter
rows. Put scope filters in SQL itself. See [Spark JDBC](https://spark.apache.org/docs/3.5.6/sql-data-sources-jdbc.html).
Probe bounds with the same restrictions; never remove expensive predicates just
to estimate partitions. Avoid unconditional broadcasts when entity sets grow.

### `s3-file` reads

Resolve each table's object under the registered bucket/prefix once in
`planRead`: record `s3Uri`, ETag, size, last-modified and the SHA-256 of the
downloaded bytes in `TablePlan.sourceObject`, and reject an object above the
registered `maxBytes`. Read the exact pinned version (version ID or ETag match);
a changed object between plan and read is `ConfigurationDigestMismatch`, not a
silent re-read. The object digest is the table cursor: an unchanged digest is a
complete read with zero changed rows, never a skipped table.

Read `parquet` and `csv` through the schema-bound Spark readers with the
registered options. Read `xlsx` on the driver with
`pandas.read_excel(..., sheet_name=<sheet>, dtype=str)`, one sheet per table,
then `spark.createDataFrame` and cast to the registered types; this is the same
bounded rule as Transform's Excel adapter. Enforce `maxRows`, require the header
row to equal the registered columns in order, reject merged cells, extra
header rows and unregistered columns, and treat blank cells as null. Do not
infer types from cell formats.

`readEntityContext` filters the already materialized table by entity key; there
is no source-side predicate. `describeConsistency` returns
`single_object_snapshot`: every table read from one object is mutually consistent,
tables from different objects are not. Acquiring the object from a partner
system (SFTP, HTTP, manual upload) belongs to Connect service or an operator
step, not to this adapter.

## 2. Materialize and validate

Apply the registered projection plus operational columns, drop explicitly
excluded fields, enforce schemas/required keys and scope rows through the current
entity/bridge population. Fail duplicate record identities unless a registered,
deterministic source deduplication rule resolves them. Reject null or malformed
keys rather than giving unrelated records one empty identity.

Write sanitized typed inputs under the execution's `inputs/<table>/` and use
those immutable copies for hash comparison and retries. Record source read bounds,
start/end times, schema/configuration hashes and completeness per table. Publish
an input completion marker only after all planned reads finish. Partial input
materialization must fail or resume only with an explicit identity check.

`read_committed_materialized` means parallel JDBC reads may observe different
source instants; only the resulting files are frozen. Do not claim a transactional
snapshot. If cross-table consistency or every intermediate source event is required,
implement a database-supported shared snapshot or CDC adapter with its own tests.
Timestamp overlap reduces but does not prove protection against late commits or
non-monotonic updates; make those source guarantees part of registration.

## 3. Build and compare record indexes

Use this typed index:

| Column | Type / meaning |
| --- | --- |
| `table_name` | string logical name |
| `record_key` | string canonical identity; preserve string leading zeros |
| `record_hash` | SHA-256 hex of the registered canonical sanitized row |
| `linked_entity_ids` | sorted unique array of canonical string IDs |

For one key column, preserve string values exactly and render integral values
as base-10 strings without leading zeros. Support string/integral key types in
this baseline; reject null, floating-point and structured keys. For composite
keys, use compact JSON arrays in registered key order, each item a two-string
array `[sparkType, canonicalValue]`, for example `[["string","R1"],["long","7"]]`.
Pin UTF-8 escaping and no whitespace, and test collisions. Do not join components
with an unescaped delimiter. Require entity-link and root-key types to agree.

For new builds pin `spark-json-v1`: lexically ordered selected physical columns,
registered types, UTC, explicit `ignoreNullFields=false` and stable date/timestamp/
decimal serialization, then SHA-256 of UTF-8 Spark JSON. Exclude all generated
observation/lineage columns. Pin the selected-column/schema fingerprints and
Spark runtime in checkpoint compatibility. Existing Stage hash version 2 has its
own serialization behavior; characterize/migrate it rather than treating this
new contract as byte-compatible. Reject unsupported nested/map canonicalization
until deterministic ordering is implemented.

Compare current records to previous `(table_name, record_key)` rows:

- Missing prior identity → `new`.
- Equal identity with different row hash → `modified`.
- Equal hash → unchanged.
- Missing current row → no emitted deletion in this contract.

For a complete read, the next table index is its validated current index. For a
windowed read, merge current identities over prior identities and retain all
unseen prior rows, including when the current window is empty. Keep explicit
coverage for initialized empty tables; row presence does not establish initialization.
Hydrated rows must not silently broaden this checkpoint comparison boundary.

## 4. Resolve affected entities and fetch context

Resolve a changed row's direct entity key or its current bridge memberships.
Union and distinct the keys to form the direct affected set. For a registered
outgoing one-hop relationship, add only each direct entity's current related ID
when it exists in the selected root scope. Do not recursively expand, reverse
edges, add siblings or include outside-scope entities.

The primary use case uses current linkage. A source that can move records between
entities may also require notifying previous memberships or explicit retraction;
register/test that extension before claiming old associations are removed.
Ordinary source deletion is likewise not inferred from an incremental window.

Compute hydration targets from the published dependency closure of changed
tables, intersect with tables that were incrementally read, and remove
`loaded_window` targets. Full root/bridge tables are already complete. Include a
table's self-dependency when mapping output needs all its current rows for the
affected entities. Reject a missing or mis-namespaced dependency bundle.

For each target, fetch current rows for the final affected set:

1. Retain the entity bound, source predicates, exclusions and projection.
2. Drop only the incremental cursor predicate when the registered output needs
   complete current context. Preserve declared business/history filters.
3. Chunk IDs (default 5,000), throttle reads and stream bounded key batches. If a
   configured limit is exceeded, stop/replan; never replace a bounded read with
   an unrestricted table scan. Keep Spark data distributed.
4. For `latest_context`, execute the registered `jdbcContextQuery` with its
   entity predicate inside the source WHERE clause, then apply the canonical
   Spark `contextQuery` rank/order to historical plus current rows. Push category
   filtering and latest-row selection into JDBC; enforce the per-entity bound. Never replay all historical user
   events merely because a mapping needs the latest state in two categories.
5. Prefer an exact complete pinned snapshot only when its source execution,
   configuration/context version and cursor agree with the committed checkpoint.
   Otherwise use the registered bounded JDBC strategy. Propagate access errors;
   absence of a compatible snapshot is different from an unreadable one.

Store context under `hydration/<table>/` with provenance. Overlay duplicates by
registered identity and source-version/order rules; do not depend on partition
order or arbitrary `dropDuplicates`. A source mismatch that cannot be resolved
must fail rather than publish mixed contradictory rows.

## 5. Write each table's contract

Select current rows for affected entities using direct/bridge links. Overlay
validated hydrated context for current bundles. For a loaded-window table emit
only loaded-window rows for those entities. For latest-context emit only its
registered bounded context plus explicitly retained current events, as specified
by its policy. Keep those completeness labels in `Result.datasets`.

Build the ordinary record index before attaching output-only observations.
Annotate and verify tracked-value outputs as described in
[checkpoints and observations](checkpoints-and-observations.md). Observation-only
entities can add the tracked table's rows without widening every companion table.

Write each planned Parquet dataset, including typed empty datasets readable by
Spark, then count committed files/bytes/rows and validate the result manifest.
Keep ordinary outputs and generation artifacts immutable. Never publish a result
or checkpoint marker for an unfinished directory. Release cached frames in
`finally`; collect only bounded metadata and test-fixture rows on the driver.
