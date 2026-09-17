# Connect ingestion contracts

Use [ingestion.schema.json](contracts/ingestion.schema.json), JSON Schema Draft
2020-12, as the structural authority for contract version 1. Validate named
`urn:connect:ingestion:contracts:1#/$defs/<Name>` definitions; the root document
is a definition library. Implement semantic checks below in TypeScript and the
Spark worker. Examples describe the new contract, not deployed Stage inputs.

## Boundaries

| Definition | Producer → consumer | Required meaning |
| --- | --- | --- |
| `Environment` | operator → resolver/CDK/local CLI | Account/region, configuration scope, storage, runtime and bounded cost |
| `SourceCatalog` / `SourceDefinition` | Lexicon → resolver | Exact enabled source/version, credential references, language, tables and delivery boundary |
| `Table` / `SourceRead` / `EntityLink` | source owner → adapter | Source/output schemas, physical relation/query, identity, entity association, extraction and output policy |
| `Projection` / `Dependencies` | mapping release → resolver/worker | Same-release business fields and materialized dependency closure |
| `ObservationPolicy` | policy release → worker | Canonical-value query, required source fields, output-only timestamp semantics |
| `Request` / `Scope` | caller → workflow | Source/version, run mode, selected tables/entities/windows and optional sample override |
| `Plan` / `TablePlan` | resolver → worker | Pinned artifacts/checkpoint, stable time, exact selected columns, bounded read modes and eligibility |
| `Dataset` / `Result` | worker/reporter → consumers | Typed Parquet outputs, counts/completeness, plan identity and optional checkpoint candidate |
| `FileManifest` / `StateDataset` / `Checkpoint` | worker → committer | Exact files, cumulative state, empty-table coverage and cursor/hash provenance |
| `Acknowledgement` / `Commit` | authenticated consumer → committer/caller | Result-bound success evidence and conditional generation promotion |
| `SnapshotReceipt` | snapshot workflow → context reader | Applied source result, exact table snapshot IDs and optional context completeness |
| `Failure` | boundary handler → operations | Sanitized phase/code and partial artifact locations, not source records |

Use immutable bytes for registered objects and manifests. An `Artifact` is
`{s3Uri, sha256}`; hash the exact UTF-8/file bytes including whitespace/newlines.
Do not invent a digest from a URI. Canonicalize request JSON in TypeScript by
recursively sorting keys by UTF-16 code units, preserving array order, using
ECMAScript JSON number encoding, rejecting nonfinite numbers and omitting no
fields except those actually absent. Hash it as UTF-8. Pass that digest downstream.
Use the same canonicalization for acknowledgements. Reject duplicate JSON object
keys before parsing either boundary; do not let different parsers select different
values. Persist canonical acknowledgement bytes and their digest as the receipt's
artifact. See the [acknowledgement protocol](checkpoints-and-observations.md).

## Complete configuration example

Read these together:

- [local environment](examples/environment.local.json), [catalog](examples/config/catalog.json)
  and [source definition](examples/config/source.json);
- [projection](examples/config/projection.json) and [dependency closure](examples/config/dependencies.json);
- the source definition's five Spark schema artifacts and
  [canonical status query](examples/config/record-status.sql);
- [baseline request](examples/baseline-request.json), [delta request](examples/delta-request.json)
  and [two-run fixture](examples/primary-case.json).

Every reference in the example catalog/source definition has the actual digest
of the supplied bytes. The example secret ARN/account/connection and price are
synthetic. Materialize `examples/config/*` at local URI-equivalent paths under
`<localObjectRoot>/connect-local/config/`; local execution uses test tables and
must not retrieve that secret or contact AWS. On real publication, substitute
approved resources, recalculate child-to-parent digests and publish the catalog
last through Lexicon. Do not copy local fixture credentials into a live source.

## Registration semantic validation

1. Require one catalog entry for each `(source.id, source.version)`; reject
   duplicates, disabled registrations, unknown adapters and mismatched artifact
   identities. Requests select concrete versions; no implicit latest version.
