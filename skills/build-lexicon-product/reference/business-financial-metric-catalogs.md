# Business and financial metric catalog architecture

Use this contract when building or changing Model support for business and
financial metrics. Dialga owns this architecture and keeps it synchronized with
the implementations below. Jirachi reads it to configure an existing capability;
Jirachi does not define the schema, artifact layout, precedence or compatibility
boundary.

Pin and inspect the selected revisions before acting. The paths below are verified
current interfaces, not permission to assume a deployment or copy a release ID,
count or digest into guidance.

## Current canonical payment source

The current payment financial-metric definition package is in
`Spring-Oaks-Capital-LLC/lexicon`:

```text
src/data/financial-metrics/payment-financial-metrics.v2.json
```

Its implementation contracts and deterministic builders are:

```text
scripts/lib/financial-metrics/types.ts
scripts/lib/financial-metrics/catalog.ts
scripts/lib/financial-metrics/materialization.ts
scripts/lib/financial-metrics/release.ts
scripts/generate-financial-metrics-materialization.ts
scripts/build-financial-metrics-release.ts
infra/lib/financial-metrics-release.ts
infra/lib/lexicon-stack.ts
```

`src/data-sources/financial-metrics.ts` is a UI adapter, not the semantic source.
`src/data/lexicon.json` supplies the graph labels, properties and directed
relationships referenced by the package.

The package currently has these top-level fields:

```text
schema_version
package
contract_versions
source_metadata
release_state
authority_ordering
universal_metric_model
vocabularies
global_scope_semantics
materialization_defaults
materialization_protocol
materialization_family_matrix
immutability
counts
dev_activation_allowlist
metrics
```

`package` carries `package_id`, `package_version`, `release_id`, `status`,
`definition_count` and `definition_set_digest`. Treat the count and digest as
attested values to verify for the pinned revision, not constants to repeat in
prompts.

Each `metrics[]` entry currently carries:

```text
identity:
  metric_id, business_name, definition_version, catalog_contract_version,
  family_id, category, report_category

graph and scope:
  root, graph_source, path, path_hops, scope_paths, scopes

calculation:
  unique_item, contribution_identity, measure, calculation, unit,
  contribution_rule, correction_rule

selection:
  qualifying_conditions, dimensions

time and coverage:
  time_behavior, business_time_election?, latest_state_election?,
  business_time_property, business_timezone, date_used, grains,
  coverage_mode, coverage_start_date?

runtime and output:
  triggering_vertices, triggering_edges, output_cell_type, output_value_type,
  scope_edge_types, period_vertex_type, period_edge_type, materialization_plan
```

`materialization_plan` is structured executable data. Its current groups are
`schema_version`, `family_id`, `materialization_ready`, `source`,
`trigger_bindings`, `predicates`, `temporal`, `scopes`, `period`,
`contribution` and `output`. Do not replace those fields with prose or infer a
new plan from a metric name.

The separate top-level
`dev_activation_allowlist.{profile,mode,metric_ids}` selects catalog IDs. It is
not a definition status and cannot alter metric semantics or create runtime
support.

## Generated and published Lexicon representation

The Lexicon build generates one immutable release directory:

```text
.generated/financial-metrics-catalog/releases/<lexicon_version_id>/
  payment-financial-metrics.v2.json
  approved-release.json
  build.json
  manifest.json
```

The generated catalog bytes must equal the canonical source bytes. `manifest.json`
attests the source package, Lexicon source revision/digest, release identity and
every payload. `build.json` records the release and manifest paths.

`approved-release.json` is a marker. Its `catalog` object contains:

```text
contract_version
artifact_path
sha256
bytes
definition_count
definition_set_sha256
```

Lexicon deploys the directory under
`financial-metrics-catalog/releases/<lexicon_version_id>/` with immutable cache
semantics. `/lexicon/financial-metrics-catalog-uri` resolves the exact
`approved-release.json` object. Resolve its `catalog.artifact_path` relative to
the marker to obtain the sibling catalog URI, then verify bytes and digests.
The SSM value and marker URI are discovery coordinates; neither is the catalog
URI used by Model's published-catalog reference.

The top-level `/lexicon/release-uri` attestation must agree with the generated
manifest. Fail closed on a missing object, stale source attestation, mismatched
release identity, length or digest.

## Model catalog representation

`prismteam-ai/model` owns the reusable Model API, composition contract,
validation and governed lifecycle. Composition Contract v1 stores catalog
descriptors only under `manifest.metricCatalogs[]`.

A generated Base Metrics descriptor is:

