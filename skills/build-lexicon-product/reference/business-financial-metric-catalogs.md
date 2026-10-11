# Business and financial metric catalog architecture

Use this contract when building or changing Model support for business and
financial metrics. Dialga owns this architecture and keeps it synchronized with
the implementations below. Jirachi reads it to configure an existing capability,
draft a compiler-supported in-family variant in the existing shape, or express
Model-derived metric suggestions for any domain in that shape; Jirachi
does not define the schema, artifact layout, precedence or compatibility
boundary.

Pin and inspect the selected revisions before acting. The paths below are verified
current interfaces, not permission to assume a deployment or copy a release ID,
count or digest into guidance.

## Model is the only source

`prismteam-ai/model` is the only canonical source for metric definitions, their
vocabulary and their governed releases. Author, review, validate, version and
publish every metric catalog through Model. Map every definition onto the
vocabulary of the governed Model release it ships with.

`Spring-Oaks-Capital-LLC/lexicon` is the legacy implementation of Model, not a
source. Do not author, draft or change metric definitions there, do not read its
`src/data/lexicon.json` or `src/data/financial-metrics/` files as semantic
evidence, and never let a copy there override a Model release. The `/lexicon/...`
SSM parameter names and `financial-metrics-catalog/` S3 layout are retained
consumer identifiers that Model publishes; they do not make the legacy repository
authoritative. Migrating any definition that exists only in the legacy repository
into a governed Model catalog is Dialga work; until it is migrated, treat it as a
Dialga migration gap rather than a reusable definition.

## Model catalog source

Keep each metric catalog with the Model package that owns its vocabulary in
`prismteam-ai/model`:

```text
configurations/<package>/composition.json
configurations/<package>/<catalog-id>.catalog.json
configurations/<package>/README.md
test/<package>.test.ts
```

`composition.json` is a Composition Contract v1 document. A business catalog is
normally carried by a Jirachi-managed extension that imports the governed shared
base by release ID and digest; the shared base intentionally declares no metric
catalogs. Composition Contract v1 stores catalog descriptors only under
`manifest.metricCatalogs[]`.

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

A curated catalog descriptor is:

```json
{
  "catalogId": "communication-delivery-metrics",
  "mode": "published",
  "contractVersion": "<model-owned catalog contract version>",
  "artifactUri": "<immutable Model release artifact URI>",
  "digest": "sha256:<catalog-bytes-sha256>"
}
```

`artifactUri` names the immutable catalog bytes published by a Model release. It
must not name a mutable SSM parameter, an approved marker, a branch, a squashable
commit or a legacy-repository file. `digest` is the `sha256:`-prefixed digest of
those exact bytes.

`compositionContractDocumentSchema` in `src/domain/schemas.ts` requires
`definitions` to hold at least one entry, and an extension must own its
`topVertex`. A `manifest.metricCatalogs[]` reference therefore cannot be
submitted on its own; it rides on a full package revision. Supporting a
catalog-only release is a Model contract change owned here.

Today the schema accepts only an external `artifactUri` and `digest`, and Model
records `metricCatalogs` as governance metadata without fetching, validating or
serving the catalog bytes. Carrying the catalog as an artifact of the same change
set, validating it and serving it from the release is Dialga work in
`prismteam-ai/model`.

## Definition shape

Model retains the existing metric configuration shape. A catalog file carries
package identity and integrity in `schema_version`, `package`,
`contract_versions`, `source_metadata`, `release_state`, `authority_ordering`
and digest fields such as `definition_set_digest`, plus top-level
`dev_activation_allowlist.{profile,mode,metric_ids}` and `metrics[]`. Treat counts
and digests as attested values to verify for the pinned release, not constants to
repeat in prompts.

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
new plan from a metric name. Model's generator builds it; authors omit it.

`dev_activation_allowlist` selects catalog IDs. It is not a definition status and
cannot alter metric semantics or create runtime support.

Dialga owns the Model catalog schema, contract version, validator and generator
in `prismteam-ai/model`: shape validation, vocabulary validation of every vertex,
edge, direction, property and enum value against the package's effective
vocabulary, materialization-plan generation and definition-set digests. Shape
extensions such as ratio metrics, edge-scoped conditions or non-payment
latest-state rules are Dialga decisions.

## Model publication and consumer boundary

The governed lifecycle is change-set submission, exact artifact upload,
validation status/results, review and authorized decision, publication
status/reconciliation, and immutable release/composition/artifact read-back. The
complete Composition Contract document is uploaded as the artifact selected by
`composition.documentArtifactId`; the change set's `sourceDigest` equals that
document artifact digest. Definitions stay in the catalog artifact, not inline in
Model request bodies.

