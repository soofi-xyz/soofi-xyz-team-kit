---
name: build-transform-product
description: "Implement the Transform product: registered from/to data languages, Lexicon SQL configuration, Python/PySpark execution, Parquet/JSONL/CSV formats, typed tables, graph vertex/edge ID mappings, and TypeScript CDK orchestration."
---

# Build Transform Product

Use `kecleon` to implement a reusable Transform service. Require explicit source
and target languages, and keep language identity, logical shape and file format
independent. Discover the target repository/deployment; assume no company,
source system, fixed language pair or local checkout path.

## Required reading

1. Read [the implementation PRD](reference/PRD.md) before planning/coding.
2. Read [language and mapping registration](reference/languages-and-mappings.md)
   for schema/manifests, exact pair resolution and Lexicon publication.
3. Read [formats and Spark execution](reference/formats-and-execution.md) for
   Parquet/JSONL/CSV readers/writers and typed DataFrames.
4. For graph sources/targets, read [graph mappings](reference/graph-mappings.md)
   for exact manifest bindings, SQL aliases, IDs, endpoints and property headers.
5. Follow [engineering guidelines](../apply-engineering-guidelines/SKILL.md):
   Python/PySpark for data, TypeScript for Lambdas/contracts/CDK.
6. Use [operations and verification](reference/operations-and-verification.md)
   for discovery, execution, migration and acceptance tests.

## Implementation rules

- Require `from` and `to`. Resolve registered schemas and an enabled directional
  SQL mapping; reject missing, ambiguous or version-incompatible pairs.
- Use Lexicon's governed catalog for language/schema references and SQL manifests.
  Discover its configured S3/SSM location and pin artifact versions/digests.
- Read each named source with its declared format/schema, execute `spark.sql()`
  and validate each target dataset. Preserve logical types and table boundaries.
- Support Parquet, JSONL and CSV on both sides. A tabular output is a complete
  supported result without graph IDs, labels or a graph-store dependency.
- Define graph roles explicitly: a vertex's `idColumn` maps to `~id`; an edge's
  `idColumn`, `from.column` and `to.column` map to `~id`, `~from` and `~to`.
  Bind the returned SQL column names: SQL returning `~id` requires `idColumn: "~id"`,
  not the source field renamed by that query. Require stable IDs and endpoint values
  identical to the referenced vertex IDs, never bare unmatched source keys.
- Use graph property bindings and registered types for serialization. Activate
  Neptune headers/layout only through the explicit graph profile; do not infer
  graph semantics from CSV format or filenames.
- Keep cost admission, output manifests and metrics format-neutral. Discover
  actual compatibility needs before adding a version adapter; do not import
  source-specific behaviors into the general contract.

## Companion products and output

Load [Lexicon](../build-lexicon-product/SKILL.md) for configuration/schema
publication and [Persist](../build-persist-service/SKILL.md) only for requested
graph loading. Keep their deployment details outside this general product spec.

Return the resolved pair/mapping, schemas/formats, graph role bindings when
applicable, implementation/migration changes, publication/deployment status and
verification evidence. Mark unsupported deployment capabilities explicitly.
