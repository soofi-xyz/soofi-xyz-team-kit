# Contract definitions and baseline decisions

Use [`contracts.schema.json`](contracts/contracts.schema.json) as
the machine-readable authority for contract version 2. Use the semantic rules
below and the language/graph references alongside it. Examples are illustrative;
they do not supersede the schema. Implement matching TypeScript/Python validators in the target repository. Keep
types, validators, fixtures and the schema synchronized when changing a field.

## Contracts

Reference an individual schema as `urn:transform:contracts:2#/$defs/<Name>`.
All boundary objects reject unknown fields unless explicitly declared as a map.

| `$defs` name | Producer → consumer | Meaning |
| --- | --- | --- |
| `Environment` | operator → CLI/CDK/control plane | One environment's identities, scopes, runtime, limits, pricing and integrations |
| `Request` | caller → resolver | Source/target language names, named input S3 locations and output S3 prefix; no versions, mapping selection, formats or options |
| `Catalog` / `LanguageRegistration` | Lexicon publisher → resolver | Revision, mapping artifact identities and language registrations that point at Lexicon language definitions (the schema) with status, shape and current-version flags |
| `Mapping` / `MappingOutput` / `Query` / `Output` | Lexicon publisher → resolver/worker | Exact directional versions, named views with formats/options, output shape/format/profile/options, output dependencies and SQL identities |
| `Graph` / `Endpoint` / `Property` | mapping author → graph validator/writer | Returned-column bindings, referenced vertex datasets and typed properties |
| `Plan` | resolver → worker/reporter | Concrete registrations, copied input objects, query identities, output settings and cost decision |
| `Resolved` | resolver → workflow | Execution ID, plan URI/digest and cost decision |
| `Approval` | authorized callback caller → validation state | Decision bound to execution ID, exact plan digest and ceiling |
| `Result` / `DatasetResult` | worker → reporter/caller | Verified completion manifest, logical identities, output paths, counts and schemas |
| `Failure` | failure handler → operations | Phase, stable error classification and execution identity without source records |

Read [the worked example](worked-example.md) for a complete tabular publication,
request, source records and expected values. Its artifacts carry actual byte
digests. Implement fixture materialization in the target repository; these
example files are configuration and test data, not an executable product.

Use one `queryS3Uri`/`querySha256` pair OR a nonempty ordered `queries` array of
objects with those same two fields. Never supply both forms. `dependsOn` lists
output dataset names, exposed as `target_<dataset>`. Source views must use the
`source_` namespace. Reject missing dependencies, cycles and undeclared table
references. Queries are single Spark SELECT/CTE expressions; the worker parses
them before `spark.sql()` and rejects commands or multi-statement SQL.

## Registration semantics

Treat `(language name, version)` and `(mapping ID, version)` as immutable unique
identities. A request names languages only, so exactly one enabled
`current: true` registration must exist per language and exactly one enabled
mapping per resolved pair. A mapping always names concrete versions in both
directions. No implicit inverse, intermediate language, wildcard version or
best-match selection exists. Disabled registrations fail; same-language format
conversion requires its own registered mapping.

A language registration points at the Lexicon language definition; that
definition is the only schema. Datasets, columns, nullability and Spark types
derive from it with the type table in [languages-and-mappings.md](languages-and-mappings.md).
Graph role bindings live in the mapping output's `graph` block and must agree
with the definition's `edges[].from`/`to`. The graph reference
uses a **complete export** contract in this baseline: every edge endpoint references
a vertex dataset produced by the mapping. Reject partial graph exports until a
versioned reference-snapshot contract and its validation are implemented.

Column order is the definition's property key order; definitions are immutable
byte artifacts, so that order is stable. Logical constraints are the definition's
`type`, `format`, `enum`, `pattern`, `minLength` and `items`. Reject unsupported
property types or keywords at publication rather than ignoring them. SQL controls
flattening and type conversion; CSV and Excel reject nested target fields.

## Format behavior

Use each mapping input's declared format, sheet and options; the request carries
none. Validate options at publication against the format-specific allowlists
below as well as the structural `Options` definition. Only hidden/underscore-prefixed metadata files
are excluded from directory enumeration; source locations must contain only the
named dataset. Missing required bindings/files fail; valid zero-row datasets are allowed.
Missing optional bindings create a schema-bound empty DataFrame. Reject duplicate
input bindings and unknown dataset/view names.

CSV uses UTF-8, a header, comma delimiter, doubled quotes, `\N` for null, and
empty string for a quoted empty field. The reader's `emptyValue` is the empty
string; the writer emits a quoted empty field so it survives rereading. A literal
null-marker string is rejected on output. Headerless input uses registered Spark
column order. Date/timestamp formats and UTC are pinned. Raw streaming validation
checks headers, row widths and logical records before the native Spark reader;
include this additional read in capacity measurements.

