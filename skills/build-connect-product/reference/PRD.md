# Connect ingestion — product contract

Build a configurable ingestion product that acquires registered source tables,
detects record changes and publishes the related data needed to process affected
entities. Use the Stage-derived PostgreSQL/JDBC workflow as the primary use case.
Retain its important semantics while replacing fixed tables, entity names,
credentials and deployment identities with versioned configuration.

This is a specification for a new implementation, not a claim that the reference
service already supports arbitrary sources. Create code and tests in the target
repository; keep shared skills. Read [implementation evidence](implementation-evidence.md)
when migrating existing deployments.

## 1. Ownership and boundaries

```text
Registered source + governed projection/dependency bundle + committed generation
  → resolve immutable run plan and acquire dataset lease
  → JDBC/PySpark read → sanitize → typed materialized inputs
  → record index comparison → directly affected entity IDs
  → configured related-ID expansion → hydrate required unchanged companions
  → typed entity bundles + observations + pending checkpoint generation
  → Transform → configured consumer(s), such as Persist
  → verified delivery acknowledgement → commit checkpoint generation

Successful extraction → independent snapshot refresh → Iceberg / query consumers
```

Connect owns acquisition, source normalization, read provenance, delta detection,
entity linkage, dependency hydration, observations, durable ingestion state and
maintained source snapshots. Transform owns translation between data languages
and graph mapping. Persist owns graph loading/readback. A row in Connect output
is context for an affected entity; it is not necessarily a changed source row.

Keep the existing partner API/webhook/SFTP Connect service and its flow compiler
separate. Reuse that skill when the requested integration uses those surfaces;
this ingestion contract does not redefine `/connector-jobs` routes. A transport
adapter may eventually supply the same typed datasets, but registration must
advertise only capabilities actually implemented and tested.

## 2. Adapters and extension point

Implement `postgres-jdbc` first and `s3-file` second; see the
[adapter registry](contracts.md#adapters). `postgres-jdbc` reads through
registered relations or reviewed, digest-pinned read-only SQL views; use Secrets Manager references and private
network access. Require a stable record identity, logical schema and an explicit
entity-link rule for every table. Support direct links and a current-state bridge;
express more complex joins as reviewed source-view artifacts with declared
operational columns. A source view enriches extraction; it does not perform the
downstream target-language transformation.

Implement an adapter boundary with `validate`, `planRead`, `readTyped`,
`readEntityContext` and `describeConsistency` responsibilities. Add another
adapter only with its identity, pagination/watermark, schema, credential,
consistency and conformance tests. Reject unsupported adapters.

`s3-file` reads one pinned object per table (Parquet, CSV or one Excel sheet) from a registered bucket/prefix, uses the object
digest as its cursor and supports full reads only; it is also the local fixture
reader. It does not fetch files from partners; that is Connect service or an
operator upload.

Keep typed Parquet as the required staging/output encoding for the primary
workflow, including schema-correct empty tables. Use Transform when callers need
CSV/JSONL or another target language; add direct Connect encodings only through a
versioned serializer contract with equivalent fidelity tests.

## 3. Registered policies

Publish these through Lexicon or its discovered compatible configuration surface:

- Source/version, adapter, connection and credential references, source language,
  entity type/root table and authorized scope.
- Table schemas, physical relation/read-only query, record keys, direct/bridge
  linkage, source predicates, exclusion policy and JDBC partition limits.
- Full-state, timestamp-window or verified append-only extraction policies;
  current-entity-bundle, loaded-window or bounded latest-context output semantics.
- Business column projections derived from downstream SQL plus operational
  columns required by extraction, linkage, filters, cursors and observations.
- Dependency bundles/closure from the same mapping release; logical names must
  agree across projections, dependencies, plans and downstream SQL views.
- One-way related-entity expansion and opt-in tracked-value observation policies.
- Dataset limits, runtime capabilities, checkpoint boundary, registered consumer
  and retention/snapshot policies.

Use [the exact schemas and examples](contracts.md). Pin digests and effective
settings once; do not reload moving configuration aliases after approval or retry.
Adding a compatible table/source must be a configuration release, not a new
source-name branch in Python.

## 4. Execution modes

| Mode | Data behavior | Production checkpoint |
| --- | --- | --- |
| `delta` | Use per-table committed cursors; first uninitialized table receives a complete baseline read | Candidate for the next generation only for an unscoped complete run |
| `baseline` | Read complete registered scope, rebuild hashes, emit complete current outputs | Candidate; mark full coverage explicitly |
| `tables` | Extract explicitly named tables/current data | Never advance the shared production generation |
| `backfill` | Bounded entity/date scope with half-open date windows | Never advance the shared production generation |
| `sample` | Selected entity IDs from materialized inputs or bounded live JDBC | Never advance production indexes, observations or snapshot watermark |

A date-window table can deliberately retain partial-history output even when
other tables supply current-state context. Describe completeness per table;
never call the entire result a full snapshot merely because all requested jobs
succeeded. A first complete baseline must be identifiable even for a zero-row table.

## 5. Required correctness

Implement [extraction/hydration](extraction-and-hydration.md) and
[checkpoint/observation](checkpoints-and-observations.md) algorithms exactly.

- Compare record identity/hash, not whole-file timestamps or entity hashes.
- Do not treat missing rows in an incremental window as deletions. The primary
  contract does not propagate hard deletes; a verified baseline refresh removes
  deleted rows from a maintained snapshot.
- Keep full root/bridge state when it defines the entity scope or linkage. Resolve
  changes in shared rows to every currently linked in-scope entity.
- Apply related-entity expansion only in its registered direction and hop count.
- Rehydrate required context without dropping entity bounds or widening history.
- Separate row hashes from output-only change annotations. Compare tracked values
  using their own previous state, not output membership.
- Commit indexes, cursors, coverage and tracked state as one logical generation
  only after the configured consumer succeeds. Block new production runs while a
  pending delivery requires recovery.
- Freeze materialized inputs for retries; JDBC parallel reads alone do not imply
  a cross-table transactional snapshot or complete capture of every source change.

## 6. Delivery and completion

Return a schema-validated result containing source/configuration identities,
read consistency, table completeness, per-table changed/hydrated/output counts,
affected-entity counts, dataset paths/schema identities and pending checkpoint
references. Persist exact plans/manifests separately from workflow payloads.

For downstream handoff, bind Connect logical output tables to Transform named
inputs and source-language version. Require schema compatibility and pass an
immutable result identity. A consumer acknowledgement must identify that result,
execution, configured consumer and successful consumer execution; caller-supplied
`success: true` without authenticated evidence cannot authorize promotion.

Maintain current-state snapshots asynchronously under their own ledger and
watermark. Treat extraction success, consumer delivery, checkpoint commit and
snapshot freshness as four separate outcomes. Prove each requested outcome with
[the acceptance suite](verification.md); do not infer live behavior from this PRD.
