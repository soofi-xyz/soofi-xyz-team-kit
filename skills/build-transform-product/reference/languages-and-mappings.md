# Languages and directional SQL mappings

Implement this configuration contract with Lexicon. Discover existing compatible
catalog and publication surfaces before adding resources. Treat the paths below
as a reference layout, not proof of an existing deployment. Keep [the PRD](PRD.md)
authoritative for execution inputs.

Use [the contract definitions](contracts-and-defaults.md) for exact field names,
required fields and baseline defaults. Follow [the worked example](worked-example.md)
for complete schemas, SQL, manifests and a catalog with real content digests.

## 1. Language registration

Register a named, versioned data contract with ownership/scope, status,
`shape: tabular | graph`, named dataset schemas and their content digests.
Use the same language identity regardless of whether records arrive as Parquet,
JSONL or CSV. Do not register `crm-csv` and `crm-parquet` solely to express encoding.

Publish schema artifacts and deterministic Spark `StructType` representations
for each dataset. Keep logical constraints such as required fields, nullability,
enums, decimal precision/scale and date/time semantics with the schema. Define
nested structs/arrays where needed; this baseline requires a versioned extension
before accepting maps. Validate serializer compatibility.

Use this concrete registration artifact shape (example names/URIs):

```json
{
  "name": "crm",
  "version": "1.0.0",
  "status": "ENABLED",
  "shape": "tabular",
  "owner": { "company": "example", "product": "crm" },
  "datasets": {
    "customers": {
      "schemaS3Uri": "s3://configuration-bucket/languages/crm/1.0.0/customers.schema.json",
      "schemaDigest": "<sha256-of-schema-bytes>",
      "sparkSchemaS3Uri": "s3://configuration-bucket/languages/crm/1.0.0/customers.spark.json",
      "sparkSchemaDigest": "<sha256-of-spark-schema-bytes>"
    }
  }
}
```

Store logical validation constraints in the schema artifact and a Spark
`StructType` JSON representation in the Spark artifact. Validate their agreement
at registration; reject unsupported schema constructs rather than silently
dropping them. Catalog entries pin each language/mapping manifest URI and digest;
allow at most one enabled `current: true` entry per language, and require one
when a request omits its version. Graph registrations add the dataset roles/IDs
and endpoints described in section 4. Public v2 requests
select these registrations; they do not register schemas as a side effect.

For externally registered languages, retain their authoritative name/version,
owner and schema digest. Read/import through the registry's documented public
interface and publish the Transform-compatible schema binding in Lexicon. Do
not access Translate's internal tables or reinterpret its TypeScript mapping
bundles as SQL. Its documented JSON registration format describes schema
registration and does not prohibit CSV/Parquet encodings in Transform.

Suggested reviewed source layout, to be implemented in Lexicon:

```text
src/transform/
├── catalog.json
├── languages/<language>/<version>/
│   ├── language.json
│   └── schemas/<dataset>.json
└── mappings/<mapping-id>/<version>/
    ├── manifest.json
    ├── queries/<output>.sql
    └── fixtures/
```

Publish immutable versioned manifests/schema/SQL objects and a catalog with
language/current-version indexes and mapping references. Discover its S3 URI
through the proposed `/lexicon/transform-catalog-uri` parameter. Give the
Transform resolver and Glue job scoped read permissions. Preserve discovered
consumer contracts when changing an existing publication surface.

Language registration must fail on duplicate identities with different content,
invalid/unsupported schemas, invalid graph metadata or missing artifact digests.
Respect the registry's ownership and reserved-name policy without embedding a
fixed list of source systems in Transform. Every compatible enabled registration
can be a source or target; do not require either endpoint to be reserved.

## 2. Mapping manifest

Register an immutable mapping for an exact direction and language-version pair.
Use an explicit engine, named input bindings and target output definitions:

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
    { "table": "customers", "view": "source_customers", "required": true }
  ],
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

Bind `customers` to the registered source dataset schema and `accounts` to the
registered target dataset schema. The illustrative query can be:

```sql
SELECT
  CAST(c.customer_code AS STRING) AS account_id,
  c.display_name AS account_name,
  CAST(c.balance AS DECIMAL(18, 2)) AS balance
FROM source_customers c
```

The query returns a typed table. It needs no `~id`, `~label`, `vertices/` or
`edges/` path segment. Output identity and schema come from the manifest and
target registration, not the SQL filename.

Validate mappings at publication: both enabled language versions exist; input
bindings and output datasets exist; views/paths are safe and unique; schemas are
compatible; SQL digests match; dependencies form an acyclic graph; fixtures pass.
Use stable view names from the manifest (e.g. `source_customers` and
`target_accounts`) with disjoint namespaces. Expose an earlier output as its
validated `target_<dataset>` view only when a dependent query declares it.

For multiple SQL fragments targeting one table, declare them as one output's
ordered `queries` list instead of `queryS3Uri`/`querySha256`; require exactly one
form. Each list entry has `queryS3Uri` and `querySha256`. Validate all fragment
schemas against the same target before `unionByName`. Do not union unrelated datasets just
because their files live in the same folder.

Use SQL SELECT/CTE result queries; reject DDL/DML, arbitrary multi-statement SQL
and unsupported execution engines during publication/validation. Do not accept
inline SQL or executable code in public execution requests. Keep engine mechanics
in Python and language-specific transformation expressions in registered SQL.

## 3. Resolution rules

1. Read the requested `from`/`to` registrations. Resolve omitted versions only
   through each language's unambiguous enabled current-version pointer.
2. Match direction, concrete versions, scope and engine. If an explicit mapping
   ID/version is supplied, verify it matches those languages and versions.
3. Without an explicit mapping, require exactly one enabled compatible mapping.
   Reject zero matches and ambiguity. Never choose the first catalog entry.
4. Validate named input bindings, required source tables, target shape and
   serializer/profile compatibility before starting Glue.
5. Pin catalog revision, schemas, mapping and SQL content identities in the
   execution plan. Record concrete versions in the result; do not re-resolve
   “current” after waiting for approval.

Use distinct failures such as `LanguageNotRegistered`, `LanguageDisabled`,
`LanguageVersionNotFound`, `MappingNotRegistered`, `MappingAmbiguous`,
`MappingLanguageMismatch`, `UnsupportedFormat` and `SchemaMismatch`. These are
product error tags; version any changes to an existing deployment's envelope.

A reverse mapping is a separate registration. Missing A → B must not trigger
A → Lexicon → B automatically. Keep composed transformations outside direct
pair resolution until a separately registered composition contract exists.

## 4. Tabular and graph targets

For tabular languages, register ordinary tables and preserve their columns and
types. Permit multiple unrelated output tables in one target language.

For graph languages, follow [the graph mapping contract](graph-mappings.md).
Define each output's `graph` block with `kind`, `label`, `idColumn`, property
bindings and edge `from`/`to` bindings. Require stable identities and validate
endpoints against the referenced vertex datasets. SQL may return canonical
`~id`, `~from` and `~to` aliases directly; otherwise bind the chosen column names
explicitly. Reject disagreement with the registered target schema.

Serialize declared graph fields as named datasets in Parquet/JSONL/CSV by default.
Only `output.profile: neptune` adapts role bindings to its CSV headers/layout.
Reject graph metadata on tabular mapping outputs.
