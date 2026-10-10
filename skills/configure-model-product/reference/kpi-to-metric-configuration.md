# Business and finance KPI configuration

Use this workflow to turn user intent into a supported Model configuration or a
reviewed draft of a compiler-supported in-family metric variant.
Dialga owns the schema, artifact and runtime architecture in
[the business and financial metric catalog contract](../../build-lexicon-product/reference/business-financial-metric-catalogs.md).
Read that contract; do not redefine it or invent a new metric shape. Drafts copy
the existing shape exactly.

This workflow covers business outcomes and finance measures. Keep platform
telemetry outside it.

## Complete the KPI intent

Require:

- KPI name and business question;
- grain/entity;
- measure and aggregation;
- filters, inclusions and exclusions;
- time semantics, reporting window and business timezone when relevant;
- dimensions/grouping;
- output shape and consuming report, API or decision process;
- acceptance examples with sample inputs and expected values.

For ratios, also require numerator and denominator populations, alignment and
zero-denominator behavior. For events, require event identity, business time,
deduplication, late-arrival and correction behavior.

Ask focused discovery questions for missing, ambiguous or contradictory fields.
Do not infer a formula, filter, path, time rule or dimension from a name or
description. The normalized intent is an analysis record, not a Model request.

## Read and verify existing contracts

Pin source and consumer revisions and the selected release identity/digests.
Use these current locations only to read and verify the Dialga-owned contract:

```text
Spring-Oaks-Capital-LLC/lexicon
  src/data/financial-metrics/payment-financial-metrics.v2.json
  src/data/lexicon.json
  scripts/lib/financial-metrics/types.ts

deployed Lexicon discovery
  /lexicon/financial-metrics-catalog-uri

Spring-Oaks-Capital-LLC/persist
  lambda/schemas/payment-metric-supported-definitions.ts
  lambda/services/PaymentMetricDeclarativePlanCompiler.ts
```

Resolve the Lexicon marker, verify its attested sibling catalog bytes and retain
the immutable catalog URI/digest. Read the pinned Persist closed set and compiler
before calling a definition executable. Recompute revision-specific counts and
digests when needed; never use observed values as durable contracts.

Model's generic definition, release, composition and artifact reads may provide
governed evidence. Source inspection and live graph traversal are not Model API
operations. Do not query or mutate a graph to fill missing intent.

## Classify the request

Choose exactly one:

1. `exact reuse` — every intent field matches an existing immutable definition;
2. `supported configuration/composition` — existing definitions and the pinned
   consumer explicitly support the requested selection or catalog reference;
3. `in-family variant draft` — no definition matches, but the KPI is a new
   filter value or dimension inside an existing family whose measure,
   business-time property, dimensions, conditions/enum values and elections the
   pinned Persist compiler already supports;
4. `new family/capability` — a new family or measure, or any semantic, schema,
   validator, Model runtime or compiler capability is absent.

A similar name, unit, family or path is not an exact match. Return exact existing
metric IDs for the first two classes and the drafted ID for the third. Unknown
IDs, partial semantic matches that are not a compiler-supported in-family
variant, and compiler rejection are `new family/capability`.

For `new family/capability`, stop before Model submission. Return the normalized
intent, pinned evidence and missing capability to Dialga. Dialga owns the
architecture and Model implementation and coordinates any needed Lexicon or
Persist work. Jirachi does not define a replacement schema, family, artifact
layout, compiler rule or activation path.

## Draft in-family metric variants

Draft an `in-family variant draft` as a reviewed Lexicon source change, never as a
Model request or direct S3/SSM edit:

1. Select the closest existing sibling with the same `family_id` in the pinned
   catalog. Copy its exact keys and value shapes; do not add, drop or rename
   fields. Change only the variant: `metric_id` (keeping the family's metric-id
   prefix), `business_name`, `contribution_identity`, `qualifying_conditions`,
   `dimensions` and, when the variant changes calculation, the matching
   `calculation`, `unit`, `output_value_type` and `contribution_rule`. Use
   `definition_version: 1` for a new ID. Omit `materialization_plan`;
   Lexicon's `npm run generate:financial-metrics-materialization` builds it
   along with the definition-set digests and family matrix.