JSONL is one standard JSON object per nonempty line, with explicit null handling
and no unknown fields. Parquet retains native types. Excel (`xlsx`) binds one
sheet per dataset: the mapping input's `sheet` (default: the table name) is read
from every workbook under the input location with a header row and the
definition's types; output writes `<dataset>.xlsx` with one sheet named after the
dataset. Excel is not a distributed format: the adapter runs on the driver and
rejects datasets above the configured row/byte ceiling (never above Excel's
1,048,576 rows). All formats undergo logical row validation in addition to
parsing. Non-Excel checks run on executors, not through whole-dataset collection
on the driver.

The optional Neptune CSV profile emits only explicit role/property bindings.
The baseline supports scalar Neptune property types from `Property.type`.
It rejects empty strings, semicolons and backslashes in string properties until
an explicit, tested escape/empty-value extension is added. Generic graph
Parquet/JSONL/CSV preserves registered query columns without Neptune headers.

## Execution, integrity and output

Use `runs/<executionId>/` in the artifact bucket for reservation, input snapshots,
catalog copy and plan. S3 copies use the source ETag as a condition; local copies
check the enumerated file identity before and after streaming. The single-copy
baseline rejects individual objects above the configured maximum (at most 5 GiB).
Use fresh execution IDs after a failed resolution; do not erase reservations.

An already resolved execution reuses its plan only when the canonical request
digest matches. A changed request with the same ID fails. Configuration artifacts
are immutable published objects; verify their digests when resolving and executing.
The worker reads only snapshot object locations and configured artifacts. Preserve original URI/ETag/version observations in
a separate run audit object; plan object URIs always identify snapshots.

Write results beneath the configured artifact bucket's `results/` prefix. Each
request's base gets an execution-specific suffix. Writers use error-if-exists.
Preserve each logical schema as `_schema.json`; publish `_metadata.json` only
after every dataset succeeds. A partial directory is not completion evidence.
The reporter validates the manifest, plan binding and actual file/byte counts.

## Error and extension policy

Contract violations use `ContractInvalid`; semantic failures include
`LanguageNotRegistered`, `LanguageDisabled`, `LanguageAmbiguous`,
`MappingNotRegistered`, `MappingAmbiguous`, `ArtifactDigestMismatch`,
`SchemaMismatch`, `UnsupportedFormat`, `ExcelLimitExceeded`, `GraphIdMissing`, `GraphIdDuplicate`, `GraphEndpointMissing`,
`InputScopeDenied`, `OutputScopeDenied`, `InputLimitExceeded`, `ExecutionConflict`,
`CostCeilingExceeded`, `ApprovalRejected` and `ApprovalMismatch`.
Preserve the phase and sanitized code in `Failure`. Inspect restricted job history
for diagnostics, not public reports. Treat SDK transport faults separately from
invalid data/configuration; do not retry a paid Spark execution blindly.

When extending formats, definition constructs, graph profiles or partial exports,
add an executable fixture and failure case in the target repository before claiming support. Shared skills
continue to govern engineering and deployment choices. Product-specific behavior
belongs in this contract and registered configuration.

## Resolver algorithm to implement

1. Validate `Environment` and `Request` before storage mutations. Normalize S3
   prefixes with path-segment boundaries: `source/a/` cannot authorize
   `source/another/`. Reject dot segments, control characters, percent escapes,
   backslashes, query strings and fragments in this baseline. Check actual bucket
   and key constraints in addition to the schema's URI pattern.
2. Compute the request digest from UTF-8 JSON with recursively sorted object
   keys, no insignificant whitespace, unchanged array order and finite numbers.
   Sort keys lexically by UTF-16 code units, not locale-dependent collation;
   serialize numbers using ECMAScript JSON rules. Generate the digest in the
   TypeScript resolver and preserve it downstream. Artifact digests instead hash
   **exact stored bytes**, including SQL whitespace and final newlines.
3. Read `runs/<id>/resolved.json` if present. Return it only for an identical
   request digest and valid pinned plan. Otherwise reserve `runs/<id>/request.json`
   with conditional create. A reservation without `resolved.json` is in progress
   or failed: reject reuse and require a fresh ID. Do not steal reservations.
4. Read the catalog once; reject duplicate identities and invalid current flags.
   Verify referenced artifact bytes, envelope identity and enabled status. Resolve
   each language name to its sole enabled current version, then the sole enabled
   mapping for that pair. Never synthesize an inverse.
5. Bind request inputs to mapping inputs by table and copy format/sheet/options
   from the mapping; copy shape/format/profile/options from `mapping.output`.
   Check input/view/output uniqueness, required bindings, graph/definition
   agreement, serializer options and acyclic `dependsOn`. Require each output exactly once;
   permit a mapping to produce a subset of a language's datasets. Require every
   referenced vertex dataset within a graph export and within graph-source
   input bindings. Parse each single SELECT/CTE
   with the Spark dialect; allow only declared source views, declared earlier
   target views and local CTE aliases. Reject qualified storage/catalog references,
   DDL/DML, extra statements and undeclared UDFs. Parsing is validation, not a
   substitute for scoped execution permissions.
