# Graph mapping format: identities, endpoints and properties

Use this contract for a mapping whose registered target has `shape: graph`.
Keep the normal language/mapping envelope from
[languages-and-mappings.md](languages-and-mappings.md). Add an explicit `graph`
block to each graph output. For tabular targets omit that block entirely.

## 1. Required output bindings

| Manifest field | Vertex output | Edge output |
| --- | --- | --- |
| `kind` | `vertex` | `edge` |
| `label` | Registered nonempty label | Registered nonempty relationship label |
| `idColumn` | Query column containing the complete vertex ID | Query column containing the complete edge ID |
| `from.column` | Not allowed | Query column containing the complete source vertex ID |
| `from.dataset` | Not allowed | Registered source vertex dataset |
| `to.column` | Not allowed | Query column containing the complete target vertex ID |
| `to.dataset` | Not allowed | Registered target vertex dataset |
| `properties` | Explicit query-column → property-name/type bindings | Same |

Map `idColumn` to `~id` at the Neptune writer. Map `from.column` and `to.column`
to `~from` and `~to`. The most direct SQL representation returns those aliases
already, so the bindings map each alias to itself. Differently named query
columns are also valid when the manifest explicitly binds them.
Bindings always name returned query columns. If SQL renames `person_id` to
`~id`, bind `idColumn: "~id"`; `idColumn: "person_id"` is invalid unless the
query also returns a column by that name. Apply the same rule to endpoints and
property bindings.

`~from` and `~to` contain **vertex IDs**, not dataset names, labels, row numbers
or unqualified source keys. They must equal the referenced vertices' `~id`
values exactly, including namespaces, case and string conversion.

## 2. Concrete mapping manifest

Assume registered source language `crm` defines `people`, `companies` and
`memberships` inputs. Assume target language `relationship-graph` defines the
corresponding graph datasets and compatible property schemas. Example artifact
URIs/digests are placeholders to replace during publication:

```json
{
  "contractVersion": 2,
  "id": "crm-to-relationship-graph",
  "version": "1.0.0",
  "status": "ENABLED",
  "engine": "spark-sql",
  "from": { "name": "crm", "version": "1.0.0" },
  "to": { "name": "relationship-graph", "version": "1.0.0" },
  "inputs": [
    { "table": "people", "view": "source_people", "required": true },
    { "table": "companies", "view": "source_companies", "required": true },
    { "table": "memberships", "view": "source_memberships", "required": true }
  ],
  "outputs": [
    {
      "dataset": "people",
      "queryS3Uri": "s3://configuration-bucket/mappings/example/people.sql",
      "querySha256": "<sha256>",
      "dependsOn": [],
      "graph": {
        "kind": "vertex",
        "label": "person",
        "idColumn": "~id",
        "properties": [{ "column": "name", "name": "name", "type": "String" }]
      }
    },
    {
      "dataset": "companies",
      "queryS3Uri": "s3://configuration-bucket/mappings/example/companies.sql",
      "querySha256": "<sha256>",
      "dependsOn": [],
      "graph": {
        "kind": "vertex",
        "label": "company",
        "idColumn": "~id",
        "properties": [{ "column": "name", "name": "name", "type": "String" }]
      }
    },
    {
      "dataset": "memberships",
      "queryS3Uri": "s3://configuration-bucket/mappings/example/memberships.sql",
      "querySha256": "<sha256>",
      "dependsOn": [],
      "graph": {
        "kind": "edge",
        "label": "member_of",
        "idColumn": "~id",
        "from": { "column": "~from", "dataset": "people" },
        "to": { "column": "~to", "dataset": "companies" },
        "properties": []
      }
    }
  ]
}
```

Validate each binding against the registered target schema. `properties[].type`
must agree with that schema; the mapping cannot override a registered type.
Reject duplicate property names, missing bound columns, reserved-header collisions
and bindings to an edge dataset as though it were a vertex dataset. The `graph`
block is mapping configuration, not per-record input or caller-provided SQL.

`dependsOn` describes SQL view dependencies. The example queries read only source
views, so the arrays are empty. Graph endpoint references separately require
validation after the referenced vertex results exist; they do not imply that
SQL itself joins those results.

## 3. Spark SQL: construct complete identities

`people.sql`:

```sql
SELECT
  CONCAT('person:', CAST(p.person_id AS STRING)) AS `~id`,
  CAST(p.display_name AS STRING) AS name
FROM source_people p
```

