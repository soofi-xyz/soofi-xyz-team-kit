---
name: configure-model-product
description: "Configure and test Model through its existing HTTP API: vocabulary lookup, candidate validation, governed changes, ruleset definitions, mapping registrations, metric definitions, Model-derived metric suggestions for KPIs and KPI configuration (including reviewed drafts of compiler-supported in-family metric variants) and versioned releases. Use Jirachi; route service gaps and new metric families to Dialga."
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

## Suggest Model-derived metrics for a KPI

When a user provides a KPI and says what they want to measure, read the
[KPI-to-metric configuration contract](reference/kpi-to-metric-configuration.md).
Jirachi suggests metric definitions derived from the governed Model itself, for
any business domain the Model describes. The payment metric catalog is one
existing example of the metric configuration shape and one existing family, not
the universe of suggestions. This workflow is for business outcomes and finance
measures, not platform-health telemetry.

Dialga owns the catalog architecture in
[the business and financial metric catalog contract](../build-lexicon-product/reference/business-financial-metric-catalogs.md).
Read that contract; do not redefine its source locations, schema, generated or
published shapes, precedence, or consumer boundary.

### 1. Elicit the KPI intent

Require the KPI name and business question, what to measure, grain/entity,
measure and aggregation, filters and exclusions, time semantics and reporting
window (business time/timezone when relevant), dimensions/grouping, output shape
and consumer, and concrete acceptance examples. Ask focused discovery questions
when any field is missing, ambiguous or contradictory. The KPI comes from the
user; do not infer filters, joins, event semantics, time windows or formulas
from labels and descriptions.

### 2. Read the governed Model vocabulary

Pin the account's governed release through the discovered Model API: resolve
`getRelease` with `release_id=current` to an immutable release ID/digest, then
read `listDefinitions`/`getDefinition` at that release, `getReleaseComposition`,
`getReleasePersistLexicon` and `listReleaseArtifacts`. Verify these operations in
`prismteam-ai/model` `contracts/openapi.yaml` at the pinned revision. Where the
Model does not yet hold the domain graph, read
`Spring-Oaks-Capital-LLC/lexicon:src/data/lexicon.json` (vertices, edges,
properties) at a pinned revision as the source. Record the source of every
element. Do not query a live graph to fill missing intent.

### 3. Map the KPI onto the graph and suggest ranked candidates

Map the KPI to an anchor entity and identifier, a traversal path across
relationships with direction and hop count, the measured property or count,
aggregation, business-time property, filter properties and enum values, and
grouping dimensions. Return a ranked list of candidate metric definitions
grounded only in elements that exist in the pinned Model release or Lexicon
schema. Give each its graph path, measure, aggregation, filters, dimensions,
grain, time semantics, assumptions, data-quality caveats and why it answers the
KPI; add leading/lagging or alternative formulations where useful. Never invent
entities, edges or properties; record missing data as a Model/vocabulary gap.

### 4. Express suggestions in the existing shape

Express each chosen suggestion as a `metrics[]` entry using the verified
structure of `Spring-Oaks-Capital-LLC/lexicon:src/data/financial-metrics/payment-financial-metrics.v2.json`
as the format template, for any domain. Fill its values from the graph mapping;
omit `materialization_plan`. If the shape cannot express part of the KPI, mark
that part as a Dialga gap instead of adding a field.

### 5. Classify reuse and executability per suggestion

Check each suggestion against existing catalogs, including the deployed marker
`/lexicon/financial-metrics-catalog-uri` and its attested sibling catalog bytes.
Choose exactly one classification:

1. `exact reuse` — every intent field matches an existing immutable definition;
2. `supported configuration/composition` — the KPI uses only existing supported
   definitions and the selected package/consumer explicitly supports the proposed
   selection or catalog reference without changing metric semantics;
3. `in-family variant draft` — no definition matches, but the KPI is a new
   filter value or dimension inside an existing family whose measure,
   business-time property, dimensions, conditions/enum values and elections the
   pinned Persist compiler already supports;
