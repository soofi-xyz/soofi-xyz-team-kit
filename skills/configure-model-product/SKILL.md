---
name: configure-model-product
description: "Configure and test Model through its existing HTTP API. Use Jirachi to match user-provided business and finance KPIs to supported definitions and to govern vocabulary, candidate, artifact and release changes; route service gaps to Dialga."
---

# Configure Model

Use `jirachi`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Model capability map](../guide-product-work/reference/iterations/model.md).
Read the relevant [product contract](../build-lexicon-product/reference/PRD.md) and
[synthetic test data](../build-lexicon-product/reference/test-data.md).

1. Discover the existing service/revision, supported API, authentication and
   resource authorization, selected AWS profile, account and region. Separate
   required, implemented and observed capabilities. Do not guess route names.
2. Select the requested feature pieces and dependencies. Explain each with a
   synthetic fixture. Use a baseline, materially different supported configuration,
   invalid/unauthorized input and relevant replay/recovery cases inside each piece;
   use four as a full walkthrough floor, not a fixed count or a quota for narrow work.
3. Use only operations present in the discovered Model OpenAPI. Current Model
   supports generic vocabulary/definition/release reads, change-set submission,
   artifact upload, validation, review decisions, publication and immutable
   release/artifact read-back. It does not thereby provide KPI-specific endpoints,
   live graph inspection or automatic KPI/configuration generation.
4. Use the deployment's verified test adapters for external effects. If it lacks
   a safe test mode or required capability, leave that check pending and hand a
   redacted reproducer to `dialga`. Do not edit service code, write internal storage,
   or silently fall back to direct AWS mutations to pass a configuration check.
5. Give the user one copyable API invocation, expected result and at most three
   steps to inspect its actual AWS logs/workflow. Have them run the baseline and
   variant, read back results and return redacted IDs and observations. Wait for
   that evidence before advancing; request acceptance is not async completion.
6. Keep secrets in the approved local credential channel. Verify live effects
   are covered by the requested scope and record cleanup without removing shared
   resources. Keep mocked execution distinct from actual dependency readiness.

## Configure a business or finance KPI

When a user provides a KPI, read the
[KPI-to-metric configuration contract](reference/kpi-to-metric-configuration.md).
This workflow is for business outcomes and finance measures, not platform-health
telemetry. It handles incomplete requests through discovery questions; it does
not manufacture a KPI from schema fields.

### 1. Complete the KPI intent contract

Require all of:

- KPI name and business question;
- grain/entity being measured;
- measure and aggregation;
- filters, inclusions and exclusions;
- time semantics and reporting window, including business time/timezone when relevant;
- dimensions/grouping;
- output shape and consuming report, API or decision process;
- concrete acceptance examples with expected values.

Ask focused questions when any field is missing, ambiguous or contradictory.
Record assumptions as unresolved; do not infer filters, joins, event semantics,
time windows or formulas from labels and descriptions.

### 2. Gather read-only evidence

Pin repository revisions and release IDs/digests. For payment financial metrics,
inspect these canonical contracts:

- Lexicon semantic source:
  `src/data/financial-metrics/payment-financial-metrics.v2.json`;
- Lexicon type, validation and release contracts:
  `scripts/lib/financial-metrics/{types,catalog,release}.ts`;
- generated release:
  `.generated/financial-metrics-catalog/releases/<lexicon_version_id>/`,
  containing `payment-financial-metrics.v2.json`, `approved-release.json`,
  `build.json` and `manifest.json`;
- discovery marker: `/lexicon/financial-metrics-catalog-uri`, which resolves
  the immutable generated release's `approved-release.json`;
- Persist closed set and compiler:
  `lambda/schemas/payment-metric-supported-definitions.ts` and
  `lambda/services/PaymentMetricDeclarativePlanCompiler.ts`;
- Persist decoder/integrity checks:
  `lambda/schemas/payment-metric-catalog.ts` and
  `lambda/services/PaymentMetricCatalogService.ts`;
- Persist production release/activation compatibility pin:
  `lambda/payment-metric-prod-shadow-config.ts`.

Also inspect `src/data/lexicon.json` as read-only Lexicon schema evidence for
the property types and directed relationships named by the catalog.

The Lexicon source's top-level `dev_activation_allowlist` is the authored
activation selection. Persist reads and validates that selection; it does not
own a second semantic allowlist.

Read the actual shape rather than inventing a normalized metric payload:

- package/catalog identity: `schema_version`, `package.package_id`,
  `package.package_version`, `package.release_id`, `package.status`,
  `package.definition_set_digest`, `contract_versions` and `release_state`;
- definition identity and graph grain: `metrics[].metric_id`, `business_name`,
  `definition_version`, `catalog_contract_version`, `family_id`, `category`,
  `root`, `graph_source`, `path`, `path_hops`, `scope_paths`, `scopes` and
  `grains`;
- measure and aggregation: `unique_item`, `contribution_identity`, `measure`,
  `calculation`, `unit`, `contribution_rule` and `correction_rule`;
- filters, dimensions and time: `qualifying_conditions`, `dimensions`,
  `time_behavior`, optional elections, `date_used`, `business_time_property`,
  `business_timezone`, `coverage_mode` and optional `coverage_start_date`;
- source/runtime dependencies: top-level `source_metadata`, plus each
  definition's `triggering_vertices`, `triggering_edges` and
  `materialization_plan`;
- output: `output_cell_type`, `output_value_type`, `scope_edge_types`,
  `period_vertex_type` and `period_edge_type`;
- activation: top-level `dev_activation_allowlist.{profile,mode,metric_ids}`,
  never a per-definition flag.

A request-specific reporting start/end window, consuming report/API, acceptance
examples and review decision are represented outside this catalog. Source
references do not imply runtime support. Recompute counts from the selected
revision when useful and label them observed examples, never contract constants.

