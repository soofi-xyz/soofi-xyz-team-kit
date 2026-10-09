# Business and finance KPI configuration

Map a user-provided KPI to existing governed metric definitions and use only the
generic lifecycle exposed by the selected Model OpenAPI. This contract does not
add KPI endpoints, graph inspection, generators or API adapters. Base Metrics
describes generic graph families, while each executable family owns its exact
authoring and runtime contract.

## Discover the selected revisions

Inspect the target Lexicon revision:

- `src/data/lexicon.json`
- `src/types/base-metrics-catalog.ts`
- `scripts/lib/base-metrics/catalog.ts`
- `scripts/lib/base-metrics/release.ts`
- `.generated/base-metrics-catalog/releases/<version>/`
- executable packages under `src/data/`, including `financial-metrics/`
- each package's types, validator, generator, release builder and fixtures
- `/lexicon/base-metrics-catalog-uri`
- each executable package's discovery parameter
- `/lexicon/release-uri`

Inspect the actual consumer revision separately. For Persist, search for the
catalog schema, supported-definition list, approved-release loader, plan
compiler, projection writer, rebuild workflow, incremental materializer,
activation state and end-to-end tests. A published Lexicon family is not proof
that Persist executes it.

Record the source revisions, release IDs, contract versions, artifact paths,
byte lengths and SHA-256 digests used for the proposal.

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

At the currently observed Lexicon revision,
`payment-financial-metrics.v2.json` is release
`lexicon.payment-financial-metrics@2.1.0` with 92 definitions. Its separate
`dev_activation_allowlist.metric_ids` contains 30 IDs. Reverify both counts and
the definition-set digest at the selected revision.

The current Persist payment runtime accepts the approved v2 financial release,
strictly decodes the generated plan, cross-checks compatibility fields and
materializes the closed code-owned payment definition set through shadow rebuild,
reconciliation and activation. Its
`lambda/schemas/payment-metric-supported-definitions.ts` list contains 92 IDs,
and `PaymentMetricDeclarativePlanCompiler` rejects any other metric ID. This is
payment-family support, not a generic Base Metrics interpreter. The 30-ID
activation allowlist is a separate release-owned selection, not permission for
this workflow to activate or rewrite it.

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

## Use the real generic Model lifecycle

Current Model main exposes generic operations in `contracts/openapi.yaml`:

- vocabulary, definition, release, composition and release-artifact reads;
- generic change-set submission and change-set read;
- presigned artifact upload creation;
- validation start, status and results;
- review submission and authorized review decision;
- publication start, status and reconciliation.

It does not expose KPI-specific routes, automatic graph inspection or a
metric-family-specific generator/validator. Its Composition Contract v1 can
reference either a generated `base-metrics-catalog/v1` source or a published
catalog URI and digest, but specialized metric semantic validation remains
outside the generic API.

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