4. `new family/capability` — a valid governed definition proposal for a new
   family or measure, or one needing a formula, source/path, time behavior,
   grain, output, correction rule, condition, dimension or election the compiler
   does not already support.

A similar name, unit or graph path is not an exact match. Then state
executability per suggestion: today only families supported by Persist's
code-owned compiler
(`Spring-Oaks-Capital-LLC/persist:lambda/schemas/payment-metric-supported-definitions.ts`
and `lambda/services/PaymentMetricDeclarativePlanCompiler.ts`) can execute.
Mark others `governed proposal — needs Dialga for runtime/consumer support`.
Executability is reported, never used to narrow what Jirachi suggests.

### 6. Draft in-family variants as reviewed Lexicon source changes

For `in-family variant draft`, follow the drafting steps in the
[KPI-to-metric configuration contract](reference/kpi-to-metric-configuration.md#7-draft-in-family-metric-variants):
copy the exact shape of a same-family sibling in the pinned Lexicon catalog,
validate read-only that every Persist compiler gate already passes, and present
the entry as a draft through Lexicon's normal review and release flow. Never
edit S3/SSM directly, change the activation allowlist or activate. Persist's
closed ID set must add the new ID before that Lexicon release reaches a Persist
deployment; route that change through Dialga.

### 7. Hand new-family proposals to Dialga

For `new family/capability`, do not submit a Model change set. Hand Dialga the
Model-derived suggestion in the existing shape, its graph mapping, the pinned
evidence of the missing semantic, schema, validator, release or runtime
capability, and the expected acceptance behavior. Dialga owns Model
implementation, decides on new families and coordinates any required Lexicon or
Persist changes. Resume governed configuration only after those capabilities
exist at pinned revisions.

### 8. Apply only supported configuration

For `exact reuse`, first determine whether an already published immutable Model
release contains the required artifact; if so, return that release ID/digest and
read it back rather than creating a duplicate.

Model's Composition Contract requires at least one `definitions[]` entry, so a
metric catalog reference cannot be submitted alone; it rides on a full package
revision. Persist reads the catalog through Lexicon's
`/lexicon/financial-metrics-catalog-uri`, not from Model releases, so a Model
release is governance metadata today.

For supported configuration/composition that needs a release, use the generic
lifecycle in the discovered OpenAPI: submit a change set with an idempotency key,
declared artifact digest/length, `composition.documentArtifactId` and matching
`sourceDigest`; upload the exact bytes; validate and fetch results; record an
authorized review decision using the latest `ETag`; publish and poll; then read
back the immutable release and its artifacts or composition, comparing release,
source and artifact digests. If no executable adapter is available, return the
exact artifact and request sequence with `application: not applied`.

### 9. Resolve authority and separate publication from activation

Apply the precedence in the Dialga-owned catalog contract and fail closed when
any layer disagrees. A definition rejected by the pinned consumer is not an
executable configuration. Definition validation, review and publication do not
activate a metric. Never activate automatically. Never change an activation
allowlist, invoke a Persist activation/rebuild or claim materialization unless
the user separately authorizes that operation and its owner performs it. A
release is complete only after immutable read-back returns the expected release
ID and release digest and all source/artifact digests match.

Return the proposal format in the
[KPI-to-metric configuration contract](reference/kpi-to-metric-configuration.md#return),
with ranked suggestions, per-suggestion classification and executability, and
vocabulary gaps. Exercise a non-finance Model-derived suggestion set, exact
reuse, a materially different supported composition, an in-family variant
draft, a compiler-rejected variant, a missing vocabulary element, incomplete
intent, an unknown metric ID, unauthorized access, idempotent replay,
timeout/recovery and digest mismatch. Publication is not activation, and
activation is not observed materialization.

Keep Persist storage/validation execution with Conkeldurr/Uxie, Rule evaluation with Gallade/Meditite and Transform mapping execution with Kecleon/Silvally. Silvally authors concrete Transform configurations; Model owns shared definition validation and governed publication. Use Mew for vocabulary lookup/modeling advice without changing its retained specialist role.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
