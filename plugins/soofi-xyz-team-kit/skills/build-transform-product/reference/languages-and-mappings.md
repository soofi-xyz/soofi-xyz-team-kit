# Languages and directional SQL mappings

Implement this configuration contract with Lexicon. Discover existing compatible
catalog and publication surfaces before adding resources. Treat the paths below
as a reference layout, not proof of an existing deployment. Keep [the PRD](PRD.md)
authoritative for execution inputs.

Use [the contract definitions](contracts-and-defaults.md) for exact field names,
required fields and baseline defaults. Follow [the worked example](worked-example.md)
for complete definitions, SQL, manifests and a catalog with real content digests.

## 1. Language registration

A language is a Lexicon language definition: the same `vertices` / `edges` /
`common_patterns` document Lexicon already publishes for `lexicon`, `interprose`
and every other registered vocabulary. **The language definition is the schema.**
Transform publishes no parallel JSON Schema, Spark `StructType` or per-dataset
schema artifact; doing so duplicates Lexicon and drifts.

Every language on either side of a mapping must be registered in Lexicon. There
is no external or private registry path: if a vendor format is not yet a Lexicon
language, register it there first, then map to or from it.

Register a language in the Transform catalog with a name, version, `current`
flag, status, `shape: tabular | graph` and the immutable definition artifact:

```json
{
  "name": "crm",
  "version": "1.0.0",
  "current": true,
  "status": "ENABLED",
  "shape": "tabular",
  "s3Uri": "s3://configuration-bucket/languages/crm/1.0.0/crm.json",
  "sha256": "<sha256-of-definition-bytes>"
}
```

Derive datasets and columns from the definition, never from a second file:

| Definition element | Transform meaning |
| --- | --- |
| `vertices[].type` (and `edges[].type` for graph languages) | Dataset name; the set of tables a mapping may bind or produce |
| `properties` key order | Column order for CSV/Excel output; artifacts are byte-immutable so this order is stable |
| Vertex-level `required` / edge property `required: true` | Non-nullable Spark column; must be present in every record |
| Property not listed as required | Nullable Spark column; an omitted JSONL field materializes as null |
| `type`, `format`, `enum`, `pattern`, `minLength`, `items` | Logical validation constraints applied to source rows and query results |

Map Lexicon property types to Spark deterministically:

| Lexicon `type` (+ `format`) | Spark read type | Accepted result column types |
| --- | --- | --- |
| `string` | `StringType` | string |
| `string` + `format: date` | `DateType` | date |
| `string` + `format: date-time` | `TimestampType` (UTC) | timestamp |
| `integer` | `LongType` | byte, short, integer, long |
| `number` | `DecimalType(38, 18)` | decimal, float, double |
| `boolean` | `BooleanType` | boolean |
| `array` | `ArrayType(<items>)` | array with an accepted element type |

Reject any other property type or unsupported keyword at catalog publication
rather than ignoring it. SQL controls narrowing (for example `CAST(... AS
DECIMAL(18, 2))`); CSV and Excel outputs reject nested target fields.

Language registration must fail on duplicate identities with different content,
invalid definitions, invalid graph metadata or missing artifact digests. Allow at
most one enabled `current: true` entry per language; a request never names a
version, so exactly one current enabled entry must exist for each language in the
pair. Do not register `crm-csv` and `crm-parquet` solely to express encoding;
encoding belongs to the mapping.

Suggested reviewed source layout, to be implemented in Lexicon:

```text
src/transform/
├── catalog.json
├── languages/<language>/<version>/<language>.json
└── mappings/<mapping-id>/<version>/
    ├── manifest.json
    ├── queries/<output>.sql
    └── fixtures/
```

Name the prefix `mappings/`, not `rules/` or `mapping-rules/`: Lexicon already
publishes filter rules and rulesets, and a second "rules" concept confuses
authors and consumers. Publish immutable versioned manifests and SQL objects and
a catalog with language/current-version indexes and mapping references. Discover
its S3 URI through the proposed `/lexicon/transform-catalog-uri` parameter. Give
the Transform resolver and Glue job scoped read permissions. Preserve discovered
consumer contracts when changing an existing publication surface.

## 2. Mapping manifest

Register an immutable mapping for an exact direction and language-version pair.
The mapping owns everything about encoding and shape: each input's format and
reader options, and the output shape, format, profile and writer options. A
request supplies only S3 locations. A different delimiter, header policy or
output format is a **new mapping**, not a request parameter; there is no case
for running the same SQL with different serializer settings.

