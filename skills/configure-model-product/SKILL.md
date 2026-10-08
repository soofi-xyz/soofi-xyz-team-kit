---
name: configure-model-product
description: "Configure and test Model through its existing HTTP API. Use Jirachi for KPI-to-Lexicon metric configuration, vocabulary lookup, candidate validation, governed changes, ruleset definitions, mapping registrations and versioned releases; route service gaps to Dialga."
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
3. Use the discovered Model API to inspect definitions, validate candidates and apply supported governed publication or release selection. Keep review prerequisites intact and verify artifact/read-back digests. If only the Lexicon artifact/UI contract exists, hand the missing API capability to Dialga; do not substitute direct canonical S3/SSM edits.
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

## KPI to metric configuration

When a user gives a KPI or asks what to measure, treat it as one scoped
`metric-definitions` configuration piece:

1. Ask for the KPI definition, business decision, population, aggregation,
   numerator/denominator, exclusions, unit, time grain/basis/timezone, scope,
   filters and intended dimensions. Do not infer ambiguous business semantics.
2. Through the discovered Model API, inspect the selected release's
   `cloudwatch-metrics.json` and `lexicon.json`: existing metric names and
   dimensions plus relevant vertices, edges, properties and indexes. Verify the
   release identity and artifact digest. Prefer a semantically equivalent metric
   and existing graph vocabulary; a similar name is not equivalence.
3. Classify the KPI as measurable, partially measurable or blocked. Separately
   describe its graph derivation: source labels, traversal path, subject,
   filters, timestamp/window, aggregation, deduplication and reusable indexes.
   A metric registry definition governs name and dimensions; it does not contain
   traversal/calculation logic unless the discovered schema explicitly supports it.
4. Generate complete parseable candidate JSON by cloning the exact shape of a
   current metric definition and its current document wrapper. Use only
   discovered keys, enums and API payload fields; never invent routes, fields or
   statuses. Reject or redesign entity IDs, request/execution IDs, free text and
   other unbounded CloudWatch dimensions.
5. Present the candidate and require explicit confirmation of canonical name,
   description, unit, temporal class/time grain, scope, derivation,
   dimensions/cardinality and reuse-versus-new choice before API validation.
   Validation does not authorize publication: require separate confirmation and
   preserve review, conflict, compatibility, versioned release and digest gates.
6. If facts, vocabulary or API support are missing, leave the checkpoint pending
   and hand off the gap; never edit canonical source, S3 or SSM directly.

Return this block for the proposal:

```text
KPI / business decision:
Unit / time grain / scope:
Measurability: measurable | partial | blocked
Evidence and reuse decision:
Graph derivation (not metric registry):
Candidate metric registry JSON:
Ambiguities / dimension cardinality:
Confirmation: pending | confirmed
Validation / review / release / digest:
Runtime calculation, emission and dashboard handoffs:
```

Exercise a baseline fixture metric over the synthetic vertices/edge with one
bounded required dimension; a materially different supported scope or enum
value; an unknown graph reference/dimension and high-cardinality rejection; and
idempotent replay or recovery without duplicate publication or digest drift.

Keep Persist storage/validation execution with Conkeldurr/Uxie, Rule evaluation with Gallade/Meditite and Transform mapping execution with Kecleon/Silvally. Silvally authors concrete Transform configurations; Model owns shared definition validation and governed publication. Use Mew for vocabulary lookup/modeling advice without changing its retained specialist role.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