2. Require nonempty enabled tables, a full-read root table and a nonnull unique
   entity ID. Resolve every direct link and bridge field against registered Spark
   schemas. A bridge must be an enabled full-current-state table in the same
   extraction scope. Reject missing keys and ambiguous joins; shared bridge rows
   may deliberately associate one record with several entities.
3. Validate relation/column identifiers as bare letters/digits/underscore with a
   nonnumeric first character. Review and parse source SQL as read-only PostgreSQL
   SELECT/CTE; review canonical/context SQL as single Spark SELECT/CTE. Treat
   `predicate` as one PostgreSQL boolean expression without a WHERE keyword,
   subquery or extra statement. Reject
   arbitrary public SQL, DDL/DML, undeclared sources/functions and unbounded query
   templates. SQL/configuration authors are trusted publishers, not callers.
4. Compute selected fields as business projection ∪ operational columns ∪ record
   keys ∪ entity/bridge/related links ∪ cursor/partition/filter fields ∪ tracked
   policy dependencies. Every required field must exist. Apply explicit exclusions
   before materialization; reject any exclusion that removes a required field.
   Require `outputSparkSchema` to match the selected typed output plus declared
   generated observation columns; keep it separate from the physical read schema.
   A missing projection or zero-table manifest is an error, not `SELECT *`.
5. Require projection and dependency `source` and `mappingRevision` to agree.
   Dependencies use only enabled logical table names and declare a precomputed
   closure. Validate closure and reciprocal bundle requirements at publication.
   The worker applies the closure once; never invent transitive mappings at runtime.
6. Validate a nonnull reliable timestamp for `timestamp_window`, or a proven
   immutable monotonic key for `append_window`. Otherwise require a full read.
   Match cursor types and parsing to the registered Spark/JDBC types. Do not use
   a date filter or JDBC partition bound as proof of incremental completeness.
7. Require `latest_context` to supply a pinned context SELECT, declared ordering,
   category predicates and maximum rows per entity. Also require a
   `jdbcContextQuery` for equivalent source-side bounded latest selection. Its
   one `{{entity_predicate}}` placeholder must appear in the source WHERE clause;
   render it from validated typed keys/registered columns through the adapter,
   then parse/validate the final SELECT. No other template/code substitution is
   allowed. Reapply the Spark context query to historical plus current rows so
   both JDBC and pinned-snapshot strategies yield the same ranking.
   `loaded_window` must never
   be selected for full-history hydration. A `current_entity_bundle` output from
   an incremental read requires a safe entity-bounded context read.
8. Observation IDs/output columns must be unique. Require policy source columns
   and canonical query identity, reject case-insensitive reserved-column
   collisions, and ensure one canonical value per record. Transition timestamps
   use the execution instant; retained source-time policies require a nonnull,
   strictly advancing source time when the canonical value changes.
9. Require a configured consumer ID for `after_consumer`; require null for
   `after_extract`. Only an authorized configuration release may change this
   boundary; execution input cannot downgrade it.

## Request and plan semantics

Support only the modes in the PRD. A `tables` request requires known enabled
names. `backfill` requires at least one actual bound; an empty `scope` is invalid.
Date windows require `fromInclusive < toExclusive` and a registered date field.
Samples require a nonempty entity-ID artifact or a positive bounded entity limit;
materialized samples also require a successful source result artifact. Entity-ID
artifacts contain a JSON array of unique canonical string IDs; validate before
constructing source predicates. Reject IDs outside the authorized source scope.

For `sample`, an explicitly supplied `projectionOverride` is authoritative.
Blank, null, malformed, unreadable or unauthorized overrides fail; absence alone
selects the registered projection. Record its exact digest in the plan. Limit the
override to the configured publication prefixes and validate the registered
operational fields even when business columns change. New sample columns must exist in the registered
physical Spark schema; publish a candidate source/schema version first when they
do not. Pin a sample-specific effective output schema, including generated
columns, rather than mislabeling it as the unchanged production output schema.

Any table/entity/date restriction makes a run ineligible for the shared production
checkpoint, even if it happens to return every current row. Reject incompatible
`authoritativeInitialObservations` on an ineligible production run. Keep sample
annotations explicitly identified as sample-only. Unknown fields/options fail.

