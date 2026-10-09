# Business and finance KPI configuration

Use this workflow to turn user intent into a supported Model configuration.
Dialga owns the schema, artifact and runtime architecture in
[the business and financial metric catalog contract](../../build-lexicon-product/reference/business-financial-metric-catalogs.md).
Read that contract; do not redefine it or invent a new metric shape.

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
3. `new definition/family` — any semantic, schema, validator, Model runtime or
   consumer capability is absent.

A similar name, unit, family or path is not an exact match. Return exact existing
metric IDs for the first two classes. Unknown IDs, partial semantic matches and
consumer rejection are `new definition/family`.

For `new definition/family`, stop before Model submission. Return the normalized
intent, pinned evidence and missing capability to Dialga. Dialga owns the
architecture and Model implementation and coordinates any needed Lexicon or
Persist work. Jirachi does not define a replacement schema, family, artifact
layout, compiler rule or activation path.

## Apply only supported configuration

For `exact reuse`, prefer an immutable release that already contains the required
catalog reference. Read it back and return its release ID/digest instead of
creating a duplicate.

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
intent, unknown IDs, unauthorized input, idempotent replay, timeout/recovery and
digest mismatch. Keep request acceptance, workflow completion, publication,
activation and observed materialization as separate evidence states.
