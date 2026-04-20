# Lexicon Phase

Treat this phase as a hard gate. No pipeline, widget, or delivery work is allowed until the lexicon mapping is confirmed.

## Required User Inputs

Ask for these when they are not already explicit:

- vendor name
- metric family
- redacted sample payload, file, or schema
- vendor metric names and vendor definitions
- intended business use
- expected dashboard unit
- temporal class: `realtime`, `snapshot`, `historical`, or clearly derived

If the user cannot provide a sample, call that out as an assumption and ask whether to continue with that risk.

## Candidate Inventory Mode

Use this path when the user asks for "all possible metrics" or wants to choose from candidate metrics before canonical naming.

1. Inspect vendor docs, info endpoints, or schemas to enumerate the available raw metrics or fields.
2. Separate direct vendor metrics from clearly derived metric candidates.
3. Mark which candidates look business-meaningful enough to consider for lexicon mapping.
4. Return a selection table and ask the user which candidates should move to lexicon mapping.

Use this table for inventory mode:

| Candidate metric | Source endpoint or file | Definition | Raw or derived | Recommended | Notes |
| --- | --- | --- | --- | --- | --- |
| `...` | `...` | `...` | `raw` or `derived` | `yes` or `no` | `...` |

Candidate inventory mode does not bypass lexicon confirmation. After the user selects metrics, continue with the normal lexicon comparison table below.

## Lexicon Workflow

1. If the user asked for candidate discovery first, run candidate inventory mode before proposing canonical names.
2. Inspect existing metric names, nearby definitions, units, and dimensions in the lexicon.
3. Search for reuse in `cloudwatch-metrics.json` first.
4. Decide whether the request also needs graph-level modeling in `lexicon.json`.
5. If graph persistence or immutable business snapshots are involved, inspect `daily_business_metric_value` and related edges before proposing a change.
6. Update the lexicon only after confirming reuse is not sufficient.

## Scope Decision Rules

Update `cloudwatch-metrics.json` when the work needs:

- a new CloudWatch `MetricName`
- documented dimensions for dashboard or pipeline use
- a canonical business-friendly metric description for emitted metrics

Update `lexicon.json` when the work also needs:

- immutable business snapshot modeling
- graph persistence or query support
- new vertices, edges, or schema-backed business relationships

Some requests need both files. Do not assume one file is enough.

## Required Comparison Table

Present a side-by-side table before asking for confirmation:

| Vendor metric | Vendor definition | Proposed lexicon name | Proposed description | Unit | Temporal class | Reuse or new |
| --- | --- | --- | --- | --- | --- | --- |
| `...` | `...` | `...` | `...` | `Count/Seconds/Percent/...` | `realtime/snapshot/historical/...` | `reuse` or `new` |

Descriptions must be business-friendly. Units must be CloudWatch-compatible.

## Confirmation Gate

Ask the user to confirm all of the following:

- canonical metric name
- business-friendly description
- unit
- temporal class
- whether the metric reuses an existing definition or adds a new one

Do not proceed until the user confirms.

## Response Boundary Before Confirmation

When the lexicon mapping is still unconfirmed, the response must stop here.

Allowed content before confirmation:

1. a short repo-understanding summary if it materially helps the naming decision
2. the candidate inventory table when the user asked to choose from possible metrics first
3. the required comparison table
4. a concise selection or confirmation request
5. correctness-critical clarifying questions

Do not include any of the following before confirmation:

- pipeline design or lane selection details
- dashboard design or widget placement details
- delivery sequencing, branch strategy, commit strategy, or PR guidance
- implementation steps framed as if the lexicon decision is already settled

If the user asks for full end-to-end design in one message, explain that lexicon confirmation is a hard gate and pause after the comparison table plus confirmation request.

## Ambiguity Rules

Stop and ask when:

- an existing canonical name is close but not semantically equivalent
- the requested unit conflicts with existing semantics
- the vendor metric mixes realtime and historical meaning
- the metric belongs in graph snapshots but the requested change only mentions CloudWatch
- a new business snapshot metric would require updates to `daily_business_metric_value` enums or tests
