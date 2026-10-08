---
name: configure-model-product
description: "Configure and test Model through its existing HTTP API. Use Jirachi for KPI-to-metric configuration, vocabulary lookup, candidate validation, governed changes, ruleset definitions, mapping registrations and versioned releases; route service gaps to Dialga."
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

## Configure a KPI as an existing metric family

When a user defines a KPI or asks what can be measured, read the
[KPI-to-metric configuration contract](reference/kpi-to-metric-configuration.md).
Finance is one configuration family; do not assume every KPI is financial or
force it into the payment financial-metrics package.

1. Normalize the business intent: decision, population, measure, calculation,
   numerator/denominator when applicable, exclusions, unique item, unit, output
   type, time behavior, business time/timezone, coverage, scope, grain and
   dimensions. This is an analysis record, not a new API wire schema.
2. Pin the selected Lexicon release and inspect its graph vocabulary, Base
   Metrics family/operation catalogs, approved executable metric packages and
   digests. Search for exact semantic reuse before creating a candidate.
3. Match the KPI to an existing base family by graph source/path, unique item
   and valid calculation, then select an executable configuration family whose
   temporal, scope, dimension and consumer contracts support it. Verify the
   deployed consumer revision independently.
4. Return `measurable` only when an existing definition can be reused or the
   selected executable family supports the complete candidate. Return `partial`
   when Base Metrics identifies a family but no executable package/consumer
   exists. Return `blocked` for missing graph facts, unsupported formula,
   calculation, time behavior, scope, grain, unit or consumer capability.
5. Generate only through the selected family's discovered authoring contract
   and generator. Never clone generated plans, invent generic metric fields,
   treat a unit such as `PERCENT` as formula semantics, or use
   `cloudwatch-metrics.json` as a business KPI contract.
6. Present the matched family, exact reuse/new-version decision, authored
   fields, generated evidence and runtime compatibility. Require confirmation
   before validation and separate confirmation before governed publication or
   activation. Verify immutable release/read-back digests.

Return this proposal:

```text
KPI / business decision:
Population / measure / calculation:
Time / scope / grain / dimensions:
Lexicon release and graph evidence:
Base family and operation:
Executable configuration family:
Reuse or candidate definition:
Consumer compatibility:
Measurability: measurable | partial | blocked
Ambiguities / unsupported semantics:
Confirmation: pending | confirmed
Validation / review / release / activation:
```

Exercise exact reuse, a materially different supported configuration, a generic
family with no executable runtime, an invalid graph reference or unsupported
composite formula, and deterministic regeneration/replay. Publication is not
activation, and activation is not observed materialization.

Keep Persist storage/validation execution with Conkeldurr/Uxie, Rule evaluation with Gallade/Meditite and Transform mapping execution with Kecleon/Silvally. Silvally authors concrete Transform configurations; Model owns shared definition validation and governed publication. Use Mew for vocabulary lookup/modeling advice without changing its retained specialist role.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
