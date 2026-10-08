# Financial metric generation contract

Use this contract for financial and business KPIs. Do not use
`cloudwatch-metrics.json`; that file governs AWS observability metric names and
dimensions, not financial calculations.

## Discover the authoritative revision

In the target Lexicon revision, discover and read:

- the published financial metric package under `src/data/financial-metrics/`;
- `scripts/lib/financial-metrics/types.ts` for the exact TypeScript contract;
- `scripts/lib/financial-metrics/catalog.ts` for validation invariants;
- the supported materialization generator and its check mode;
- `src/data/lexicon.json` for every referenced vertex, edge and property;
- the approved release and deployment pointer used by consumers.

The currently observed reference uses
`lexicon-payment-financial-metrics-config/v2`,
`financial-metrics-catalog/v2`,
`metric-definition-projection/v2`,
`metric-cell-materialization/v2`, and
`payment-metric-materialization-plan/v1`. Treat those as observed values, not
permission to force them onto a different target revision.

## KPI intake

Require:

- business name, definition and decision supported;
- population/root and exclusions;
- unique item and duplicate semantics;
- calculation and measure;
- source graph path and qualifying conditions;
- event, state, snapshot or cumulative time semantics;
- business-time property, timezone and requested grains;
- debt/global scope paths;
- unit and output value type;
- dimensions;
- correction/reversal behavior;
- full-history or forward-only coverage;
- source report, policy or other definition evidence.

For a ratio or percentage, require explicit numerator, denominator,
zero-denominator behavior and period alignment. The observed calculation
vocabulary has no generic divide/ratio operator. Do not encode a composite KPI
as `PERCENT` alone: either reuse an existing supported definition or leave the
candidate blocked and hand the missing calculation capability to Dialga.

## Definition contract

Generate one candidate matching the target revision's exact
`FinancialMetricDefinition`. The observed v2 contract contains:

```text
metric_id
business_name
definition_version
catalog_contract_version
family_id
category
report_category
root
graph_source
path
path_hops
scope_paths
unique_item
contribution_identity
measure
calculation
unit
dimensions
qualifying_conditions
time_behavior
business_time_election? / latest_state_election?
date_used
business_time_property
business_timezone
coverage_mode
coverage_start_date?
scopes
grains
triggering_vertices
triggering_edges
contribution_rule
correction_rule
output_cell_type
output_value_type
period_vertex_type
scope_edge_types
period_edge_type
materialization_plan
```

Use the target package's enumerations exactly. The observed v2 vocabularies are:

```text
calculation:
  COUNT | COUNT_DISTINCT | PRESENT_COUNT | MISSING_COUNT |
  DISTINCT_COUNT | VALUE_COUNT | SUM | AVERAGE | MINIMUM | MAXIMUM |
  FIRST | LATEST | ENUM_DISTRIBUTION | UNIQUE_START_COUNT |
  UNIQUE_END_COUNT | UNIQUE_CONNECTION_COUNT | PATH_COUNT

time_behavior:
  EVENT_FLOW | LATEST_STATE | AS_OF_SNAPSHOT | CUMULATIVE_VALUE

scope: DEBT | GLOBAL
grain: DAY | MONTH | QUARTER | YEAR
unit: COUNT | USD | PERCENT | UNDECLARED
output_value_type: NUMBER | DATE | DATE_TIME
coverage_mode: FULL_HISTORY | FORWARD_ONLY
category: VERTEX | PROPERTY | DIRECT_EDGE | DIRECTED_SHORTEST_PATH
report_category: VERTEX | PROPERTY | EDGE | ENUM
```

Do not hand-author `materialization_plan`, package counts, family matrices or
digests. Add or change the semantic definition fields accepted by the target
generator, run that generator, and retain its exact output. The final definition
must include the generated plan and remain parseable as the target
`FinancialMetricDefinition`.

## Required invariants

- Every root, path hop, trigger, condition, selector and property exists in the
  selected Lexicon release, with edge direction preserved.
- `unique_item` identifies the business occurrence being counted or measured.
- `contribution_identity` includes metric identity, definition version, unique
  item, cell identity and calculation so replay is idempotent.
- Calculation, measure, unit and output type agree.
- Time behavior has deterministic business-time and election semantics.
- State elections define deterministic ordering and reject unresolved ambiguity.
- `FULL_HISTORY` omits forward coverage; `FORWARD_ONLY` supplies the required
  coverage start according to the target validator.
- Scope paths resolve the same source occurrence to the declared debt/global
  scope without inventing graph relationships.
- Semantic changes create a new immutable definition version.
- Generation is deterministic: repeated input yields the same plan, family
  assignment and definition-set digest.
- Catalog publication does not activate a metric. Activation remains a separate
  reviewed allowlist/generation action.

## Package and release evidence

The governed result is a versioned package, not an isolated JSON fragment.
Verify:

- package and contract versions;
- source metadata and Lexicon revision;
- definition count and summaries;
- RFC 8785 JCS SHA-256 definition-set digest;
- generated materialization readiness and family matrix;
- immutable approved release and manifest digests;
- API read-back of the same release;
- activation state separately from publication state.

If the discovered Model API cannot validate or submit this package contract,
leave the operation pending and give Dialga the redacted candidate plus validator
output. Never replace the governed API/review flow with direct canonical source,
S3 or SSM writes.
