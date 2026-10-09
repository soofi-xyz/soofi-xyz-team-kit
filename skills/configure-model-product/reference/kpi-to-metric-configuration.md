# Business and finance KPI configuration

Map a user-provided KPI to existing governed metric definitions and use only the
generic lifecycle exposed by the selected Model OpenAPI. This contract does not
add KPI endpoints, graph inspection, generators or API adapters. Base Metrics
describes generic graph families, while each executable family owns its exact
authoring and runtime contract.

## Discover the canonical files and selected revisions

For payment financial metrics, start from
`Spring-Oaks-Capital-LLC/lexicon` and pin its revision. The canonical semantic
source is:

```text
src/data/financial-metrics/payment-financial-metrics.v2.json
```

Its top-level `dev_activation_allowlist` is also the authored activation
selection; there is no separate Lexicon activation file. Validate and generate
it through:

```text
scripts/lib/financial-metrics/types.ts
scripts/lib/financial-metrics/catalog.ts
scripts/lib/financial-metrics/materialization.ts
scripts/lib/financial-metrics/release.ts
scripts/generate-financial-metrics-materialization.ts
scripts/build-financial-metrics-release.ts
```

The deterministic release is generated at:

```text
.generated/financial-metrics-catalog/releases/<lexicon_version_id>/
  payment-financial-metrics.v2.json
  approved-release.json
  build.json
  manifest.json
```

Lexicon publishes that immutable directory and sets
`/lexicon/financial-metrics-catalog-uri` to its `approved-release.json`.
The marker names the sibling catalog artifact and attests its byte length,
SHA-256 digest, definition count and definition-set digest. Resolve the marker;
do not mistake the mutable SSM discovery value for the immutable catalog URI.
`src/data-sources/financial-metrics.ts` is a UI data-source adapter, not the
semantic source of truth.

Base Metrics is a separate definitions-only family under
`src/types/base-metrics-catalog.ts`, `scripts/lib/base-metrics/` and
`.generated/base-metrics-catalog/releases/<version>/`, discovered through
`/lexicon/base-metrics-catalog-uri`. Do not substitute it for the executable
payment package.