```json
{
  "catalogId": "base-metrics",
  "mode": "generated",
  "contractVersion": "base-metrics-catalog/v1",
  "generatorSourceAlias": "base-metrics-generator",
  "input": "package",
  "maximumPathHops": 7
}
```

`generatorSourceAlias` must resolve to a pinned `manifest.sources[]` entry with
`alias`, `repository`, `revision`, `path` and `digest`.

An immutable published catalog descriptor is:

```json
{
  "catalogId": "payment-financial-metrics",
  "mode": "published",
  "contractVersion": "financial-metrics-catalog/v2",
  "artifactUri": "s3://immutable-release-prefix/payment-financial-metrics.v2.json",
  "digest": "sha256:<catalog-bytes-sha256>"
}
```

For payment metrics, `artifactUri` names the immutable sibling catalog object
resolved from the verified Lexicon marker. It must not name the mutable SSM
parameter, the marker, or a copied definition payload. `digest` is Model's
`sha256:`-prefixed digest of those exact catalog bytes.

The complete Composition Contract document is uploaded as the artifact selected
by `composition.documentArtifactId`; the change set's `sourceDigest` equals that
document artifact digest. Payment definitions stay in the referenced catalog,
not in Model request bodies.

The generic lifecycle is change-set submission, exact artifact upload,
validation status/results, review and authorized decision, publication
status/reconciliation, and immutable release/composition/artifact read-back.
Implement missing contract validation or runtime/API support in
`prismteam-ai/model`; prompt guidance is not a runtime adapter.

## Persist compatibility and activation

`Spring-Oaks-Capital-LLC/persist` is the current execution consumer. Inspect:

```text
lambda/schemas/payment-metric-catalog.ts
lambda/schemas/payment-metric-supported-definitions.ts
lambda/services/PaymentMetricCatalogService.ts
lambda/services/PaymentMetricDeclarativePlanCompiler.ts
lambda/services/PaymentMetricMaterializationPlan.ts
lambda/payment-metric-prod-shadow-config.ts
```

`payment-metric-catalog.ts` decodes the approved marker and catalog.
`PaymentMetricCatalogService.ts` verifies release identity, catalog bytes,
definition-set integrity, allowlist ordering/uniqueness/subset rules and plan
coverage. `payment-metric-supported-definitions.ts` is a closed ID set.
`PaymentMetricDeclarativePlanCompiler.ts` additionally gates family, root, path,
selectors, predicates, measures, calculations, dimensions, elections, time and
output. ID membership alone is not executability.

`PaymentMetricMaterializationPlan.ts` uses the selected supported plans.
`payment-metric-prod-shadow-config.ts` pins release and activation compatibility
and fails closed. Persist reads `dev_activation_allowlist` from the attested
catalog; it does not own a second semantic allowlist.

## Source-of-truth precedence

Apply this order without allowing a lower layer to redefine a higher one:

1. The pinned Lexicon source package defines current payment metric semantics and
   activation selection.
2. Its generated directory is publishable only when the manifest and marker
   attest the selected source and Lexicon revision.
3. A reviewed Model release governs the exact immutable catalog URI/digest
   reference and its publication metadata; it does not rewrite catalog
   definitions.
4. The pinned Persist closed set and compiler decide whether a definition is
   executable. Activation also requires a catalog-backed selected ID.

Regenerate through Lexicon when source and generated bytes disagree. Stop Model
validation or publication when the published URI/digest disagrees with the
attested catalog. A governed definition that Persist rejects may remain
published, but it is not an executable configuration and cannot be activated.

Keep these evidence states separate:

```text
definition exists
artifact generated and attested
Model release reviewed and published
consumer supports the definition
activation authorized and selected
materialization observed
```

## Adding definitions, families or runtime support

Dialga owns the decision and implementation boundary:

- Change `prismteam-ai/model` for Model API/runtime behavior, composition schema
  and validation, source pins, digest handling, governed publication or a new
  reusable catalog capability.
- Coordinate `Spring-Oaks-Capital-LLC/lexicon` when current canonical payment
  schema, definition/family semantics, validator/generator, materialization plan
  generation or immutable release publication must change.
- Coordinate `Spring-Oaks-Capital-LLC/persist` when the consumer's closed set,
  decoder, compiler, materializer or activation compatibility must change.

Do not submit a generic Model composition to disguise missing semantics or
consumer support. Do not make Jirachi invent a field, family, path, adapter or
precedence rule. Jirachi may resume configuration only after the required
capabilities exist at pinned revisions.

This contract is for business and financial metric definitions. Keep platform
telemetry outside this catalog architecture.
