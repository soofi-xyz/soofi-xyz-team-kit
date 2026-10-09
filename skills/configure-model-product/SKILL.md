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

Dialga owns the catalog architecture in
[the business and financial metric catalog contract](../build-lexicon-product/reference/business-financial-metric-catalogs.md).
Read that contract; do not redefine its source locations, schema, generated or
published shapes, precedence, or consumer boundary.

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

Pin repository revisions and release IDs/digests. Read the Dialga-owned contract,
then inspect the current locations needed for matching and verification:

- `Spring-Oaks-Capital-LLC/lexicon:src/data/financial-metrics/payment-financial-metrics.v2.json`;
- `/lexicon/financial-metrics-catalog-uri` and the marker's sibling catalog
  bytes;
- `Spring-Oaks-Capital-LLC/persist:lambda/schemas/payment-metric-supported-definitions.ts`;
- `Spring-Oaks-Capital-LLC/persist:lambda/services/PaymentMetricDeclarativePlanCompiler.ts`.

Use Model's generic definition, release, composition and artifact reads when
available. Source checkout is read-only evidence, not Model API behavior. Do not
query a live graph to fill missing intent, invent a normalized payload, or infer
runtime support from catalog presence. Recompute any counts and digests from the
pinned revision; never use observed values as contract constants.

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
artifact and a request plan grounded in the discovered OpenAPI and Dialga-owned
catalog contract:

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

If an executable Model API/tool adapter is available and authorized, invoke it.
If this prompt/skill is the only available surface, return the exact artifact,
request bodies and sequence with `application: not applied`. Instructions alone
do not add an adapter, upload artifacts or publish a release.

### 5. Fail closed for new semantics

For `new definition/family`, do not submit a Model change set. Identify:

- the missing semantic, schema, validator, release or runtime capability;
- the pinned evidence that demonstrates the gap;
- the expected acceptance behavior.

Hand the product gap to Dialga. Dialga owns Model implementation and coordinates
any required Lexicon or Persist changes with their owners. Resume governed
configuration only after those capabilities exist at pinned revisions.

### 6. Resolve authority and disagreement

Apply the precedence in the Dialga-owned catalog contract and fail closed when
any layer disagrees. Do not resolve a mismatch by redefining the source,
generated artifact, Model reference or consumer contract. A definition rejected
by the pinned consumer is not an executable configuration.

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
