# KPI to Model-derived metric suggestions

Use this workflow when a user gives a KPI and says what they want to measure.
Jirachi suggests metric definitions derived from the governed Model itself:
the release's vocabulary of entity/vertex types, relationships/edges and their
direction, properties with their types and enum values, identifiers and time
properties. Suggestions cover any business domain the Model describes, not only
payments. The existing payment metric catalog is one example of the metric
configuration shape and one family that already exists; it is not the
universe of suggestions.

Dialga owns the schema, artifact and runtime architecture in
[the business and financial metric catalog contract](../../build-lexicon-product/reference/business-financial-metric-catalogs.md).
Read that contract; do not redefine it or invent a new metric shape. Suggestions
reuse the existing shape exactly.

This workflow covers business outcomes and finance measures. Keep platform
telemetry outside it.

## 1. Elicit the KPI intent

Require:

- KPI name and business question;
- what to measure and the entity/grain being measured;
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
The KPI comes from the user; the Model supplies the elements that can measure it.
Do not infer a formula, filter, time rule or dimension from a name or
description. The normalized intent is an analysis record, not a Model request.

## 2. Read the governed Model vocabulary

Read the selected account's governed release through the discovered Model API.
The current `prismteam-ai/model` `contracts/openapi.yaml` exposes these read
operations under `/model/v1/accounts/{account_id}`:

```text
listVocabularies       GET /vocabularies
getVocabulary          GET /vocabularies/{vocabulary_id}
listReleases           GET /vocabularies/{vocabulary_id}/releases
getRelease             GET /vocabularies/{vocabulary_id}/releases/{release_id}   (release_id=current or an immutable ID)
getReleaseComposition  GET /vocabularies/{vocabulary_id}/releases/{release_id}/composition
getReleasePersistLexicon GET /vocabularies/{vocabulary_id}/releases/{release_id}/runtime/persist-lexicon
listReleaseArtifacts   GET /vocabularies/{vocabulary_id}/releases/{release_id}/artifacts
listDefinitions        GET /vocabularies/{vocabulary_id}/definitions?releaseId=
getDefinition          GET /vocabularies/{vocabulary_id}/definitions/{definition_id}?releaseId=
```

Verify these against the pinned revision before use; do not guess routes. Resolve
`release_id=current` to its immutable release ID and digest, then read every
definition at that pinned release. Vertex and relationship definitions give
entities, edges with `from`/`to` direction and cardinality, properties, types,
enums and indexes; the persist-lexicon runtime document gives the installed
`vertices`/`edges` with `required` lists.

When the governed Model release does not yet hold the needed domain graph, read
the Lexicon schema `Spring-Oaks-Capital-LLC/lexicon:src/data/lexicon.json` at a
pinned revision as the source: `vertices[].type`, `properties` (type, format,
enum, `required`, comments) and `edges[].type`, `from`, `to` and `properties`.
Record which source each element came from and its revision or release digest.

Model reads and source checkout are schema evidence. Do not query or mutate a
live graph to fill missing intent or to measure data.

## 3. Map the KPI onto the graph

For each plausible reading of the KPI, record:

- anchor entity (the vertex the KPI is about) and its identifier property;
- traversal path from the anchor or scope entity to the measured element:
  each relationship, its direction and the hop count;
- measured element: a vertex or edge count, or a typed property;
- aggregation (count, distinct count, sum, average, ratio, latest state);
- unique item that deduplicates contributions;
- business-time property, distinguishing business time (for example an
  `effective_at` or scheduled date) from insert time (`created_at`);
- filter properties and the exact enum values they test;
- grouping dimensions and the properties that supply them.

Use only elements present in the pinned Model release or Lexicon schema. Never
invent entities, edges, properties, enum values or directions. If the KPI needs
an element that does not exist, record it as a Model/vocabulary gap and route
the vocabulary change through Model's governed changes (Mew can advise on
modeling).

## 4. Suggest ranked candidate metric definitions

Return a ranked list of candidate metric definitions grounded only in elements
that exist in the pinned Model release or Lexicon schema. For each suggestion give:

- graph path with relationship direction and hop count;
- measure and aggregation;
- filters with exact enum values;
- dimensions;
- grain and reporting window;
- time semantics: business-time property, timezone and event-flow or
  latest-state behavior;
- assumptions still to confirm with the user;
- data-quality caveats visible in the schema: optional properties, properties
  only present when derivable, insert time used as a fallback for business time,
  enum values that are ambiguous for the KPI;