Evidence may come from checked-out source artifacts or from Model's generic
definition, release, composition and artifact reads. Do not claim that source
inspection, Neptune queries or graph traversal are Model API operations.
A catalog definition proves definition availability, not activation or
materialization.

### 3. Classify before proposing writes

Choose exactly one classification:

1. `exact reuse` — every intent field matches an existing immutable definition;
2. `supported configuration/composition` — the KPI uses only existing supported
   definitions and the selected package/consumer explicitly supports the proposed
   selection or catalog reference without changing metric semantics;
3. `new definition/family` — any formula, source/path, filter, time behavior,
   grain, dimension, output, correction rule or family is not already supported.

A similar name, unit or graph path is not an exact match. Return the exact metric
IDs for the first two classifications. Unknown IDs, a partial semantic match and
an unsupported consumer are `new definition/family`, not best-effort
configuration.

### 4. Plan or apply the generic Model lifecycle

For `exact reuse`, first determine whether an already published immutable Model
release contains the required artifact; if so, return that release ID/digest and
read it back rather than creating a duplicate.

For supported configuration/composition that needs a release, prepare the exact
artifact and a request plan grounded in the discovered OpenAPI:

1. submit a generic change set with an idempotency key and declared artifact
   digest/length; for Composition Contract v1, select that JSON artifact with
   `composition.documentArtifactId`, omit legacy proposed revisions and make
   `sourceDigest` equal the selected artifact digest;
2. obtain the artifact upload URL and upload the exact bytes;
3. start validation, poll status and retrieve validation results;
4. submit review and record an authorized decision using the latest `ETag`,
   candidate digest and source digest;
5. start publication and poll the publication run;
6. read the immutable release and its artifacts or composition back, comparing
   release, source and artifact digests.

Model's generic metric-catalog composition contract may pin a generated
base catalog or an immutable published catalog. The exact
`manifest.metricCatalogs[]` variants are:

```text
generated: catalogId, mode="generated",
contractVersion="base-metrics-catalog/v1", generatorSourceAlias,
input="package", maximumPathHops

published: catalogId, mode="published", contractVersion, artifactUri, digest
```

Use `generated` only when Model must generate Base Metrics from the effective
package and the named source alias is pinned in `manifest.sources`. For the
Lexicon payment catalog, verify the generated release marker and catalog bytes,
then put the immutable catalog artifact URI and its `sha256:` digest in the
`published` variant. The Model change-set request references the uploaded
Composition Contract document through `composition.documentArtifactId`; payment
definitions remain in the Lexicon artifact, not Model request bodies.

Model validates this generic reference contract, not payment-family semantics.
Run Lexicon's real validator/generator before submission and keep Persist
compatibility as separate evidence.

If an executable Model API/tool adapter is available and authorized, invoke it.
If this prompt/skill is the only available surface, return the exact artifact,
request bodies and sequence with `application: not applied`. Instructions alone
do not add an adapter, upload artifacts or publish a release.

### 5. Fail closed for new semantics

For `new definition/family`, do not submit a Model change set. Identify:

- Lexicon catalog source/type changes;
- the family validator/generator and deterministic generated-release changes;
- updated approved package/release evidence;
- Persist supported-definition, family/plan compiler and runtime support;
- any Model specialized semantic validator that is actually required.

Hand Model implementation work to Dialga and Persist implementation work to
Conkeldurr. Resume governed configuration only after those capabilities exist at
pinned revisions.

### 6. Resolve authority and disagreement

Apply this precedence:

1. pinned Lexicon source owns metric semantics and the activation selection;
2. its generated release is the digest-attested publishable representation;
3. a reviewed Model release governs the immutable catalog reference, not the
   catalog's definitions;
4. pinned Persist code decides whether a definition is executable.

Fail closed when layers disagree. A generated artifact that does not attest the
selected Lexicon source must be regenerated through Lexicon. A Model URI/digest
that does not match the generated catalog cannot be proposed or published. A
Lexicon definition absent from Persist's closed set or rejected by its compiler
may remain a valid published definition, but is not an executable configuration.
The activation allowlist can select only catalog-backed, Persist-supported
definitions; it cannot override either semantic or compiler compatibility.

### 7. Separate publication from activation

Definition validation, review and publication do not activate a metric. Never
activate automatically. Never change an activation allowlist, invoke a Persist
activation/rebuild or claim
materialization unless the user separately authorizes that operation and its
owner performs it. A release is complete only after immutable read-back returns
the expected release ID and release digest and all source/artifact digests match.

Return this proposal:

```text
KPI name / business question:
Grain/entity:
Measure / aggregation:
Filters / exclusions:
Time / window / timezone:
Dimensions / grouping:
Output / consumer:
Acceptance examples:
Evidence revisions / release digests:
Classification: exact reuse | supported configuration/composition | new definition/family
Exact existing metric IDs:
Consumer/compiler compatibility:
Configuration artifact / generic Model request plan:
Application: applied | not applied
Validation / review / publication:
Release ID / release digest / read-back:
Activation: pending unless separately authorized
Gaps / owner:
```

Exercise exact reuse, a materially different supported composition, incomplete
intent, an unknown metric ID, an unsupported formula/family, unauthorized access,
idempotent replay, timeout/recovery and digest mismatch. Publication is not
activation, and activation is not observed materialization.

Keep Persist storage/validation execution with Conkeldurr/Uxie, Rule evaluation with Gallade/Meditite and Transform mapping execution with Kecleon/Silvally. Silvally authors concrete Transform configurations; Model owns shared definition validation and governed publication. Use Mew for vocabulary lookup/modeling advice without changing its retained specialist role.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
