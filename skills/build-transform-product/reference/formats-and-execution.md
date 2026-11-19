# Format adapters and typed Spark execution

Implement this target pipeline from the pinned plan in [PRD.md](PRD.md). Keep
reader/writer behavior independent of registered language names.

## 1. Readers

Dispatch on the `format` the mapping declares for each input, not its extension,
language or anything in the request. The "registered schema" below is always the
`StructType` derived from the Lexicon language definition:

| Format | Reader | Schema and record semantics |
| --- | --- | --- |
| `parquet` | `spark.read.parquet(...)` | Compare embedded schema with the registered dataset schema; reject incompatible evolution/coercion |
| `jsonl` | Schema-bound `spark.read.json(...)` | UTF-8, one object per line, `multiLine=false`; use registered types |
| `csv` | Schema-bound `spark.read.csv(...)` | Explicit header/delimiter/quote/escape/null/date options and registered column types |
| `xlsx` | Driver-side bounded workbook read (`openpyxl` read-only or `pandas.read_excel(..., sheet_name=<sheet>, dtype=str)`) → `spark.createDataFrame` | One sheet per dataset (`sheet` defaults to the table name); resolve headers with the [Excel header rules](#excel-header-and-cell-rules); cast with the registered types; reject above the configured row/byte ceiling |

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

Allow reader options from a typed allowlist at mapping publication; reject
arbitrary Spark settings. Pin timezone and date/timestamp parsing rules in the
resolved plan. Treat input
locations as dataset files or prefixes and enumerate only objects for that named
dataset/encoding. Exclude metadata and unrelated files. Do not count only
`.parquet` objects during admission.

For v2 default to failure on missing required tables/files or invalid records.
If the registration explicitly makes a table optional, construct an empty view
using its registered schema. Do not infer string-only views from SQL errors or
silently skip disappearing objects. Stage mutable inputs when replay requires
a stable snapshot.

### Excel header and cell rules

Real workbooks often carry stray formatted-but-empty columns. One blank header
cell must not fail an otherwise valid sheet. Resolve the header row like this:

1. Trim each header cell; a missing cell or one that is empty after trimming is
   blank.
2. Read every data row inside the row/byte ceiling, then classify each
   blank-header column. A blank-header column whose cells are all empty (`None`
   or a string that is empty after trimming) is ignored: it is not a dataset column and its position is
   not reported as data.
3. A blank-header column that holds any value fails the read with a specific
   error naming the 1-based column position, its Excel letter and the first
   1-based worksheet row holding a value, for example `XLSX column 41 (AO) has a
   blank header but contains data in row 7`. Never include the cell value. Do not
   generate a name such as `_col41`: a generated column hides unlabelled data
   from the mapping author, and a mapping can only select a column it can name.
   A formula counts as data even without a cached result: cached-value reads
   (`data_only=True`) return `None` for it, so also check blank-header columns
   in a formula view (`data_only=False`) and never print the formula.
4. Duplicate non-blank headers keep the existing error
   (`XLSX headers must be non-empty and unique`); do not rename or suffix them.
5. A sheet with no non-blank header fails as missing its header row.
6. Every column the mapping or language definition selects still resolves by
   its exact header name. Ignoring a blank column never shifts or renames a named
   one.

Stringify cells deterministically. A numeric cell holding an integral finite
float is written as the integer (`5551234567.0` becomes `5551234567`); other
floats keep Python's shortest round-trip form; booleans are not numbers; dates
and datetimes use ISO 8601. Never let `str(float)` add a trailing `.0` to an
identifier, phone number or count.

Test, with synthetic workbooks only: interior and trailing blank all-empty
columns are dropped and named columns keep their values; a blank-header column
with one value, or one uncached formula, fails with its position and row but
not its value; duplicate
headers keep the error; a whitespace-only header counts as blank; integral
floats lose `.0` while `1.5`, ints, booleans and dates are unchanged.

### Selected input columns

Source workbooks and exports often carry many columns a mapping never uses,
with duplicate or blank headers among them and personal data in them. A
schema-free CSV or Excel input may therefore declare the exact headers it
reads as the input option `columns`: a nonempty list of unique, trimmed,
non-blank strings (at most 1,024). Validate it at mapping registration and
again when the worker parses the plan; it is the only array-valued input
option, and only `csv` and `xlsx` inputs accept it. A schema-bound input
already declares its columns through the definition and rejects `columns`.

When `columns` is present:

1. Keep the existing worksheet selection, `headerRow` handling and header
   trimming unchanged.
2. Each selected name must match exactly one header cell. A missing name fails
   with `<FORMAT> column '<name>' is missing from the header row`; a repeated
   one fails with `<FORMAT> column '<name>' appears <n> times in the header row`,
   naming the 1-based positions (and Excel letters). Header names come from
   configuration; never include a cell value.
3. Ignore every unselected column: do not check its header for duplicates or
   blanks, do not scan its cells for data under a blank header, and never load
   it into Spark. The dataset has exactly the selected columns, in `columns`
   order, so unselected personal data never enters the run.
4. Apply `emptyRowPolicy`, `maxRows` and cell stringification to the selected
   columns only. A row whose selected cells are all empty is an empty row.
5. For CSV, parse with the existing options and then select only the listed
   columns. Spark renames a duplicate header to `<name><index>` and a blank one
   to `_c<index>` instead of failing, so never match selections against Spark's
   column names: read the first file's original header record (same parser
   options, `header=false`, type inference off so numeric headers keep their
   text, one record), resolve each selected name to its
   position there, and project by position. A selection such as `Name1` or
   `_c3` that exists only as a Spark rename is missing. Keep Spark's per-file
   header check so a later file with different headers fails. Treat the
   `header` flag as Spark does (`true` or a case-insensitive `"true"`).
