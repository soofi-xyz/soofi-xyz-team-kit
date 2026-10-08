# Business KPI to metric-materialization configuration

Use this workflow when a person asks Model to turn business or report questions
into governed metric definitions. Treat discovery, definition publication,
Persist activation, and observed materialization as separate lifecycle stages.

## Ownership boundary

Model owns:

- the source-controlled, versioned definition package;
- validation against a pinned Lexicon release;
- closed materialization-plan generation and validation;
- review, publication, release attestation, and immutable discovery metadata;
- any reviewed exact activation allowlist declared by the package.

Persist owns:

- compilation of supported materialization plans;
- Neptune Streams change detection and trigger routing;
- source-history reads, elections, recomputation, and duplicate protection;
- mutable, generation-isolated metric cells and internal graph writes;
- rebuilds, checkpoints, shadow generations, activation, rollback, and search.

Publishing a Model definition does not activate it or prove that Persist has
materialized it. Never add a second metric authority to Persist or encode
business semantics in a report query.

## Verify the target contract

Discover the target repository and revision before naming files, API routes, or
artifact pointers. The current Lexicon reference implementation uses:

```text
src/data/financial-metrics/payment-financial-metrics.v2.json
scripts/lib/financial-metrics/
/lexicon/financial-metrics-catalog-uri
```

The source package is authoritative. It is published with a manifest and the
matching Lexicon release; `metric_definition` vertices are immutable graph
projections of that package. Treat these names as verified reference behavior,
not as permission to invent the same paths in another deployment. Use only
discovered Model API operations for validation and publication. Do not write
canonical S3 objects, SSM parameters, or graph projections directly.

## Start from questions, not graph permutations

1. Record each business or report question and the decision it supports.
2. Pin the Lexicon release, source package/version, report revision, and
   discovered Model API/authentication.
3. Build a source ledger with exact vertices, directed edges, properties,
   indexes, enum members, units, and business-time fields.
4. Separate Lexicon-backed facts from report inputs, formulas, mappings, and
   external classifications.
5. Propose one candidate family per meaningful measure × classifier rule.
6. Review the family before expanding verified enum members into separate
   metric IDs.
7. Validate and publish only candidates that pass every semantic gate.

Do not generate every numeric property × enum property × graph path. A reachable
path proves connectivity, not business attribution. Multiple equivalent paths
can count the same fact more than once and produce hundreds of millions of
meaningless candidates.

## Candidate dispositions

Use these values in the analysis record. They are not Model API statuses unless
the discovered API explicitly defines them.

- `VALID`: the source and every semantic decision are supported and complete.
- `NEEDS_BUSINESS_RULE`: the source facts exist, but attribution, precedence,
  time, currency conversion, or another business decision is unresolved.
- `REJECTED`: the facts are absent, grains or units conflict, a canonical path
  cannot prevent duplicate contributions, or the runtime contract cannot
  express the definition.

Publish only `VALID` definitions. Put every requested but unsupported output in
`Cannot Be Generated`, with the missing evidence or decision and its owner.
Never invent enum members, paths, precedence, formulas, timezones, currencies,
or API operations.

## Semantic gates

A candidate is `VALID` only when all of these are explicit:

1. **Question and grain** — the metric answers one stated question and its
   source item is uniquely identified.
2. **Canonical attribution** — exactly one directed path or governed election
   attributes the item to each output scope.
3. **Once-only contribution** — retries and alternate paths cannot count one
   source item twice.
4. **Measure and classifier compatibility** — both describe the same source
   grain or have an explicit, reviewable as-of relationship.
5. **Temporal behavior** — choose `EVENT_FLOW`, `LATEST_STATE`,
   `AS_OF_SNAPSHOT`, or `CUMULATIVE_VALUE`; do not mix them.
6. **Deterministic election** — order entries include expressions and
   directions, structured precedence where needed, and a final immutable
   tie-breaker. Ambiguity fails closed.
7. **Business time** — name the exact property or election, timezone, period
   boundary behavior, and late-correction behavior.
8. **Units and output** — units/currencies are compatible and the output type
   and canonical representation are explicit.
9. **Complete triggers** — every label that can add, remove, or reclassify a
   contribution causes recomputation.
10. **Coverage** — `FULL_HISTORY` omits a coverage start;
    `FORWARD_ONLY` includes one and never claims complete history.
11. **Runtime support** — the pinned catalog contract and Persist compiler can
    represent the definition without prose-only execution logic.

Review these gates once at the measure × classifier-rule family level. Expand
only enum members present in the pinned Lexicon, and create explicit member
metric names when the target catalog follows that convention.

## Primitive and business metrics

Keep event occurrence and elected business state distinct:

```text
payment.count                              primitive event metric
payment.amount.sum                         primitive event-flow amount
payment.status.nsf.event_count             primitive status-edge occurrence
payment.current_status.nsf.count           elected current-state business metric
payment.current_status.nsf.amount.sum      elected current-state business metric
```

`payment.status.nsf.event_count` answers “How many NSF events occurred?”
It does not answer “How many payments are currently NSF?” A later status may
move a payment out of one current-status metric and into another while leaving
the immutable event metric unchanged.