2. Validate read-only against the pinned
   `PaymentMetricDeclarativePlanCompiler.ts` before presenting the draft:
   family is in the supported family set, root/graph source/path hops match the
   family contract, `metric_id` starts with the family's prefix, `measure` and
   `unique_item` are supported expressions, `business_time_property` is
   supported and equals `date_used`, each dimension is a known selector with
   exactly one matching string-equality condition, every condition property,
   exists-edge and enum value is in the compiler's supported sets, and any
   `latest_state_election` or `business_time_election` equals the family's
   supported strategy. Record each gate result. Any failure is
   `new family/capability`.
3. Name the companion source changes the reviewer must make with it:
   regenerate with the Lexicon generator and its `--check`, and update the
   hand-maintained pins (`counts`, `package.definition_count`,
   `source_metadata.report.expected_metric_count`, and the count, digest and
   family-count constants in `scripts/lib/financial-metrics/catalog.ts` and
   `materialization.ts`). Do not hand-compute digests.
4. State the consumer prerequisite. Persist compiles every catalog definition
   and also requires each `metric_id` to be in the closed set in
   `payment-metric-supported-definitions.ts`; one unknown ID fails the whole
   catalog load. Route that closed-set addition through Dialga, and sequence it
   so Persist accepts the new ID before the Lexicon release reaches a Persist
   deployment.
5. Keep `dev_activation_allowlist` unchanged. Do not activate, open the source
   change against a protected branch without review, or publish a release.

A different reporting window is not a new entry: `grains` and `scopes` are fixed
literals in the pinned types, and the window is chosen when reading materialized
cells. A new grain, rolling window or time behavior is `new family/capability`.

## Apply only supported configuration

For `exact reuse`, prefer an immutable release that already contains the required
catalog reference. Read it back and return its release ID/digest instead of
creating a duplicate.

Model's Composition Contract document requires at least one `definitions[]`
entry (`compositionContractDocumentSchema` in `prismteam-ai/model`
`src/domain/schemas.ts`). A metric catalog reference therefore cannot be
submitted alone; it rides on a full package revision that carries the package's
definitions alongside `manifest.metricCatalogs[]`.

Persist reads the catalog through Lexicon's `/lexicon/financial-metrics-catalog-uri`
parameter, resolved when Persist deploys, not from Model releases. Today a Model
release referencing the catalog is governance metadata: it records the reviewed
immutable URI/digest but does not change what Persist loads or activates.

For supported configuration requiring a release, use only operations present in
the discovered Model OpenAPI:

1. prepare the exact Composition Contract artifact using the Dialga-owned
   catalog representation;
2. submit a change set with an idempotency key, declared artifact digest/length,
   `composition.documentArtifactId` and matching `sourceDigest`;
3. upload the exact bytes through the returned upload operation;
4. start validation, poll status and fetch results;
5. submit review and an authorized decision using the latest concurrency token;
6. start publication and poll or reconcile its run;
7. read the immutable release, composition and artifacts back.

If no executable API or tool adapter is available, return the exact artifact and
request sequence with `application: not applied`. Prompts do not upload or
publish artifacts, and direct source/S3/SSM writes do not replace the lifecycle.

## Fail closed and verify release state

Apply the precedence defined by Dialga. Stop on a source, generated artifact,
Model URI/digest or Persist compatibility mismatch; do not invent a lower-layer
override.

An unchanged request uses idempotent replay. A timeout, interrupted publication
or digest mismatch remains incomplete until status and immutable read-back prove
the result. Preserve review and decision prerequisites.

Claim publication complete only after comparing:

```text
release ID and release digest
composition/source digest
catalog artifact URI, byte length and digest
the verified Lexicon marker and sibling catalog
```

Publication does not activate a metric or prove materialization. Never activate
automatically. Record activation and observed output as pending unless separately
authorized and evidenced through the owning consumer.

## Return

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
Classification: exact reuse | supported configuration/composition | in-family variant draft | new family/capability
Exact existing or drafted metric IDs:
Consumer/compiler compatibility (per-gate results for drafts):
Configuration artifact / generic Model request plan / Lexicon draft entry:
Application: applied | not applied
Validation / review / publication:
Release ID / release digest / read-back:
Activation: pending unless separately authorized
Gaps / owner:
```

Exercise exact reuse, a materially different supported composition, an
in-family variant draft, a compiler-rejected variant, incomplete intent, unknown IDs, unauthorized input, idempotent replay, timeout/recovery and
digest mismatch. Keep request acceptance, workflow completion, publication,
activation and observed materialization as separate evidence states.