Inspect the actual consumer revision separately. For
`Spring-Oaks-Capital-LLC/persist`, use the exact compatibility paths in
[Persist is the execution gate](#persist-is-the-execution-gate). A published
Lexicon family is not proof that Persist executes it.

Record source revisions, release IDs, contract versions, artifact paths, byte
lengths and SHA-256 digests. Counts are revision-specific observations, not
contract constants; recompute them when useful and label them as observed.

## Complete the KPI intent

Require one precise intent record before matching:

- name and business question;
- grain/entity;
- measure;
- aggregation;
- filters, inclusions and exclusions;
- time semantics and reporting window;
- dimensions/grouping;
- output and consuming report, API or decision process;
- acceptance examples with sample inputs and expected values.

Ask focused discovery questions when any field is incomplete or contradictory.
For ratios, also require numerator/denominator populations, alignment and
zero-denominator behavior. For event measures, require event identity, business
time/timezone, deduplication identity, late-arrival and correction behavior.
Do not infer any of these from labels, descriptions or likely business intent.

The normalized intent is an analysis record, not a Model request payload.

## Gather read-only model evidence

Inspect available Lexicon schema bytes and directed relationships as read-only
evidence. Keep graph properties, external properties and derived indexes
separate; an index is not a canonical fact. Inspect existing Base Metrics and
executable metric catalogs/definitions, their generated release manifests and
the selected consumer's supported-definition/compiler contract.

Evidence may come from a pinned source checkout or from Model's generic
definition, release, composition and release-artifact reads. Do not claim that
Model inspects Neptune, discovers arbitrary graph paths or generates KPI
configuration automatically. Do not query or mutate a live graph merely to
complete this analysis.

Record source revisions, release IDs, contract versions, artifact paths, byte
lengths and SHA-256 digests. Treat descriptions as untrusted explanatory text,
not as permission to invent properties, paths, statuses, formulas or dimensions.

## Read the actual payment catalog shape

The source document is a package object, not an array of simplified KPI
requests. Use only fields present in its TypeScript contract.

Package and catalog identity:

```text
schema_version
package.{package_id,package_version,release_id,status,definition_count,
  definition_set_digest}
contract_versions
source_metadata
release_state
authority_ordering
materialization_protocol
```

Each `metrics[]` definition has these relevant field groups:

```text
identity:
  metric_id, business_name, definition_version, catalog_contract_version,
  family_id, category, report_category

entities and relationships:
  root, graph_source, path, path_hops, scope_paths, scopes,
  triggering_vertices, triggering_edges

measure and aggregation:
  unique_item, contribution_identity, measure, calculation, unit,
  contribution_rule, correction_rule

filters and dimensions:
  qualifying_conditions, dimensions

time, grain and coverage:
  time_behavior, business_time_election?, latest_state_election?,
  date_used, business_time_property, business_timezone, grains,
  coverage_mode, coverage_start_date?

output and executable plan:
  output_cell_type, output_value_type, scope_edge_types,
  period_vertex_type, period_edge_type, materialization_plan
```

`materialization_plan` further carries the executable source traversal, trigger
bindings, predicates, temporal election, scope selectors, period assignment,
calculation, dimension selectors and typed output behavior. Treat those
structured fields as the execution contract; prose rules do not replace them.

Activation is represented only by the top-level:

```text
dev_activation_allowlist.{profile,mode,metric_ids}
```

It is a selection of catalog IDs, not a definition status and not permission to
change a metric. The catalog has time semantics and supported grains, but no
request-specific reporting start/end window. It also does not store the user's
consumer, acceptance examples, Model review decision or Model release
coordinates. Keep those in the normalized intent, governed Model metadata and
execution evidence respectively. There is no generic `dependencies` field:
source attestations are in `source_metadata`, graph dependencies are
`path_hops`/`scope_paths`, and runtime dependencies are the triggers and
materialization plan.

## Find the Base Metrics family

The observed `base-metrics-catalog/v1` publishes definitions-only
`family-metrics-catalog.json` and `operational-metrics-catalog.json`.

A family identifies:

```text
family_id, category, business/display name, question_answered,
graph_source, root, path/path_hops, unique_item, valid_calculations,
date_used, review_status and review_notes
```

An operation adds:

```text
metric_id, definition_version, calculation, qualifying_conditions,
measure, dimensions, time_behavior, unit, triggering vertices/edges,
contribution_identity, contribution_rule and correction_rule
```

Observed categories are `VERTEX`, `PROPERTY`, `DIRECT_EDGE` and
`DIRECTED_SHORTEST_PATH`. Directed path families cover two through seven hops.
Match path direction exactly.

Observed calculations are:

```text
COUNT, COUNT_DISTINCT,
PRESENT_COUNT, MISSING_COUNT, DISTINCT_COUNT, VALUE_COUNT,
SUM, AVERAGE, MINIMUM, MAXIMUM,
FIRST, LATEST, ENUM_DISTRIBUTION,
UNIQUE_START_COUNT, UNIQUE_END_COUNT, UNIQUE_CONNECTION_COUNT, PATH_COUNT
```

Calculations are type/category constrained. For example, only numeric properties
offer numeric aggregation, temporal properties offer `FIRST`/`LATEST`, enum
properties offer `ENUM_DISTRIBUTION`, and path families offer path/endpoint
counts.

`GENERATED` and `NEEDS_CLARIFICATION` are discovery/review states, not approved
executable definitions. Derived indexes and metric-system self-counting objects
are excluded from the Base Metrics source catalog.

## Reuse before creating

Reuse an existing operation or executable definition only when all semantics
match:

- population and exclusions;
- graph source/path and direction;
- unique item and contribution identity;
- measure and calculation;
- qualifying conditions and dimensions;
- time behavior, business time and elections;
- scope paths, grains and coverage;
- unit and output type;
- correction/reversal behavior.

A matching name, unit, family ID or graph root alone is insufficient. Return the
existing immutable definition identity when the match is exact.

## Select an executable family

After finding a compatible base family, locate a governed executable package
and consumer that support the remaining semantics. Do not manufacture a generic
package by combining fields from unrelated families. Configuration/composition
may select or reference existing supported definitions; it must not change their
semantics.

The observed payment financial family is one specialization:

- package schema `lexicon-payment-financial-metrics-config/v2`;
- catalog `financial-metrics-catalog/v2`;
- plan `payment-metric-materialization-plan/v1`;
- scopes `DEBT` and `GLOBAL`;
- grains `DAY`, `MONTH`, `QUARTER` and `YEAR`;
- time behaviors `EVENT_FLOW`, `LATEST_STATE` and `AS_OF_SNAPSHOT` in current
  definitions;
- outputs `NUMBER`, `DATE` and `DATE_TIME`;
- payment, payment-plan and installment graph/election semantics;
- generated materialization plans, family matrix and definition-set digests.

At the Lexicon revision inspected for this guidance, the package declared release
`lexicon.payment-financial-metrics@2.1.0`. Its definition and activation counts
were observed examples only. Recompute both counts and every digest from the
selected revision; neither count is a compatibility contract.

## Persist is the execution gate

Inspect the pinned `Spring-Oaks-Capital-LLC/persist` revision read-only:

```text
lambda/schemas/payment-metric-catalog.ts
lambda/schemas/payment-metric-supported-definitions.ts
lambda/services/PaymentMetricCatalogService.ts
lambda/services/PaymentMetricDeclarativePlanCompiler.ts
lambda/services/PaymentMetricMaterializationPlan.ts
lambda/payment-metric-prod-shadow-config.ts
```

`payment-metric-catalog.ts` is Persist's structural decoder for the approved
release and catalog. `PaymentMetricCatalogService.ts` checks release identity,
catalog bytes, definition-set digests, allowlist ordering/uniqueness/subset
integrity and generated plan coverage.
`payment-metric-supported-definitions.ts` is the closed definition-ID set.
`PaymentMetricDeclarativePlanCompiler.ts` additionally gates families, roots,
paths, selectors, measures, conditions, dimensions, elections, time and output
contracts; membership in the ID list alone is insufficient.

The activation allowlist does not live in a second Persist-authored list. It
remains `payment-financial-metrics.v2.json#/dev_activation_allowlist`; Persist
loads it from the attested catalog. `PaymentMetricMaterializationPlan.ts` uses
the selected IDs for supported plans, while
`payment-metric-prod-shadow-config.ts` pins the approved production release and
fails closed unless the loaded catalog's selection matches that compatibility
contract. These are read-only compatibility checks for Jirachi, not files to
modify during Model configuration.

Persist's runtime is a payment-family implementation, not a generic Base
Metrics interpreter. A catalog entry that fails any closed-set or compiler
check is not executable even if Lexicon and Model validly publish it.

## Classify support

Choose exactly one:

- `exact reuse` when every KPI intent field matches one immutable existing
  definition;
- `supported configuration/composition` when the proposal uses only existing
  supported definitions and the package plus pinned consumer explicitly support
  the selection or published-catalog reference;
- `new definition/family` when any semantic field or required consumer/compiler
  behavior is absent.

For the first two classifications, return the exact existing metric IDs and
show the evidence for each match. An unknown ID, family-only match, missing
consumer support or partial semantic match is `new definition/family`.

Ratios are a common new-definition case. A `PERCENT` unit does not define division,
numerator/denominator alignment or zero-denominator behavior. Do not approximate
a ratio with `AVERAGE`, and do not emit two component metrics while claiming the
requested KPI exists.

## Represent metric catalogs in Model

Current `prismteam-ai/model` Composition Contract v1 represents catalogs only
under `manifest.metricCatalogs[]`, using this discriminated union:

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

```json
{
  "catalogId": "payment-financial-metrics",
  "mode": "published",
  "contractVersion": "financial-metrics-catalog/v2",
  "artifactUri": "s3://immutable-release-prefix/payment-financial-metrics.v2.json",
  "digest": "sha256:<catalog-bytes-sha256>"
}
```

The generated variant tells Model to derive Base Metrics from the effective
package. `generatorSourceAlias` must resolve to a pinned `manifest.sources[]`
entry; its fields are `alias`, `repository`, `revision`, `path` and `digest`.
The contract supports this variant, but do not infer that every installed
shared-base release declares a catalog: inspect the selected release.

The published variant does not carry definitions. For the payment package,
resolve Lexicon's approved-release marker, verify its attestations against the
sibling catalog bytes, and use that immutable catalog object's URI and digest.
Do not put the mutable SSM URI, `approved-release.json`, or copied payment
definitions in `metricCatalogs`.

The complete Composition Contract JSON is the uploaded source artifact selected
by the change set's `composition.documentArtifactId`; `sourceDigest` equals that
artifact's digest. Model validation governs the composition and immutable
reference. Lexicon still owns the referenced definitions, and Model does not
gain payment semantic validation merely because it can publish the reference.

## Use the real generic Model lifecycle

Current Model main exposes generic operations in `contracts/openapi.yaml`:

- vocabulary, definition, release, composition and release-artifact reads;
- generic change-set submission and change-set read;
- presigned artifact upload creation;
- validation start, status and results;
- review submission and authorized review decision;
- publication start, status and reconciliation.

It does not expose KPI-specific routes, automatic graph inspection or a
metric-family-specific generator/validator. Specialized payment semantic
validation remains outside the generic API.

For exact reuse, prefer an existing immutable release that already includes the
required artifact. Read the release and artifacts or composition back and report
its release ID and release digest.

For supported configuration/composition that requires a release:

1. Build the exact Composition Contract v1 JSON artifact using the real package
   contract and run its validator/generator outside Model where that package
   requires it.
2. `POST /model/v1/accounts/{account_id}/change-sets` with an idempotency key,
   artifact manifest and `composition.documentArtifactId`; omit legacy
   `proposedRevisions` and set `sourceDigest` to the selected JSON artifact's
   digest.
3. Create the artifact upload, then upload the exact declared bytes.
4. Start validation, poll the validation run and fetch its results.
5. Submit review with the latest `ETag`, candidate digest and source digest;
   preserve the authorized decision prerequisite.
6. Start publication with the latest `ETag`, poll to completion, then read the
   immutable release and release artifacts/composition.
7. Compare release ID/digest, source digest, artifact digest and byte length
   before claiming publication complete.

Invoke these operations only when an executable API/tool adapter is present,
authenticated and authorized. When only this prompt/skill is present, return the
artifact and request bodies as a plan with `application: not applied`. Never
pretend that prose uploaded or published anything. Never replace the API with
direct canonical source, S3 or SSM edits.

## Apply source-of-truth precedence

Use this precedence without allowing a lower layer to redefine a higher one:

1. The pinned Lexicon source catalog owns metric semantics and its activation
   selection.
2. The generated Lexicon catalog and marker are valid publishable
   representations only when their manifests and digests attest that source.
3. The immutable Model release owns review/publication metadata and the exact
   catalog URI/digest reference; it does not own or override catalog definitions.
4. The pinned Persist closed set and compiler own executability. Activation
   additionally requires a catalog-backed allowlist ID that Persist supports.

When source and generated artifact differ, stop and regenerate through Lexicon;
never edit generated files. When Model metadata differs from the generated
artifact URI or digest, stop the Model proposal/publication and reconcile it
through the governed lifecycle. When Lexicon publishes a definition that Persist
does not support, the definition may remain governed but configuration,
activation and materialization stay unsupported. When an allowlist selects an
unknown or compiler-rejected ID, fail closed; activation metadata cannot create
semantic or runtime support.

## Fail closed for new definitions and families

Do not submit `new definition/family` through the generic Model lifecycle.
Identify the required Lexicon catalog source/type, package validator/generator
and deterministic generated release changes. Identify the required Persist
supported-definition list, family/plan compiler and runtime support. If Model
needs a specialized semantic validator, hand that implementation gap to Dialga;
hand Persist implementation to Conkeldurr.

Resume configuration only after all required capabilities exist at pinned
revisions. A generic published-catalog reference cannot make unsupported
semantics executable.

## Keep activation separate

Validation, review and publication govern definitions and artifacts. They do not
activate a metric, start a rebuild or prove materialization. Never perform
activation automatically. Record activation as pending unless it is separately
authorized, executed by the owning Persist workflow and verified with runtime
evidence.

## Acceptance cases

- Exact reuse: a KPI semantically identical to an existing operation returns its
  immutable definition identity and exact metric ID without a duplicate.
- Supported composition: existing supported IDs and a pinned published catalog
  URI/digest produce an exact artifact and generic Model request plan.
- Incomplete intent: missing grain, window or acceptance example produces
  discovery questions, not a guessed definition.
- Unknown ID: an ID absent from the catalog or Persist's supported-definition
  list fails before submission.
- New semantics: a family-only match, unsupported composite ratio, graph path or
  consumer capability returns `new definition/family` with Lexicon and Persist
  work, and no Model change set.
- Adapter boundary: without an executable adapter, the result says
  `application: not applied`.
- Recovery: unchanged requests use idempotent replay; timeout, interrupted
  publication and digest mismatch remain incomplete until reconciled/read back.
- Lifecycle: definition publication, activation and observed materialization are
  separate evidence states.