For each current-status family, all status-change events must trigger
recomputation, not only events whose incoming value matches the metric. Larger
period grains must be computed from authoritative candidates under that
definition. Do not derive a month, quarter, or year current-state value by
summing daily snapshots.

## Definition record

Use the target package schema exactly. For the current payment v2 contract, a
complete candidate resolves at least:

- stable `metric_id`, `definition_version`, `business_name`, family, and
  catalog contract version;
- pinned source release plus root, graph source, directed path hops, and scope
  paths;
- `unique_item`, contribution identity, once-only rule, and correction rule;
- measure, calculation, unit, output value type, and declared dimensions;
- qualifying conditions using exact properties and enum members;
- time behavior, business-time property/election, timezone, and deterministic
  latest/as-of election where applicable;
- coverage mode and start-date contract;
- supported scopes and period grains;
- every triggering vertex and edge;
- `metric_cell`, `metric_period`, debt-scope edge, GLOBAL-scope, and
  period-edge output contracts; and
- a generated closed materialization plan whose selectors, election,
  contribution identity, period assignment, typed output, and sparse-delete
  behavior resolve without placeholders.

In the current payment package, `GLOBAL` is the literal enterprise scope and
has no company or debt scope edge. Debt cells link from the debt and all cells
link to a `metric_period`. The package requests `DEBT` and `GLOBAL` scopes and
`DAY`, `MONTH`, `QUARTER`, and `YEAR` grains. Preserve the exact target
contract instead of weakening it to a generic group-by table.

Generate derived plans with the target repository's generator and require
byte-equivalent validation. Do not hand-author a plan that disagrees with the
definition fields. A semantic change requires a new definition version.

## Cell mathematics

For a definition `d`, let `C(d, scope, period, coordinates)` be the deduplicated
set of source contributions that pass its path, predicates, time rule, and
election. The cell value is the definition's operation over that complete set:

```text
value = operation(C)
```

COUNT uses contribution identities, COUNT_DISTINCT uses the declared unique
item, and SUM/AVERAGE/MINIMUM/MAXIMUM use the declared typed measure. FIRST and
LATEST use their explicit order. Never replace recomputation with an unguarded
increment or decrement.

The logical cell key is:

```text
metric ID/version
+ scope and scope identifier
+ period grain and period start
+ sorted dimension coordinates
```

The physical identity additionally includes the Persist generation so active,
shadow, and prior projections can coexist. A changed fact recomputes every
affected old and new cell from authoritative history. Persist may update only
the contract-authorized typed value and operational metadata; source facts and
immutable `metric_contribution` and `metric_dimension_coordinate` history
remain unchanged. The Persist-managed `metric_projection_state` selects the
active generation.

## Canonical payment example

For `payment.current_status.nsf.amount.sum`, verify:

- the measure is `payment.amount`;
- the unique item is the stable payment identity;
- debt attribution follows the canonical debt-to-payment relationship;
- the elected classifier is the latest qualifying
  `payment_status_changed.status`;
- election order and reversal precedence are structured and deterministic;
- business time is the payment's configured effective time;
- each payment contributes once to each declared scope/period cell; and
- every relevant payment, status, attribution, or relationship label that can
  change the result triggers full recomputation of affected old and new cells.

A RECEIVED-to-NSF correction removes the amount from elected RECEIVED cells and
adds it to elected NSF cells for the payment's original business periods.
`payment.amount.sum` remains an event-flow metric, and the NSF status event
remains an immutable event contribution.

## Historical DSA example

Do not treat DSA as a vertex type. Discover and validate the actual path:

```text
company
  --company_represents_debt-->
debt
  --debt_has_payment-->
payment
```

Use the exact representation properties and enum members in the pinned
Lexicon, including company type, lifecycle status, effective time, and version
when present. A historical payment metric must elect representation as of the
payment's business time. A current debt index can support a current debt count,
but it cannot prove historical DSA attribution. If precedence among competing
representations is missing, classify the metric `NEEDS_BUSINESS_RULE`.

## Required output

Return this compact analysis before producing any API payload:

```text
Analysis identity
  Target repository/revision:
  Lexicon release/digest:
  Metric package/version:
  Discovered Model API/auth:

Business and report questions

Source ledger
  Lexicon-backed facts:
  External inputs/formulas:

Suggested metrics
  Business name:
  Metric ID/version:
  Question:
  Source identity/grain:
  Canonical path/attribution:
  Measure/calculation/unit:
  Classifier/election/tie-breakers:
  Time behavior/property/timezone:
  Scopes/grains:
  Triggers:
  Coverage:
  Contribution/correction rule:
  Output contract:

Cannot Be Generated
  Requested output:
  Disposition: NEEDS_BUSINESS_RULE | REJECTED
  Missing or incompatible evidence:
  Required decision and owner:

Governance evidence
  Candidate validation:
  Review/publication:
  Release URI/digest read-back:
  Persist activation/materialization handoff:
```

After validation, submit the target API's actual candidate shape rather than
assuming this analysis template is its wire contract. Distinguish candidate
accepted, validated, reviewed, published, activated, and observed materialized
states in every result.