6. An omitted optional input keeps its options without a format and is never
   read; accept `columns` there instead of rejecting the plan.

Without `columns`, every rule in [the Excel header rules](#excel-header-and-cell-rules)
applies to the whole header row exactly as before. Do not infer `columns` from
SQL: an explicit list keeps the read reviewable, pinned in the mapping digest
and independent of query parsing.

Test, with synthetic workbooks and files only: duplicate unselected headers,
blank-header unselected columns with data (and uncached formulas) all succeed
and the dataset holds only the selected columns; a missing selected column and
a duplicated selected column each fail by name and position without values;
column order follows `columns`; a Spark-renamed name (`Name1`, `_c3`) is not
selectable while a genuine `Name1` header is; registration and the resolved plan
both reject `columns` on JSONL or
Parquet inputs, on schema-bound inputs, and with blank, padded or repeated
names; and a large workbook (tens of thousands of rows, dozens of columns)
reads only the selected values within the configured ceilings.

### S3 object keys

An `s3://<bucket>/<key>` location is literal: everything after the first `/`
following the bucket is the S3 object key, byte for byte. Spaces, `+`, `%`,
`#`, `?` and non-ASCII characters are ordinary key characters, not URL syntax.

- Parse S3 URIs by splitting the bucket from the key. Do not use a generic URL
  parser for the key: WHATWG `new URL()` percent-encodes spaces and non-ASCII
  in `pathname` and drops anything after `#` or `?`; Python `urlparse` also
  treats `#`/`?` as fragment/query. Either turns a real key into a missing one,
  and a prefix listing of the mangled key then reports the dataset as empty.
- Decode exactly once and only at a boundary that hands you an encoded key:
  S3 event notifications (URL-encoded, `+` for space) and listings requested
  with `EncodingType=url`. Decode there, then carry the decoded key everywhere.
  Never decode a key taken from a request URI or an SDK response.
- Encode exactly once and only where the wire format requires it, such as the
  `CopySource` of `CopyObject` (encode each path segment and the version ID).
  SDK `Bucket`/`Key` parameters take the decoded key; never pre-encode them.
- Snapshot, plan, audit and Spark paths keep the literal key so the worker reads
  the same object the planner pinned.
- Spark's file readers expand `{`, `}`, `[`, `]`, `*`, `?` and `\` in a read
  path as a Hadoop glob. Backslash-escape those characters in every path passed
  to `spark.read`, so `what?.csv` cannot also read a sibling `whatX.csv`.
- Literal does not mean unchecked: reject `.` and `..` key segments, because an
  HTTP layer may collapse them and read outside a scoped prefix, and reject
  control characters. Map these to the caller's existing invalid-input or
  scope error rather than an internal failure.

Test parse, head/list, snapshot copy and read with keys containing a space,
`+`, `%` (including a literal `%20`), `#`, `?` and non-ASCII characters; read
glob-shaped keys (`?`, `*`, `[ab]`, `{x,y}`) next to siblings the glob would
match and prove only the pinned object is read; and prove an already-valid ASCII
key resolves exactly as before.

## 2. Views, queries and schemas

Initialize `GlueContext` and its Spark session. Fetch only configuration and
small metadata with boto3; keep dataset reads/joins/writes distributed.

1. Resolve each input table to its registered Spark schema, read it with the
   format adapter and validate it. Register the explicit manifest view name.
   For a graph source, validate registered IDs/endpoints before executing SQL.
   Require each referenced vertex dataset among the named inputs for the
   baseline complete graph scope; do not skip source graph integrity when the
   requested target is tabular.
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

Write one directory per logical target dataset in the format the mapping's
`output` declares. Output format is independent of each source format; support
all sixteen combinations of the four encodings.

| Format | Writer | Required result |
| --- | --- | --- |
| `parquet` | `df.write.parquet(path)` | Preserve native schema/types; default compression `snappy` |
| `jsonl` | `df.write.option("ignoreNullFields", "false").json(path)` | One JSON object per line with registered field names and explicit null semantics |
| `csv` | `df.write.options(...).csv(path)` | Registered column order and configured header/quote/null/date semantics; publish a schema sidecar |
| `xlsx` | Driver-side `df.toPandas().to_excel(<path>/<dataset>.xlsx, sheet_name=<dataset>, index=False)` | One workbook per dataset with one sheet; registered column order; dates/decimals as typed cells; reject above the configured row ceiling and never above 1,048,576 rows |

Excel is the one deliberate driver-side path. Keep it bounded by the environment
ceiling and count its collection in capacity estimates; do not let it become a
general escape hatch for other formats.

Use UTC/registered timezone consistently for timestamps and define decimal
representation through the target schema. Do not stringify all DataFrame values
for Parquet/JSONL. JSONL's line-oriented reader and configurable null-field
writer behavior are described in the [Spark JSON reference](https://dlcdn.apache.org/spark/docs/3.4.3/sql-data-sources-json.html).

CSV and Excel output must have scalar fields. If a target has nested values, require SQL
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

Test graph output separately from tabular CSV: a mapping output with
`format: csv` alone must never activate Neptune rules. Verify Persist loading/readback separately
when requested by the consumer.