Model publishes an approved catalog to the retained consumer boundary:

```text
financial-metrics-catalog/releases/<release_id>/
  <catalog file>
  approved-release.json
  build.json
  manifest.json
```

`approved-release.json` is a marker whose `catalog` object contains
`contract_version`, `artifact_path`, `sha256`, `bytes`, `definition_count` and
`definition_set_sha256`. `/lexicon/financial-metrics-catalog-uri` resolves the
exact marker; resolve `catalog.artifact_path` relative to it to obtain the catalog
bytes, then verify bytes and digests. The published bytes must equal the bytes of
the governed Model release artifact. Fail closed on a missing object, mismatched
release identity, length or digest.

Today the legacy repository still writes that boundary. Moving that publication
into Model, so the marker attests a Model release, is Dialga work; agents must not
write the boundary directly.

The Model UI must render catalog contents, not only the descriptor: catalog ID,
contract version, families, each metric's graph path, measure, conditions,
dimensions, time semantics and documented ratios, loaded from the release
artifact after digest verification. Implementing that view is Dialga work in
`prismteam-ai/model`.

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
output. ID membership alone is not executability. `PaymentMetricCatalogService.ts`
compiles every catalog definition while loading, so a single definition outside
the closed set or compiler gates fails the whole catalog load, not just that ID.

Persist's stack resolves `/lexicon/financial-metrics-catalog-uri` at deploy time
into its approved-release URI (with a CDK context override). A Model catalog
reaches Persist only after Model publishes it to that boundary and Persist
deploys. A Model release that is not yet published there is governance metadata
for Persist.

`PaymentMetricMaterializationPlan.ts` uses the selected supported plans.
`payment-metric-prod-shadow-config.ts` pins release and activation compatibility
and fails closed. Persist reads `dev_activation_allowlist` from the attested
catalog; it does not own a second semantic allowlist.

## Source-of-truth precedence

Apply this order without allowing a lower layer to redefine a higher one:

1. The reviewed Model release defines metric semantics, vocabulary and activation
   selection; no legacy-repository copy overrides it.
2. The published consumer boundary is valid only when its marker and bytes attest
   that exact Model release artifact.
3. The pinned Persist closed set and compiler decide whether a definition is
   executable. Activation also requires a catalog-backed selected ID.

Republish through Model when the boundary disagrees with the Model release. Stop
Model validation or publication when the descriptor URI/digest disagrees with the
artifact. A governed definition that Persist rejects may remain published, but it
is not an executable configuration and cannot be activated.

Keep these evidence states separate:

```text
definition exists in a reviewed Model release
catalog artifact published and attested
consumer boundary published from that release
consumer supports the definition
activation authorized and selected
materialization observed
```

## Adding definitions, families or runtime support

Jirachi may draft an in-family variant: a new `metrics[]` entry that copies a
same-family sibling's exact shape and changes only a filter value or dimension
that the pinned compiler already supports (family contract, metric-id prefix,
measure, business-time property, dimension selectors, condition properties and
enum values, and elections). Jirachi validates those gates read-only and
presents the entry as a reviewed Model source change in `prismteam-ai/model`
through Model's review and governed release flow, never as a direct S3/SSM edit,
a legacy-repository change or an activation. Reporting windows are not entries:
`grains` and `scopes` are fixed literals.

Each new metric ID also needs Persist's closed set to include it before the Model
release reaches a Persist deployment. Dialga coordinates that Persist change and
its sequencing.

Dialga owns everything else, including new families, new measures, new compiler
support and runtime:

- Change `prismteam-ai/model` for Model API/runtime behavior, composition schema
  and validation, catalog schema, validator and generator, source pins, digest
  handling, governed publication, consumer-boundary publication, the catalog UI
  view or a new reusable catalog capability.
- Coordinate `Spring-Oaks-Capital-LLC/persist` when the consumer's closed set,
  decoder, compiler, materializer or activation compatibility must change.
- Retire legacy-repository metric publication once Model publishes the boundary;
  never extend it.

Do not submit a generic Model composition to disguise missing semantics or
consumer support. Jirachi may suggest new-family definitions derived from
the governed Model vocabulary and expressed in the existing shape, and hands
them to Dialga as proposals; Dialga decides whether to adopt them. Do not make
Jirachi invent a vocabulary element, field, adapter or precedence rule, or
adopt a new family itself. Jirachi may resume configuration only after the
required capabilities exist at pinned revisions.

This contract is for business and financial metric definitions. Keep platform
telemetry outside this catalog architecture.