```json
{
  "contractVersion": 2,
  "id": "crm-to-warehouse",
  "version": "1.0.0",
  "status": "ENABLED",
  "engine": "spark-sql",
  "from": { "name": "crm", "version": "1.0.0" },
  "to": { "name": "warehouse", "version": "2.0.0" },
  "inputs": [
    { "table": "customers", "view": "source_customers", "required": true, "format": "jsonl" }
  ],
  "output": { "shape": "tabular", "format": "parquet" },
  "outputs": [
    {
      "dataset": "accounts",
      "queryS3Uri": "s3://configuration-bucket/mappings/crm-to-warehouse/1.0.0/accounts.sql",
      "querySha256": "<sha256-of-exact-query-bytes>",
      "dependsOn": []
    }
  ]
}
```

`inputs[].table` must be a dataset of the source language definition and
`outputs[].dataset` a dataset of the target definition. An `xlsx` input names
its `sheet` (default: the table name); several inputs may bind different sheets
of one workbook. The illustrative query can be:

```sql
SELECT
  CAST(c.customer_code AS STRING) AS account_id,
  c.display_name AS account_name,
  CAST(c.balance AS DECIMAL(18, 2)) AS balance
FROM source_customers c
```

The query returns a typed table. It needs no `~id`, `~label`, `vertices/` or
`edges/` path segment. Output identity and columns come from the manifest and the
target language definition, not the SQL filename.

Validate mappings at publication: both enabled language versions exist; input
tables and output datasets exist in their definitions; views/paths are safe and
unique; formats and options pass the serializer allowlists; `output.profile` is
compatible with the target shape; SQL digests match; dependencies form an acyclic
graph; fixtures pass. Use stable view names from the manifest (e.g.
`source_customers` and `target_accounts`) with disjoint namespaces. Expose an
earlier output as its validated `target_<dataset>` view only when a dependent
query declares it.

For multiple SQL fragments targeting one table, declare them as one output's
ordered `queries` list instead of `queryS3Uri`/`querySha256`; require exactly one
form. Each list entry has `queryS3Uri` and `querySha256`. Validate all fragment
columns against the same target before `unionByName`. Do not union unrelated
datasets just because their files live in the same folder.

Use SQL SELECT/CTE result queries; reject DDL/DML, arbitrary multi-statement SQL
and unsupported execution engines during publication/validation. Do not accept
inline SQL or executable code in public execution requests. Keep engine mechanics
in Python and language-specific transformation expressions in registered SQL.

## 3. Resolution rules

1. Read the `from` and `to` language names from the request. Resolve each to its
   single enabled `current: true` registration; fail on none or several.
2. Require exactly one enabled mapping whose `from`/`to` match those concrete
   language versions and engine. Reject zero matches and ambiguity. Never choose
   the first catalog entry. Requests carry no mapping ID or version; if two
   enabled mappings exist for a pair, publication is wrong, not the request.
3. Bind each request input to a mapping input by `table`; fail unknown, duplicate
   or missing required tables. Take format, sheet and reader options from the
   mapping. Take shape, format, profile and writer options from `mapping.output`.
4. Validate the bound tables and the target datasets against their language
   definitions and serializer/profile compatibility before starting Glue.
5. Pin catalog revision, definition digests, mapping and SQL content identities
   in the execution plan. Record concrete versions in the result; do not
   re-resolve "current" after waiting for approval.

Use distinct failures such as `LanguageNotRegistered`, `LanguageDisabled`,
`LanguageAmbiguous`, `MappingNotRegistered`, `MappingAmbiguous`,
`UnsupportedFormat` and `SchemaMismatch`. These are product error tags; version
any changes to an existing deployment's envelope.

A reverse mapping is a separate registration. Missing A → B must not trigger
A → Lexicon → B automatically. Keep composed transformations outside direct
pair resolution until a separately registered composition contract exists.

## 4. Tabular and graph targets

For tabular languages, every `vertices[].type` is an ordinary table; preserve its
columns and types. Permit multiple unrelated output tables in one target language.

For graph languages, follow [the graph mapping contract](graph-mappings.md).
Define each output's `graph` block with `kind`, `label`, `idColumn`, property
bindings and edge `from`/`to` bindings. The Lexicon definition's `edges[].from`
and `edges[].to` name the vertex datasets an edge may reference; the mapping's
endpoint bindings must agree with them. Require stable identities and validate
endpoints against the referenced vertex datasets. SQL may return canonical
`~id`, `~from` and `~to` aliases directly; otherwise bind the chosen column names
explicitly. Reject disagreement with the target definition.

Serialize declared graph fields as named datasets in Parquet/JSONL/CSV/Excel by
default. Only `output.profile: neptune` adapts role bindings to its CSV
headers/layout. Reject graph metadata on tabular mapping outputs.
