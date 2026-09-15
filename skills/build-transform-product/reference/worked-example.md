# Worked publication and acceptance cases

Use these synthetic artifacts as the specification for tests implemented in the
target repository. They are declarative examples; no runtime or test harness is
bundled. Read the [build sequence](from-scratch.md) and
[contract definitions](contracts-and-defaults.md) first.

## 1. Complete tabular publication

Start with [the example request](examples/tabular/request.json) and
[local environment](examples/environment.local.json). The request explicitly
selects `crm@1.0.0 → warehouse@2.0.0` through `crm-to-warehouse@1.0.0`, reads one
JSONL table and writes typed Parquet. These names are registrations, not built-ins.

| Artifact | Meaning |
| --- | --- |
| [catalog.json](examples/tabular/config/catalog.json) | Current-version flags and immutable language/mapping references |
| [crm.language.json](examples/tabular/config/crm.language.json) | Source `customers` dataset and exact schema references |
| [warehouse.language.json](examples/tabular/config/warehouse.language.json) | Target `accounts` dataset and exact schema references |
| [customers.schema.json](examples/tabular/config/customers.schema.json), [customers.spark.json](examples/tabular/config/customers.spark.json) | Logical source constraints and Spark column order/types |
| [accounts.schema.json](examples/tabular/config/accounts.schema.json), [accounts.spark.json](examples/tabular/config/accounts.spark.json) | Logical target constraints and Spark column order/types |
| [crm-to-warehouse.mapping.json](examples/tabular/config/crm-to-warehouse.mapping.json) | Direction, source view, target dataset and SQL byte digest |
| [accounts.sql](examples/tabular/config/accounts.sql) | Typed SELECT projection; no graph fields |
| [customers.jsonl](examples/tabular/customers.jsonl) | Four synthetic input records |
| [expected-accounts.json](examples/tabular/expected-accounts.json) | Expected decoded output values |

The config files contain real SHA-256 digests of their referenced example bytes,
including final newlines. Do not reformat a file without rebuilding its dependent
manifests and catalog. For a local object adapter, materialize the config files
under `<localObjectRoot>/transform-local/config/` and the source JSONL under
`<localObjectRoot>/transform-local/source/customers.jsonl`. Preserve the bytes.
Translate URI bucket/key components under that root with traversal checks.

Implement a fixture publisher that substitutes approved bucket/prefix identities
when needed and recalculates references in dependency order: logical/Spark
schemas and SQL → language/mapping manifests → catalog. Publish immutable
artifacts before replacing the catalog pointer. Local fixture materialization
must never publish to AWS; use Lexicon's shared flow for actual configuration.

## 2. First vertical slice and precise assertions

Implement JSONL → resolver → real Spark SQL → Parquet → reporter first. For
`executionId: example-001`, assert:

- Exactly one output dataset, `accounts`, with four rows. Its path is
  `s3://transform-local/results/demo/example-001/tables/accounts/`.
- Column order/types are `account_id:string`, `account_name:string(nullable)`,
  `balance:decimal(18,2)`, `active:boolean`, `created_on:date`.
- Sort only the small decoded test result by `account_id` before comparison;
  distributed output order is not part of the product contract.
- IDs retain leading zeros. Account `002` has a null name and account `003` has
  an empty name. Account `001` retains its comma/quotes and account `004` retains
  Unicode and the embedded newline. Compare balances as exact decimals, including
  12.30 and -4.25, not binary floats. Preserve the leap date 2024-02-29.
- The successful `Result` points to a byte-verified immutable plan. That plan
  embeds the selected language/mapping versions, verified schema/query digests,
  snapshot input objects and effective options. The manifest has one dataset
  entry with rowCount 4 and actual file/byte counts; do not assert one part file.
- No graph fields, `vertices/`, `edges/` or Persist dependency appear.

## 3. Expand without changing the engine

Generate CSV and Parquet forms of the same source rows using the registered
Spark types. For CSV, use quoted empty string, literal `\N` for null and quoted
logical records for commas/quotes/newlines. Run all **nine** input/output pairs
from `{parquet, jsonl, csv} × {parquet, jsonl, csv}`. Reread each result with its
registered schema and effective reader settings and apply the same assertions.
Use a fresh execution ID/output prefix for each case.