Resolve `Plan.observedAt` once from the workflow execution start, always UTC.
Pin `sourceDefinition`, projection, dependencies, schema/policy/query digests and
one complete previous checkpoint. Put credential references, never secret values,
in the plan. Classify first-load tables from `Checkpoint.coverage.initialized`,
including tables initialized with zero rows. An access failure is not first use.

Keep physical `sparkSchema` and final `outputSparkSchema` identities separately
pinned in each table plan. A result dataset references the actual output schema.
Validate normal output against the registered output schema; sample-only schema
changes still require the intended consumer's schema compatibility check.

`TablePlan.lowerBound`/`upperBound` are canonical values in the registered cursor
type (UTC ISO timestamps or decimal integer strings). Full reads use null bounds;
window reads record actual effective bounds after overlap. `completeRead` is false
for a partial window or selected entity scope. The worker revalidates plan/execution
identity and every configuration digest before reading data.

For `timestamp_window`, set the production upper bound to `Plan.observedAt` and
the lower bound to the previous committed table cursor minus registered overlap
seconds. Apply `cursor >= lower AND cursor < upper`. A successful complete baseline
seeds that table's checkpoint cursor with `Plan.observedAt`, including an empty
baseline; subsequent successful windows advance it to their pinned upper bound,
including empty windows. A missing cursor on an initialized timestamp table is
incompatible state, not permission to scan everything. The cursor is a timestamp
boundary, not the greatest timestamp returned. Reject a nonadvancing upper bound;
resume retries from their existing plan. See [source read planning](extraction-and-hydration.md)
for append windows and source-consistency limits.

## Output, state and failure semantics

Store artifacts under a source/execution namespace:

```text
runs/<source-id>/<execution-id>/plan.json
runs/<source-id>/<execution-id>/inputs/<table>/
runs/<source-id>/<execution-id>/hydration/<table>/
runs/<source-id>/<execution-id>/outputs/<table>/
runs/<source-id>/<execution-id>/result.json
checkpoints/<source-id>/<generation-id>/{record-index,tracked/<policy>,files,checkpoint.json}
snapshots/<source-id>/{ledger,reports,warehouse}/
```

Treat checkpoints as immutable generation objects, not mutable `latest/` data.
Use a conditional pointer/lease store for visibility. A `StateDataset.filesManifest`
pins every data file's URI, size and SHA-256, excluding temporary/metadata files;
verify file manifests and row counts before committing. `coverage` must explicitly
cover every enabled table and record hash/projection/schema/cursor compatibility.
Empty datasets still have schemas, completeness evidence and `recordCount: 0`.

`Result.status: EXTRACTED` proves validated extraction, not consumer delivery.
Each dataset declares `full_source`, `entity_bundle`, `loaded_window`,
`latest_context` or `sample` completeness. Counters use these units:

- `changedRecordCount`: distinct changed `(table, key)` identities;
- `directImpactedEntityCount`: distinct entity IDs from changed record links;
- `expandedImpactedEntityCount`: total distinct IDs after registered expansion;
- `Dataset.rowCount`: actual emitted rows, including unchanged required context;
- `Dataset.hydratedRowCount`: distinct accepted rows fetched into context; it is
  not necessarily an additional number to add to output rows.

A source-version change does not create a new independent checkpoint stream by
accident. Namespace the stream by tenant/environment/source ID, retain the source
version in every artifact, and require an explicit compatibility/migration verdict
for projection/hash/policy changes before reusing its committed state.

Use stable error tags: `SourceNotRegistered`, `RegistrationInvalid`,
`ConfigurationDigestMismatch`, `CheckpointUnavailable`, `CheckpointIncomplete`,
`CheckpointConflict`, `DeliveryPending`, `ScopeInvalid`, `ReadLimitExceeded`,
`SchemaMismatch`, `DuplicateRecordKey`, `HydrationUnavailable`,
`ObservationTimestampInvalid`, `OutputIncomplete`, `AcknowledgementMismatch`,
`SnapshotBaselineRequired` and `SnapshotSchemaConflict`. Preserve the phase,
retryability and diagnostic artifact location; do not expose secrets/source rows.
