# Transform — Multilingual Implementation PRD

Implement a Python/PySpark service that converts between **registered data
languages** using governed SQL configuration. Require explicit `from` and `to`.
Support Parquet, JSONL, CSV and Excel on both sides, with tabular and graph
targets. A language is a Lexicon language definition and that definition is its
schema; the registered mapping defines encoding (format, options) and shape
(tables or graph). A request names the languages and S3 locations, nothing else.

Use this as a product implementation blueprint. Discover the target repository,
revision, installed capabilities and caller contracts before modifying a service.
Do not infer deployment support from this document or depend on a particular
company, source system or language pair.

For a new product, follow [the from-scratch path](from-scratch.md) to write code
in the target repository. Use the [machine-readable contracts](contracts-and-defaults.md),
[worked examples](worked-example.md) and acceptance criteria as specifications.
Keep the shared engineering, Lexicon and requested Persist skills. Discover
existing contracts before integrating these requirements into an existing product.

## 1. Required architecture

```text
Request: from + to + named input S3 locations + output S3 prefix
  → TypeScript request validation and plan resolution
      ← Lexicon language definitions + directional SQL mapping catalog
        (mapping declares input formats/options and output shape/format)
  → pin definitions, mapping, SQL and input artifact identities
  → estimate all selected inputs → cost gate / optional approval
  → Python/PySpark Glue job
      readers → typed named views → registered Spark SQL
      → validate target tables → selected writers/profile
  → per-dataset output manifest + generic metrics → result
```

Use Python, `GlueContext`, DataFrames and `spark.sql()` for distributed data
processing. Use boto3 for configuration and small metadata objects. Use
TypeScript for JSON Schema validation, resolver/cost/reporting Lambdas,
Step Functions and CDK. Keep joins, projections and language-specific logic in Lexicon SQL.
Adding a compatible language pair must require registration/configuration,
not an engine code branch named after either language.

## 2. Versioned public request

Implement this versioned request shape (`contractVersion: 2`):

```json
{
  "contractVersion": 2,
  "from": "crm",
  "to": "warehouse",
  "inputs": [
    { "table": "customers", "s3Uri": "s3://transform-local/source/customers.csv" }
  ],
  "output": { "s3Prefix": "s3://transform-local/results/demo" },
  "costCeilingUsd": 25
}
```

Use `crm`/`warehouse` here as illustrative registered languages, not built-ins.

| Field | Required behavior |
| --- | --- |
| `contractVersion` | Require `2` for the generic contract |
| `from`, `to` | Required nonempty registered language names. Each resolves to its single enabled `current` version; the pair resolves to its single enabled directional mapping. No version, mapping ID or mapping version fields exist |
| `inputs` | Nonempty list of `{table, s3Uri}` bindings, each table once, matching the mapping's declared inputs. Format, sheet and reader options come from the mapping |
| `output.s3Prefix` | Required run-output base; normalize its trailing slash once. Shape, format, profile and writer options come from the mapping |
| `costCeilingUsd` | Optional positive override within the environment's authorized maximum; otherwise use the deployed ceiling |

Require the mapping's inputs and verify each table against the source language
definition. Reject unknown table bindings and unknown fields. Mixed encodings
across inputs are a property of the mapping, not the request. A single CSV,
JSONL or Excel file is a valid named table; do not require a directory-per-table
root for every input. Preserve S3 scope authorization independently of
format/definition validation.

Do not interpret language names as natural-language locales or file extensions.
Do not assume that registration of A and B creates an A → B mapping, that A → B
can be inverted, or that every translation passes through the Lexicon language.
A → A requires an explicit identity mapping if the caller wants format conversion.

## 3. Registration and exact pair resolution

Use [languages-and-mappings.md](languages-and-mappings.md) as the configuration
contract. Extend Lexicon's S3/SSM publication with a versioned catalog that
points at Lexicon language definitions and directional `spark-sql` mapping
manifests. Register enabled versions before accepting executions. Every language
on either side must be a Lexicon language; do not keep a private Transform
registry or a parallel schema artifact.

Keep Lexicon the **configuration product** and `lexicon` one possible **data
language**. The configuration owner does not force `to: "lexicon"`.
The proposed generic catalog pointer is `/lexicon/transform-catalog-uri`;
implement/discover it explicitly rather than claiming it already exists.

Resolve once before cost admission, including language versions, definition
digests, mapping version, SQL digests, required table bindings, input object
manifest, output datasets and the mapping's reader/writer settings. Persist an immutable execution-plan artifact
and pass its pointer to Glue. Validate its digests at execution; do not resolve
moving aliases again after approval or retries. Use immutable input objects or
staged snapshots for reproducibility; recording a digest does not freeze a
mutable prefix.

## 4. Python/PySpark implementation

Follow [formats-and-execution.md](formats-and-execution.md):