Register `warehouse-to-crm@1.0.0` separately with source `warehouse@2.0.0`, target
`crm@1.0.0`, required `accounts` as `source_accounts`, and this query:

```sql
SELECT
  account_id AS customer_code,
  account_name AS display_name,
  CAST(balance AS DECIMAL(18, 2)) AS balance,
  active,
  created_on
FROM source_accounts
```

Verify reverse values against the original fixture. Remove that registration and
assert reverse resolution fails before Glue. Add an explicit identity mapping
for format-only A → A work. Then register a second pair with different language
names but compatible schemas and SELECT mappings; run it without editing Python
or the resolver. This is the configurability acceptance gate.

For mixed-input joins, register `customers` and `tiers` source tables plus an
`enriched_accounts` target. Put customers in CSV and tiers in JSONL, then repeat
with tiers in Parquet. Define tiers as `(customer_code:string, tier:string)` with
rows `001/gold` and `002/silver`; use a left join on `customer_code`. Assert four
output rows, gold/silver for the first two and null tiers for 003/004. Register
`tier` as nullable. Do not infer the additional dataset schema at execution time.

Add two unrelated output datasets and verify they remain separate. Add two
ordered query fragments targeting a single dataset, with disjoint key ranges,
and assert the union has exactly the expected rows. Verify a target-view query
runs after its declared dependency; missing/cyclic dependencies fail resolution.

## 4. Graph acceptance

Implement the complete manifests, SQL and writer bindings in
[graph mappings](graph-mappings.md). Use these input records:

| Dataset | Records |
| --- | --- |
| people | `(1, Ada)`, `(2, Zoë)` |
| companies | `(10, Example)` |
| memberships | `(100, 1, 10)`, `(101, 2, 10)` |

Register nonempty string keys and names. Read these three tables with mixed
encodings. Assert two person vertices (`person:1`, `person:2`), one company
vertex (`company:10`) and two edges (`membership:100`, `membership:101`). Their
endpoints must be exactly the corresponding person/company IDs. Validate generic
graph outputs in all three encodings and the explicit Neptune CSV profile.

Repeat with query columns named `person_key`, `edge_key`, `source_key` and
`target_key`, and bind those exact names in the graph metadata. Expect identical
identity values; generic writers retain those registered column names while the
Neptune writer applies `~id`/`~from`/`~to` aliases. Rerun with fresh execution IDs
and assert stable graph identities.

Mutate one case at a time: duplicate a vertex ID, duplicate an edge ID, remove an
ID, use endpoint `1` instead of `person:1`, reference an absent company, bind an
input column that SQL renamed away, mismatch a property type, or add graph roles
to a tabular output. Assert the documented failure and no successful manifest.
Also verify graph → tabular through its own mapping: read registered graph fields,
project ordinary account fields in SQL, and assert no graph rules leak into the
tabular result. Do not limit graph shape to target-only registrations.

## 5. Failure and infrastructure gates

Implement explicit negative tests for unknown/disabled/ambiguous registrations,
version mismatch, modified SQL/schema bytes, duplicate JSON keys, unknown fields,
invalid required/null values, CSV header/width/null-marker collisions, decimal
precision overflow, malformed dates, nested CSV output, output-scope denial and
input object limits. Check the error phase and the absence of paid execution or
success publication as appropriate.

Exercise cost threshold/ceiling behavior, rejection/timeout, wrong approval plan
or ceiling, source mutation during snapshot, conflicting execution reuse, catalog
alias change after resolution, partial writes and reporting-only replay. A changed
catalog must not alter an approved plan; a rejected request must not start Glue.

Assert the synthesized workflow uses Standard execution, exact plan/digest Glue
arguments, callback validation before Glue, zero Glue retries, bounded reporting
retries and terminal failure alerting. Inspect scoped IAM and every queue's DLQ
alarm/recovery action. Use mocked AWS boundaries for orchestration tests and
actual Spark for all transformation/serializer assertions.

Write a target-repository evidence file with revision, toolchain, each scenario's
request/plan digest, expected/actual row counts, decoded comparison outcome,
error classification and artifact paths. Preserve command exits and synth output.
Use [operations and verification](operations-and-verification.md) for live gates;
these requirements do not themselves prove an implementation passed.
