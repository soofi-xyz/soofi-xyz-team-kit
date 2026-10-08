---
name: build-transform-product
description: "Implement Transform: registered language-pair SQL conversions and non-deterministic extraction from strings using configurable Amazon Bedrock models, JSON Schema structured output and the AI SDK; include Python/PySpark formats, typed tables, graph mappings and TypeScript orchestration."
---

Use [the Transform capability map](../guide-product-work/reference/iterations/transform.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

Follow [guide-product-work](../guide-product-work/SKILL.md). Kecleon builds the engine; Silvally authors, publishes and tests particular mappings.

# Build Transform Product

Use `kecleon` to implement a reusable Transform service. For SQL conversion, require explicit source
and target language names; a language is a Lexicon language definition and that
definition is its schema. The registered mapping owns input formats and the
output shape/format; a request supplies only S3 locations. Discover the target repository/deployment; assume no company,
source system, fixed language pair or local checkout path.

For non-deterministic transformation, use a separate TypeScript extraction phase:
string input → configured Bedrock model through the AI SDK → schema-validated JSON.
Read [non-deterministic extraction](reference/non-deterministic-extraction.md)
for its configuration, prompt, runtime, API integration and acceptance contract.
Keep the SQL rules below scoped to SQL; do not force raw strings into a Spark table.

## Required reading

For a new product, start with [the from-scratch build path](reference/from-scratch.md).
Create the product code and tests in the target repository using the module
contracts and build sequence. This skill contains instructions, declarative
contracts and examples only. Keep the shared skills below and use the specified
defaults for routine choices.

1. Read [the implementation PRD](reference/PRD.md) before planning/coding.
2. Read [language and mapping registration](reference/languages-and-mappings.md)
   for definition-derived schemas, manifests, exact pair resolution and Lexicon
   publication.
3. Read [formats and Spark execution](reference/formats-and-execution.md) for
   Parquet/JSONL/CSV/Excel readers/writers and typed DataFrames.
4. For graph sources/targets, read [graph mappings](reference/graph-mappings.md)
   for exact manifest bindings, SQL aliases, IDs, endpoints and property headers.
5. Follow [engineering guidelines](../apply-engineering-guidelines/SKILL.md):
   Python/PySpark for data, TypeScript for Lambdas/contracts/CDK.
6. Use [operations and verification](reference/operations-and-verification.md)
   for discovery, execution, migration and acceptance tests.
7. Use [contracts and defaults](reference/contracts-and-defaults.md)
   for the canonical schemas and [AWS workflow](reference/aws-workflow.md) for
   exact transitions, permissions, costs, callbacks and recovery. Use the
   [worked example](reference/worked-example.md) for concrete artifacts and
   expected values when implementing acceptance tests.

## SQL implementation rules

- Require `from` and `to` language names only. Resolve each to its single
  enabled current registration and the one enabled directional SQL mapping;
  reject missing or ambiguous pairs. Requests carry no versions or mapping IDs.
- Every language on both sides is registered in Lexicon. Use its governed
  catalog for language definitions and SQL manifests; publish no duplicate
  schema artifact. Discover the configured S3/SSM location and pin digests.
- Take each input's format/options and the output shape/format/profile/options
  from the mapping. A different delimiter or format is a new mapping.
- Read each named source with the mapping's format and the definition's types,
  execute `spark.sql()` and validate each target dataset. Preserve logical types
  and table boundaries.
- Support Parquet, JSONL, CSV and Excel on both sides; one Excel sheet is one
  dataset. A tabular output is a complete supported result without graph IDs,
  labels or a graph-store dependency.
- Define graph roles explicitly: a vertex's `idColumn` maps to `~id`; an edge's
  `idColumn`, `from.column` and `to.column` map to `~id`, `~from` and `~to`.
  Bind the returned SQL column names: SQL returning `~id` requires `idColumn: "~id"`,
  not the source field renamed by that query. Require stable IDs and endpoint values
  identical to the referenced vertex IDs, never bare unmatched source keys.
- Use graph property bindings and registered types for serialization. Activate
  Neptune headers/layout only through the explicit graph profile; do not infer
  graph semantics from CSV format or filenames.
- Keep cost admission, output manifests and metrics format-neutral. Discover
  actual compatibility needs before adding a version adapter; serve a legacy
  request shape only through an explicit `contractVersion`-keyed adapter. Do not
  import source-specific behaviors into the general contract.

## Non-deterministic extraction phase

Implement the capability map's `non-deterministic-extraction` increment using
[the phase contract](reference/non-deterministic-extraction.md). Pin the selected
configuration's model, JSON Schema, extraction instructions and inference limits.
Accept only strings and use `ai` with `@ai-sdk/amazon-bedrock` for structured
generation; validate the result against the configured schema before success.
Keep the phase's configuration and submission/status/result APIs in Transform.
Version new contracts explicitly; do not add extraction fields to the v2 SQL
request or claim existing deployment support from this specification.

## Companion products and output

Load [Lexicon](../build-lexicon-product/SKILL.md) for language definition and
mapping publication and [Persist](../build-persist-service/SKILL.md) only for requested
graph loading. Keep their deployment details outside this general product spec.

Return the resolved pair/mapping or extraction configuration/model/schema,
definitions/formats and graph role bindings when
applicable, implementation/migration changes, publication/deployment status and
verification evidence. Mark unsupported deployment capabilities explicitly.
For from-scratch work, include the actual toolchain, acceptance evidence and
synthesis result. Continue through the agreed build stage and checks; a prose specification
alone is not completion. Require live evidence before claiming AWS readiness.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Own mapping registration, replay/conflict and read-back semantics; keep shared installer execution in Deploy.
