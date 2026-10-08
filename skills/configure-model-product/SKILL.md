---
name: configure-model-product
description: "Configure and test Model through its existing HTTP API. Use Jirachi for financial KPI-to-Lexicon metric definitions, vocabulary lookup, candidate validation, governed changes, ruleset definitions, mapping registrations and versioned releases; route service gaps to Dialga."
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

## Financial KPI to metric definition

When a user gives a financial KPI or asks what to measure, read the
[financial metric generation contract](reference/financial-metric-generation.md)
and treat the request as one scoped `financial-metric-definitions` configuration
piece. This lane is not the CloudWatch observability metric registry.

1. Ask for the KPI definition, business decision, population, aggregation,
   numerator/denominator, exclusions, unit, time grain/basis/timezone, scope,
   filters and intended dimensions. Do not infer ambiguous business semantics.
2. Through the discovered Model API, inspect the selected release's
   financial metric package and `lexicon.json`: existing definitions,
   contract/vocabulary versions, source vertices, edges, properties, indexes and
   Universal Metric Model labels. Verify the release identity and package,
   definition-set and Lexicon digests. Prefer a semantically equivalent
   definition and existing graph vocabulary; a similar name is not equivalence.
3. Classify the KPI as measurable, partially measurable or blocked. Separately
   map its root, graph source/path, scope paths, unique item, calculation,
   qualifying conditions, temporal/election behavior, business time,
   contribution/correction semantics, dimensions and output type to existing
   labels and properties.
4. Generate complete parseable candidate JSON using the target revision's exact
   `FinancialMetricDefinition` contract and vocabularies. Use its supported
   generator to create the materialization plan, family matrix, counts and JCS
   SHA-256 digests; do not hand-author generated sections. Never invent routes,
   fields, enums, graph labels, properties, statuses or calculation semantics.
5. Present the candidate and require explicit confirmation of canonical name,
   business definition, unit, calculation, time behavior/grain, scope, graph
   derivation, election/correction rules, dimensions and reuse-versus-new choice
   before API validation. Validation does not authorize publication or
   activation: require separate confirmation and preserve review, conflict,
   compatibility, immutable definition-version, release, digest and activation
   allowlist gates.
6. If facts, vocabulary or API support are missing, leave the checkpoint pending
   and hand off the gap; never edit canonical source, S3 or SSM directly.

Return this block for the proposal:

```text
Financial KPI / business decision:
Metric identity / definition version:
Calculation / unit / output type:
Time behavior / business time / grain:
Root / graph path / scope paths:
Unique item / contribution identity:
Conditions / elections / correction rule:
Dimensions:
Measurability: measurable | partial | blocked
Evidence and reuse decision:
Candidate FinancialMetricDefinition JSON:
Generated materialization / digest evidence:
Ambiguities:
Confirmation: pending | confirmed
Validation / review / release / activation:
Persist materialization and reporting handoffs:
```

Exercise a baseline supported financial definition; a materially different
calculation or time behavior; unknown graph references, invalid elections and
unsupported formula rejection; and idempotent regeneration/replay without
duplicate definition versions, contribution identities or digest drift.

Keep Persist storage/validation execution with Conkeldurr/Uxie, Rule evaluation with Gallade/Meditite and Transform mapping execution with Kecleon/Silvally. Silvally authors concrete Transform configurations; Model owns shared definition validation and governed publication. Use Mew for vocabulary lookup/modeling advice without changing its retained specialist role.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