1. Parse the plan URI/digest, execution ID and contract URI/digest arguments
   specified in the build guide; initialize Glue/Spark,
   read the pinned plan, and verify the supported plan version and digests.
2. Load each named input with the mapping's format/options and the definition's
   types; validate source rows and register the manifest's explicit Spark view.
3. Fetch the registered SQL objects and execute them with `spark.sql()` in
   dependency order. Validate every result against its target dataset definition.
4. Keep typed DataFrames and output table boundaries. Combine only explicitly
   declared fragments of the same logical table after schema alignment.
5. Serialize each table in the mapping's output format. Apply graph transformations
   only for a declared graph output/profile. Write completion metadata only
   after all datasets and schema artifacts succeed.

Preserve ordinary table columns and types in the tabular path. For graph targets,
follow [graph-mappings.md](graph-mappings.md): bind each vertex identity to `~id`
and each edge identity/source/target to `~id`/`~from`/`~to`. Require exact endpoint
identity matches and deterministic IDs. Keep writer-specific headers and string
serialization inside the selected graph profile.

## 5. TypeScript workflow and implementation layout

Implement this layout in a new product; map the same responsibilities to an
existing checkout before editing.

| Target module to create | Responsibility |
| --- | --- |
| `src/contracts.ts`, `schemas/contracts.schema.json` | Versioned requests, resolved plans, dataset manifests, costs, approval and failure contracts |
| `src/control.ts`, `src/store.ts` | Resolve registrations, enforce scopes, snapshot inputs, estimate cost, pin plans and verify results |
| `glue_scripts/transform_worker.py` | Shared Glue/local readers, typed validation, configured queries, graph checks and dataset writers |
| `src/handler.ts` | Resolution, approval, reporting and failure Lambda entry points with shared observability integrations |
| `lib/transform-stack.ts` | Workflow transitions, scoped IAM, plan storage, Glue arguments, approval queue and failure alarms |
| `src/cli.ts`, `src/fixtures.ts`, `tests/` | Local commands, complete publication examples and executable verification |
| Lexicon source/publication | Publish language definitions, pair manifests, SQL assets and generic catalog pointer |

Use TypeScript CDK/Step Functions with a Python/PySpark Glue job. Discover the
actual stack through its outputs and configured SSM pointers, and verify account
and region with the selected profile. Make Glue version, worker type/count,
concurrency, Spark settings and Lambda runtime deployment configuration. Choose
compatible versions and measure representative workloads before tuning.

Implement v2 control flow as validate/resolve → estimate → approval if required
→ Glue `.sync` → generic reporting → result. Validate successful callback payloads
before allowing execution. Bound plan/source listing and payload sizes; pass S3
plan pointers instead of large inline lists. Fail unsupported requests before
starting a paid Glue job. Do not force CSV/JSONL through the Parquet-only estimator.

## 6. Output manifest and result

Write each dataset under `<output.s3Prefix>/<executionId>/tables/<dataset>/` for
tabular or generic graph tables. Record an explicit Neptune profile's vertex/edge
paths instead of assuming that layout for every run. Preserve a target schema
artifact per dataset, including for CSV. Empty valid tables still have schema
and zero-row manifest entries.

Write `_metadata.json` using the exact `Result` definition in the contract
schema. Include its pinned plan URI/digest; that plan supplies definition/SQL/input
identities, formats, profile and creation time without inventing extra result
fields. Include per-dataset counts/schema paths and `finishedAt`. Publish only
after all validation succeeds; write detailed timings/diagnostics in separate
run audit objects. Keep source records out of operational logs.

Return `status`, `executionId`, `from`, `to`, resolved mapping identity,
`outputManifestS3Uri`, a dataset summary and modeled costs. Metadata presence is
completion evidence only after the planned outputs pass validation and writing.
Distinguish zero-row success, partial writes and failures. Verify a requested
Persist load independently; tabular outputs require no Persist deployment.

## 7. Migration and verification

For an existing service, inventory supported requests, responses and consumers.
Version changes explicitly and add adapters only for discovered compatibility
needs; a legacy request (source URI, output prefix, mapping URIs) is served by
an explicit adapter keyed on `contractVersion` that produces a current request. Reject unsupported versions before workflow states discard fields; never
reinterpret an invalid request as a default language pair. Keep configuration
revisions and compatible deployments available for rollback.

Follow [operations and verification](operations-and-verification.md). Prove two
independently registered languages, all sixteen input/output format combinations,
mixed-format joins and ordinary tabular output. Verify graph vertex/edge bindings,
exact endpoint identity, a separate reverse mapping and unknown/disabled/ambiguous
pair failures. A new compatible pair must work through registration alone.
Report implementation/deployment gaps as evidence, not product restrictions.
Use [AWS workflow](aws-workflow.md) for explicit baseline limits and recovery
behavior. Local tests and synthesis do not establish live deployment status.