- why it answers the KPI and why it ranks where it does.

Include leading/lagging or alternative formulations where useful, such as an
activity count that leads an outcome rate, or a numerator and denominator
offered as separate counts. Rank by fidelity to the KPI intent first, then by
data quality, then by reuse of existing definitions.

## 5. Express each chosen suggestion in the existing shape

Use the verified `metrics[]` entry structure from
`Spring-Oaks-Capital-LLC/lexicon:src/data/financial-metrics/payment-financial-metrics.v2.json`
as the format template for any domain. Read an entry at the pinned revision and
reuse its exact keys and value shapes: `metric_id`, `business_name`,
`definition_version`, `catalog_contract_version`, `family_id`, `category`,
`report_category`, `root`, `graph_source`, `path`, `path_hops`, `scope_paths`,
`unique_item`, `contribution_identity`, `measure`, `calculation`, `unit`,
`dimensions`, `qualifying_conditions`, `time_behavior`, `date_used`,
`business_time_property`, `business_timezone`, `scopes`, `grains`,
`triggering_vertices`, `triggering_edges`, `contribution_rule`,
`correction_rule`, `output_cell_type`, `output_value_type`, `coverage_mode`,
`scope_edge_types`, `period_edge_type` and `period_vertex_type`, plus
`latest_state_election` or `business_time_election` when a latest-state or
business-time election applies. Verify the key list against the pinned file
rather than this list.

Fill every value from the mapping in step 3: `path_hops` and `scope_paths` carry
the real edge types and directions; `graph_source`, `measure`,
`unique_item`, `business_time_property` and condition properties name real
vocabulary elements. Use `definition_version: 1` for a new ID and omit
`materialization_plan`; Lexicon's generator builds it. Keep literal values the
pinned types fix (`scopes`, `grains`, contract version). If the shape cannot
express part of the KPI, say so and mark that part as a Dialga gap rather than
adding a field.

## 6. Classify against existing catalogs and executability

For each suggestion, choose exactly one:

1. `exact reuse` — every intent field matches an existing immutable definition;
2. `supported configuration/composition` — existing definitions and the pinned
   consumer explicitly support the requested selection or catalog reference;
3. `in-family variant draft` — no definition matches, but the KPI is a new
   filter value or dimension inside an existing family whose measure,
   business-time property, dimensions, conditions/enum values and elections the
   pinned Persist compiler already supports;
4. `new family/capability` — a valid governed definition proposal whose family,
   measure or semantics no existing family covers, or that needs a schema,
   validator, Model runtime or compiler capability that is absent.

A similar name, unit, family or path is not an exact match. Return exact existing
metric IDs for the first two classes and the drafted ID for the third. Unknown
IDs, partial semantic matches that are not a compiler-supported in-family
variant, and compiler rejection are `new family/capability`.

Then state executability per suggestion. Today only families supported by
Persist's code-owned compiler can execute:

```text
Spring-Oaks-Capital-LLC/persist
  lambda/schemas/payment-metric-supported-definitions.ts
  lambda/services/PaymentMetricDeclarativePlanCompiler.ts
```

Mark each suggestion `executable today` only when the pinned compiler supports
its family and gates (and, for a new ID, after the closed set adds it);
otherwise mark it `governed proposal — needs Dialga for runtime/consumer
support`. Executability is reported per suggestion; it never limits what
Jirachi suggests.

Resolve the deployed catalog marker `/lexicon/financial-metrics-catalog-uri`,
verify its attested sibling catalog bytes and retain the immutable catalog
URI/digest when matching. Recompute revision-specific counts and digests when
needed; never use observed values as durable contracts.

## 7. Draft in-family metric variants

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

## 8. Hand new-family proposals to Dialga

For `new family/capability`, stop before Model submission. Return the
Model-derived suggestion in the existing shape, its graph mapping, the
normalized intent, pinned evidence and the missing capability to Dialga. Dialga
owns the architecture and Model implementation, decides whether to adopt the
family, and coordinates any needed Lexicon or Persist work. Jirachi does not
define a replacement schema, artifact layout, compiler rule or activation path.

## 9. Apply only supported configuration

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

## 10. Fail closed and verify release state

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

## Worked examples

Verify every element below at your pinned revision before reuse; they illustrate
the method, not durable constants.

### Non-finance: outbound right-party contact rate