`companies.sql`:

```sql
SELECT
  CONCAT('company:', CAST(c.company_id AS STRING)) AS `~id`,
  CAST(c.company_name AS STRING) AS name
FROM source_companies c
```

`memberships.sql`:

```sql
SELECT
  CONCAT('membership:', CAST(m.membership_id AS STRING)) AS `~id`,
  CONCAT('person:', CAST(m.person_id AS STRING)) AS `~from`,
  CONCAT('company:', CAST(m.company_id AS STRING)) AS `~to`
FROM source_memberships m
```

Use Spark backticks around system-column aliases and references. Execute these
queries with `spark.sql`; use quoted DataFrame references such as `F.col("`~id`")`
when validating results. Keep the same ID expression for an endpoint and its
vertex. For example, `~from = "1"` cannot reference `~id = "person:1"`.

Choose stable IDs from registered source keys. If a composite identity is needed,
version its collision-safe tuple encoding/hash rule, null handling and namespace
in the mapping. An edge ID identifies the relationship instance; do not derive
it solely from endpoints when parallel relationships must remain distinct.
Never use `uuid()`, row position or execution ID as a default graph identity.

A query may instead return `person_key`, `edge_key`, `source_key` and `target_key`;
set `idColumn`, `from.column` and `to.column` to those exact names. The writer
renames according to these bindings without reconstructing the ID values.

## 4. Validate identity and references in Spark

Apply Transform's graph-contract requirements before publishing success:

1. Require nonnull, nonempty string IDs and endpoints. Validate source key
   constraints as well, so a namespace prefix cannot hide an empty source key.
2. Check vertex IDs for uniqueness across the graph export's vertex datasets;
   check edge IDs across edge datasets. Reject collisions/conflicting records.
   Deduplicate identical rows only when the registered mapping explicitly says so.
3. Compare every `from` value to its referenced vertex dataset's ID column and
   every `to` value to its target's ID column. Use distributed left-anti joins
   to find unresolved endpoints; do not collect the entire ID population.
4. For an explicitly registered partial export, allow endpoints supplied by a
   pinned reference-ID dataset or verified consumer snapshot. Record that scope
   and evidence in the plan. Never skip reference validation merely because a
   run omits vertex output.
5. Require declared labels and property types to match the target graph schema.
   If SQL also returns `~label`, validate every value against `graph.label` rather
   than silently overwriting inconsistent labels.

These are product validation rules. Keep them stable across serializers and
reruns; do not confuse a loader's permissive behavior with a complete Transform
validation contract.

## 5. Serialize the explicit graph profile

For `output.shape: graph`, `output.format: csv`, `output.profile: neptune`:

- Rename each bound identity/endpoint column to its system header.
- Emit `~label` from the validated manifest label.
- Emit each bound property as `<name>:<type>` (for example `name:String`).
  Encode values using that registered type and reject unsupported encodings.
- Keep vertex and edge CSV datasets separate and write UTF-8 headers/rows.
- Use the profile's null/property and quoting rules; reject incompatible generic
  CSV options instead of writing a literal generic null marker as a property.

Neptune's required system headers are `~id` for vertices and `~id`, `~from`,
`~to` for edges. See its [official graph CSV format](https://docs.aws.amazon.com/neptune/latest/userguide/bulk-load-tutorial-format-gremlin.html).
Transform additionally requires explicit registered labels and validated IDs as
specified above.

For person `1` named Ada, company `10` named Example and membership `100`, emit:

```csv
~id,~label,name:String
person:1,person,Ada
```

```csv
~id,~label,name:String
company:10,company,Example
```

```csv
~id,~from,~to,~label
membership:100,person:1,company:10,member_of
```

For Parquet/JSONL or ordinary graph CSV without the Neptune profile, preserve
the query's registered dataset columns and logical types. If SQL explicitly uses
`~id` aliases, retain them; otherwise retain its bound ordinary column names.
Tabular output has no `graph` block and acquires no graph headers or constraints.

## 6. Acceptance examples

Prove both direct aliases and explicit alternative-column bindings. Reject a
missing vertex ID, missing edge endpoint, unqualified endpoint (`1` versus
`person:1`), unknown vertex, duplicate/colliding ID and incompatible property
binding. Verify the same inputs yield the same graph IDs on a rerun. Confirm
that selecting CSV for a tabular mapping does not activate this graph contract.
