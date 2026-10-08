# KPI-to-metric configuration

Turn a business KPI into an existing Lexicon metric configuration in layers.
Do not invent one universal metric payload: Base Metrics describes generic graph
families, while each executable family owns its exact authoring and runtime
contract. Payment financial metrics are the current executable example.

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
catalog schema, approved-release loader, plan compiler, projection writer,
rebuild workflow, incremental materializer, activation state and end-to-end
tests. A published Lexicon family is not proof that Persist executes it.

Record the source revisions, release IDs, contract versions, artifact paths,
byte lengths and SHA-256 digests used for the proposal.

## Discover KPI candidates from a model

When the user has not already defined one KPI, inspect the pinned model before
authoring anything. Build a bounded shortlist from facts the model actually
contains; three to seven suggestions is normally enough to expose useful choices
without treating every property as a KPI.

Inventory graph properties, external properties and derived indexes separately.
Indexes may support reads but are not canonical source properties. Prefer explicit
event classes, event timestamps and enums; if only names/descriptions imply an
event, label the candidate `event-like` and require confirmation rather than
asserting event semantics.

Safe candidate shapes include:

- counts of vertices/entities in a defined population;
- sum, average, minimum or maximum of a numeric property;
- earliest/latest values when the model supplies the relevant temporal fact;
- enum/status distributions and current-state counts when state semantics exist;
- counts or existence checks over a direct directed edge;
- counts over a short, explicit, continuous directed path;
- event counts or rates only when event identity and event time are modeled.

Do not derive metrics from PII merely because the fields exist. Do not infer
business value from names or descriptions, invent joins or reverse an edge to
make a candidate work. Avoid composite formulas unless a discovered executable
family explicitly supports their operands, alignment and zero/error semantics.

For every suggestion, report:

- a stable suggestion ID scoped to this analysis;
- KPI hypothesis and the business decision it could inform;
- population/root class and exact graph/property evidence;
- Base Metrics family and operation match;
- executable package and consumer support;
- `measurable | partial | blocked`;
- confidence in schema/runtime support and the evidence behind it;
- assumptions, ambiguities and facts still requiring business confirmation.

Confidence is about model and runtime evidence, not business importance. A
structurally measurable KPI is still only a suggestion until the user selects or
refines it. Preserve that selection separately, then normalize and generate only
the selected candidate. Do not turn the whole shortlist into canonical metric
configuration.

## Bind selection to the proposal

Give each discovery result a proposal revision and bind it to the model release
ID and SHA-256 digest. Selection must carry the candidate ID and proposal revision.
Reject stale selections after the model, candidate inventory or support
classification changes. Selection confirms the intended business meaning and
authorizes configuration generation only; it does not approve validation,
publication, activation or materialization.

Keep contract fit deterministic. A model may rank business plausibility, but it
must choose only among opaque references and enums produced by validated model and
metric-package adapters. Never let free-form descriptions create properties,
paths, enum/status values, calculations or dimensions.

## Normalize the KPI

Collect:

- business name, definition and decision supported;
- population/root and exclusions;
- measure and calculation;
- numerator, denominator, alignment and zero-denominator behavior for a ratio;
- unique business occurrence and deduplication identity;
- graph facts and path expected to provide the measure;
- qualifying conditions;
- event, latest-state, as-of or cumulative time semantics;
- business-time property, timezone and coverage boundary;
- scope, period grain and dimensions;
- unit and output value type;
- correction, reversal and late-arrival behavior;
- source report, policy or other definition evidence.

This normalized intent is an analysis record. Do not present it as a Model API
payload unless the discovered API defines that wire contract.

## Resolve model and metric adapters

The builder workflow keeps two extension points explicit:

- a governed-model adapter verifies release identity/digest and exposes typed
  classes, properties, relationships, enums, events and validated directed paths
  as opaque references;
- a metric-package adapter reports supported calculations/scopes/grains/dimensions,
  classifies exact reuse versus family-only/blocked candidates, invokes the
  family-owned generator and validator, and checks a pinned consumer revision.

Do not collapse these into one generic payload assembled by model output. The
current payment financial v2 adapter is exact-reuse/activation-only against the
observed Persist compiler. Other packages may support new definitions only when
their own schema, generator and pinned consumer explicitly prove that capability.

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
package by combining fields from unrelated families.

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

Use the package's current `FinancialMetricDefinition` type and validator for its
exact fields. Author only semantic source fields accepted by that package.
Generate, never copy or hand-edit, plans, family metadata, counts and digests.

The current Persist payment runtime accepts the approved v2 financial release,
strictly decodes the generated plan, cross-checks compatibility fields and
materializes the closed code-owned payment definition set through shadow rebuild,
reconciliation and activation. Its configurable surface is a sorted, unique,
non-empty `dev_activation_allowlist.metric_ids` subset of existing catalog-backed
IDs. It does not support new financial definitions, selectors, traversals or
plans. This is payment-family support, not a generic Base Metrics interpreter.
Verify this boundary again in the selected consumer revision.

## Classify support

Return:

- `measurable` when an exact definition exists or one executable family and its
  deployed consumer support the complete candidate;
- `partial` when Lexicon identifies a valid base family but no executable
  package or consumer supports it;
- `blocked` when graph facts are absent or the requested formula, calculation,
  time behavior, scope, grain, unit, election or output is unsupported.

Ratios are a common blocked case. A `PERCENT` unit does not define division,
numerator/denominator alignment or zero-denominator behavior. Do not approximate
a ratio with `AVERAGE`, and do not emit two component metrics while claiming the
requested KPI exists.

## Generate, validate and govern

For an executable package that explicitly supports a new definition:

1. Add or change only fields owned by the selected package.
2. Run its generator.
3. Run package validation against the exact Lexicon bytes.
4. Verify path continuity, properties, types, elections, contribution identity,
   correction behavior, coverage, generated-plan equivalence and consumer
   compatibility.
5. Regenerate the package and release; verify deterministic bytes and digests.
6. Submit through the discovered Model candidate/review API.
7. Read back the reviewed immutable release and compare digests.
8. Treat activation/materialization as a separate Persist-owned operation.

For current payment financial v2 configuration, skip new-definition authoring:
select existing immutable IDs, validate the sorted/unique/non-empty activation
allowlist against the approved catalog, run the official generator unchanged and
verify the pinned Persist revision. Unknown IDs, empty lists and hand-edited
generated plans, matrices, counts or digests fail closed.

If no Model API exists, artifact validation remains local evidence only. Leave
publication pending and hand the missing API capability to Dialga; never replace
it with direct canonical source, S3 or SSM writes.

## Acceptance cases

- Exact reuse: a KPI semantically identical to an existing operation returns its
  immutable definition identity without a duplicate.
- Current payment activation: selected existing metric IDs produce a sorted,
  unique, non-empty allowlist; unknown, duplicate and empty selections fail.
- Supported variant: only a package/consumer that explicitly permits a new
  definition may generate one and prove consumer compatibility.
- Family-only: a non-financial KPI maps to a Base Metrics family but stays
  `partial` when no executable package/runtime exists.
- Invalid: an unknown graph reference, discontinuous path, unsupported
  calculation or composite ratio fails before publication.
- Boundary: configuration without revision-bound selection, stale proposal
  digests and prompt-injection text that attempts to introduce references fail.
- Recovery: unchanged input regenerates byte-identical plans/releases and stable
  digests; hand-edited generated data fails closed.
- Lifecycle: validation, publication, activation and observed materialization
  are recorded as separate evidence states.