Intent: "Of the outbound call attempts we make on represented debts each month,
what share reach the right party, by representing company type?" Consumer: a
monthly operations report. Elements read from the Lexicon schema:

```text
vertex debt            debt_identifier
vertex phone_call      interaction_identifier (required), direction enum INBOUND|OUTBOUND (optional; present when derivable)
edge company_represents_debt  company -> debt            company_type enum, status enum ACTIVE|DELETED, effective_at
edge debt_has_phone_call      debt -> phone_call         created_at
edge phone_call_status_changed     phone_call -> phone_call   status enum incl. ATTEMPTED|ANSWERED|NO_ANSWER, duration (optional), effective_at
edge phone_call_contact_identified phone_call -> phone_call   phone_contact_type enum incl. RIGHT_PARTY, effective_at
```

Ranked suggestions:

1. Right-party contacts (numerator) — path `company -[company_represents_debt]->
   debt -[debt_has_phone_call]-> phone_call` (two hops), count of distinct
   `phone_call.interaction_identifier` with `direction = OUTBOUND` and latest
   `phone_call_contact_identified.phone_contact_type = RIGHT_PARTY`; business
   time `phone_call_contact_identified.effective_at`; dimension
   `company_represents_debt.company_type`; grain MONTH. Lagging outcome.
2. Outbound attempts (denominator and leading activity) — same path and filter,
   counting distinct outbound calls; business time the earliest
   `phone_call_status_changed.effective_at`. The rate is suggestion 1 over
   suggestion 2, aligned on the attempt month; confirm zero-denominator handling.
3. Alternative: answered outbound calls via latest
   `phone_call_status_changed.status = ANSWERED`, plus average `duration` of
   answered calls as a quality signal.

Caveats: `direction` is optional, so the filter drops calls without it; calls
with no `phone_call_contact_identified` edge count as not right-party; the
phone_call vertex has no time property of its own, and `debt_has_phone_call.created_at`
is insert time, not business time. Expressed in the catalog shape, each becomes
a `metrics[]` entry with `root: "phone_call"`, `graph_source:
"vertex:phone_call"`, real `path_hops`/`scope_paths` and string-equality
`qualifying_conditions`. Classification: `new family/capability` — no catalog
family covers phone_call, and Persist's compiler supports only payment
families. Executability: `governed proposal — needs Dialga for runtime/consumer
support`.

### Finance: payment plan installments scheduled per debt

Intent: "How many payment plan installments are scheduled for each debt per
month?" Path `debt -[debt_has_payment_plan]-> payment_plan
-[payment_plan_has_installment]-> payment_plan_installment` (two hops), COUNT of
`payment_plan_installment.payment_schedule_identifier`, business time
`payment_plan_installment_status_changed.scheduled_payment_date`, scope DEBT,
grain MONTH. Classification: `exact reuse` of `payment_plan_installment.count`
in family `base.vertex.payment_plan_installment`. Executability: `executable
today`, because the pinned compiler supports that family. A filter on a
supported enum within the same family would instead be an `in-family variant
draft`.

## Return

```text
KPI name / business question:
What to measure / grain/entity:
Measure / aggregation:
Filters / exclusions:
Time / window / timezone:
Dimensions / grouping:
Output / consumer:
Acceptance examples:
Vocabulary source (Model release ID/digest or Lexicon revision):
Ranked suggestions (per suggestion):
  Graph path / hops / direction:
  Measure / aggregation / filters / dimensions / grain / time semantics:
  Assumptions / data-quality caveats / why it answers the KPI:
  Metric configuration entry (existing shape):
  Classification: exact reuse | supported configuration/composition | in-family variant draft | new family/capability
  Exact existing or drafted metric ID:
  Executability: executable today | governed proposal — needs Dialga for runtime/consumer support
  Compiler-gate results (drafts):
Model/vocabulary gaps:
Configuration artifact / generic Model request plan / Lexicon draft entry:
Application: applied | not applied
Validation / review / publication:
Release ID / release digest / read-back:
Activation: pending unless separately authorized
Gaps / owner:
```

Exercise a Model-derived suggestion set for a non-finance KPI, exact reuse, a
materially different supported composition, an in-family variant draft, a
compiler-rejected variant, a KPI needing a missing vocabulary element, incomplete
intent, unknown IDs, unauthorized input, idempotent replay, timeout/recovery and
digest mismatch. Keep request acceptance, workflow completion, publication,
activation and observed materialization as separate evidence states.
