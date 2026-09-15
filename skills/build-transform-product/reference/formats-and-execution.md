# Format adapters and typed Spark execution

Implement this target pipeline from the pinned plan in [PRD.md](PRD.md). Keep
reader/writer behavior independent of registered language names.

## 1. Readers

Dispatch on each input's explicit `format`, not its extension or language:

| Format | Reader | Schema and record semantics |
| --- | --- | --- |
| `parquet` | `spark.read.parquet(...)` | Compare embedded schema with the registered dataset schema; reject incompatible evolution/coercion |
| `jsonl` | Schema-bound `spark.read.json(...)` | UTF-8, one object per line, `multiLine=false`; use registered types |
| `csv` | Schema-bound `spark.read.csv(...)` | Explicit header/delimiter/quote/escape/null/date options and registered column types |

For JSONL use `mode=FAILFAST`; this rejects parse failures but is not complete
schema validation. Verify required fields, nullability, enums, numeric ranges
and unexpected-field policy separately. Configure JSON parsing for standard JSON;
do not treat a top-level JSON array or multiline document as JSONL.

For CSV default to UTF-8, `header=true`, comma separator, quote/escape `"`,
`nullValue=\N`, `emptyValue=""`, and no whitespace trimming. Validate a deliberate
null-marker collision policy so literal marker strings are not silently lost.
Allow explicit headerless input only with registered positional column order.
Use `inferSchema=false`, `mode=FAILFAST` and header/schema checks
(`enforceSchema=false` for headered input). Check field counts and required
values explicitly: Spark parser failure mode alone does not enforce the full
language schema. Validate every file's header; do not silently reinterpret
reordered columns as different fields.

These APIs/options are documented in Apache Spark's [CSV reference](https://spark.apache.org/docs/3.5.6/sql-data-sources-csv.html)
and [JSON reference](https://dlcdn.apache.org/spark/docs/3.4.3/sql-data-sources-json.html).
Verify behavior with the actual Glue/Spark version used by the target deployment.

Allow reader options from a typed allowlist; reject arbitrary Spark settings.
Pin timezone and date/timestamp parsing rules in the resolved plan. Treat input
locations as dataset files or prefixes and enumerate only objects for that named
dataset/encoding. Exclude metadata and unrelated files. Do not count only
`.parquet` objects during admission.

For v2 default to failure on missing required tables/files or invalid records.
If the registration explicitly makes a table optional, construct an empty view
using its registered schema. Do not infer string-only views from SQL errors or
silently skip disappearing objects. Stage mutable inputs when replay requires
a stable snapshot.

## 2. Views, queries and schemas

Initialize `GlueContext` and its Spark session. Fetch only configuration and
small metadata with boto3; keep dataset reads/joins/writes distributed.

1. Resolve each input table to its registered Spark schema, read it with the
   format adapter and validate it. Register the explicit manifest view name.
2. Verify SQL object digests. Run each registered query with `spark.sql(sql)` in
   dependency order. Do not execute Translate TypeScript bundles in this engine.
3. Compare columns/types and validate rows against the registered target dataset.
   Enforce required/null/enum/precision constraints with distributed checks;
   merely applying a `StructType` does not prove schema conformance.
4. Align a declared fragment to its target schema before combining fragments of
   that same table. Add missing nullable fields only when the schema permits
   them. Reject incompatible types and missing required fields.
5. Keep string, boolean, integer, decimal, date, timestamp and supported nested
   types intact. Set explicit time-zone rules. Apply any flattening, aggregation,
   deduplication or derived identifiers in registered SQL, not an engine-wide
   language-specific branch.

Use bounded samples for diagnostics, not `.collect()`/`toPandas()` on complete
source or output data. Cache only DataFrames reused across validation/counting/
writing, with cleanup in `finally`. Do not assume all outputs should be cached
simultaneously or that 200 write partitions fits every table.

## 3. Writers

Write one directory per logical target dataset. Output format is independent
of each source format; support all nine combinations of the three encodings.

| Format | Writer | Required result |
| --- | --- | --- |
| `parquet` | `df.write.parquet(path)` | Preserve native schema/types; default compression `snappy` |
| `jsonl` | `df.write.option("ignoreNullFields", "false").json(path)` | One JSON object per line with registered field names and explicit null semantics |
| `csv` | `df.write.options(...).csv(path)` | Registered column order and configured header/quote/null/date semantics; publish a schema sidecar |

Use UTC/registered timezone consistently for timestamps and define decimal
representation through the target schema. Do not stringify all DataFrame values
for Parquet/JSONL. JSONL's line-oriented reader and configurable null-field
writer behavior are described in the [Spark JSON reference](https://dlcdn.apache.org/spark/docs/3.4.3/sql-data-sources-json.html).

CSV output must have scalar fields. If a target has nested values, require SQL
to project/flatten them into a compatible target schema or explicitly declare a
JSON-string field and encode it in SQL. Otherwise reject CSV as incompatible;
do not silently flatten or discard structure. Configure CSV quoting/escaping
so embedded commas, quotes and newlines round-trip under the declared options.
Record effective writer options and logical schema in the dataset manifest.

Use a new run-specific prefix with error-if-exists behavior. Write dataset data
and schemas first, then the successful completion manifest. On failure retain
partial paths with failed status; do not make a partial directory look complete.
Return dataset prefixes and actual file/row/byte counts, not a promised single
fixed filename. No global row ordering is promised unless an explicit contract
and implementation provide it.

## 4. Graph profiles

The default tabular writer never invents `~id`, `~label`, `~from` or `~to`.
A generic graph shape retains the target graph's registered dataset fields in
any supported encoding. Run graph-specific identity/endpoint checks only there.

For the explicit `neptune` profile (graph + CSV), translate declared graph
identity/endpoint/property fields to Neptune headers, assign the manifest's
labels and use the graph export layout. Preserve deterministic mapping-defined
identities for v2. Perform string serialization at this writer boundary only;
the SQL engine and tabular path stay typed. Use the exact manifest bindings and
Spark SQL examples in [graph-mappings.md](graph-mappings.md); never generate
random edge IDs or rebuild endpoint IDs independently of their vertex mapping.

Test graph output separately from tabular CSV: selecting `format: csv` alone
must never activate Neptune rules. Verify Persist loading/readback separately
when requested by the consumer.