6. Enumerate each file or prefix with pagination and record sizes/ETags. Fail
   missing required data and configured limits without truncating. Estimate using
   all formats and [the cost model](aws-workflow.md). Reject excess ceiling or
   duration before snapshot copies and before starting Glue. Apply the deployed
   maximum even when a caller requests a larger ceiling.
7. Copy enumerated inputs under `runs/<id>/inputs/<table>/<ordinal>/...` with an
   ETag precondition; preserve source observations in `input-audit.json`. Pin
   object version IDs during copying where available. Protect snapshots from
   overwrites for the run lifetime. Store snapshot ETags/sizes in `Plan.inputs`;
   do not confuse multipart ETags with SHA-256 digests.
8. Copy exact catalog bytes to `runs/<id>/catalog.json`; embed the concrete
   language registrations and mapping manifest in the plan. Their nested artifact references retain
   verified digests. Resolve all reader/writer defaults and cost assumptions;
   store assumptions in a run audit object. Write `plan.json` conditionally and
   then `resolved.json` containing its digest. Enforce the serialized plan limit.
   Publish no resolved result when any preceding stage fails.

The worker must check the passed plan digest before parsing the plan; validate
its named schema and cross-field identities, including the passed execution ID.
Verify definition/SQL digests again before use. Never refresh catalog aliases at this
point. Compare snapshot identities before reads and retain immutable storage;
a metadata check alone cannot make mutable data reproducible.

## Definition types and serializer allowlists

Derive every dataset's Spark schema from the Lexicon definition with the fixed
type table in [languages-and-mappings.md](languages-and-mappings.md); do not
accept a second schema document. Required properties are non-nullable; all
others are nullable, and an omitted optional JSONL field materializes as null.
Never parse booleans as integers or strings that resemble booleans as booleans.
Preserve exact decimal semantics during validation; do not coerce `number`
values through binary floating point. Validate `pattern` syntax and bound
definition depth/size at publication.

The structural `Options` definition is a union. Enforce this narrower dispatch
at mapping publication:

| Mode | Allowed mapping options and defaults |
| --- | --- |
| CSV read | `header=true`, `delimiter=,`, `quote="`, `escape="`, `nullValue=\N`, `emptyValue=""`, `multiLine=true`, `encoding=UTF-8`, `dateFormat=yyyy-MM-dd`, `timestampFormat=yyyy-MM-dd'T'HH:mm:ss.SSSXXX` |
| CSV write | Same applicable quoting/header/null/date options; omit `multiLine`; optional `compression=gzip`; default uncompressed |
| JSONL read | UTF-8 only; fixed `multiLine=false`; no CSV options and no null-field writer option |
| JSONL write | `ignoreNullFields=false`; optional `compression=gzip`; default uncompressed |
| Parquet read | No format options; validate embedded schema |
| Parquet write | `compression=snappy` by default; permit `gzip` or `zstd` |
| Excel read | No options; `sheet` on the mapping input (default: table name); header row required; definition types applied on the driver |
| Excel write | No options; one `<dataset>.xlsx` per dataset with one sheet; rejects rows above the configured ceiling |
| Neptune profile | Fixed profile header/quote/null behavior; optional `compression=gzip`; reject caller overrides of generic CSV options |

Store effective options in the plan, even when the mapping omitted them. Keep
Spark session settings internal: UTC, case-sensitive schema matching and ANSI
errors for invalid SQL casts. Reject unquoted empty CSV fields when distinguishing
null from empty string would otherwise be ambiguous. Read/write quoted empty
strings distinctly from `\N`. Handle embedded newlines as logical CSV records.
Reject duplicate JSON object keys, nonstandard NaN/Infinity and unknown fields
before Spark projection can discard evidence of invalid data.

## Output verification contract

For ordinary tables and generic graphs use
`<base>/<executionId>/tables/<dataset>/`; for Neptune use
`<base>/<executionId>/vertices/<dataset>/` or `edges/<dataset>/`.
Write the dataset's derived Spark schema (`StructType.jsonValue()`) to
`_schema.json` and keep the definition digest in the pinned plan. Count only committed data part objects
in `fileCount`/`byteCount`; exclude underscore/dot metadata and schema sidecars.
A zero-row dataset may contain zero or more valid empty data parts.

Write `_metadata.json` at `<base>/<executionId>/` as `Result`, binding its own URI,
plan identity, concrete mapping and every output dataset. The reporter must reject
missing/extra datasets, unexpected paths, mismatched schemas, non-success status
and file/byte mismatches. Validate nonnegative row counts against the worker's
completed validation/count actions; acceptance tests independently reread them.
Do not count an unfinished directory as a successful result or silently overwrite
it on replay. Keep the result contract format-neutral.
