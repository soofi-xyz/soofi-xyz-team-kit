---
name: configure-model-product
description: "Configure and test Model through its existing HTTP API. Use Jirachi for vocabulary lookup, candidate validation, governed changes, ruleset definitions, mapping registrations, meaningful KPI metric-materialization definitions and versioned releases; route service gaps to Dialga."
---

# Configure Model

Use `jirachi`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Model capability map](../guide-product-work/reference/iterations/model.md).
Read the relevant [product contract](../build-lexicon-product/reference/PRD.md) and
[synthetic test data](../build-lexicon-product/reference/test-data.md).
For business metrics, follow the
[KPI-to-materialization workflow](reference/kpi-to-metric-configuration.md).

1. Discover the existing service/revision, supported API, authentication and
   resource authorization, selected AWS profile, account and region. Separate
   required, implemented and observed capabilities. Do not guess route names.
2. Select the requested feature pieces and dependencies. Explain each with a
   synthetic fixture. Use a baseline, materially different supported configuration,
   invalid/unauthorized input and relevant replay/recovery cases inside each piece;
   use four as a full walkthrough floor, not a fixed count or a quota for narrow work.
3. Use the discovered Model API to inspect definitions, validate candidates and apply supported governed publication or release selection. Keep review prerequisites intact and verify artifact/read-back digests. If only the Lexicon artifact/UI contract exists, hand the missing API capability to Dialga; do not substitute direct canonical S3/SSM edits.
4. For KPI work, start from the report question and a pinned source ledger.
   Separate Lexicon-backed facts from external inputs. Review one meaningful
   measure × classifier rule before expanding exact enum members. Reject
   numeric × enum × path Cartesian generation. Publish only internally `VALID`
   candidates; return unresolved or unsupported questions under
   `Cannot Be Generated` with `NEEDS_BUSINESS_RULE` or `REJECTED`.
5. Require source-grain compatibility, one canonical attribution path,
   once-only contribution identity, deterministic elections/tie-breakers,
   business time/timezone, compatible units, complete triggers and coverage.
   Preserve the target definition schema and generated closed plan. Distinguish
   primitive event metrics from current-state, historical as-of, flow and
   cumulative business metrics.
6. Use the deployment's verified test adapters for external effects. If it lacks
   a safe test mode or required capability, leave that check pending and hand a
   redacted reproducer to `dialga`. Do not edit service code, write internal storage,
   or silently fall back to direct AWS mutations to pass a configuration check.
7. Give the user one copyable API invocation, expected result and at most three
   steps to inspect its actual AWS logs/workflow. Have them run the baseline and
   variant, read back results and return redacted IDs and observations. Wait for
   that evidence before advancing; acceptance, validation, review, publication,
   Persist activation and observed materialization are different states.
8. Keep secrets in the approved local credential channel. Verify live effects
   are covered by the requested scope and record cleanup without removing shared
   resources. Keep mocked execution distinct from actual dependency readiness.

Keep Persist storage/runtime validation, metric-plan compilation, Neptune
Streams processing, recomputation, mutable projection cells, rebuilds,
activation/rollback and search with Conkeldurr/Uxie. Keep Rule evaluation with
Gallade/Meditite and Transform mapping execution with Kecleon/Silvally.
Silvally authors concrete Transform configurations; Model owns shared
definition validation and governed publication. Use Mew for vocabulary
lookup/modeling advice without changing its retained specialist role.

Return questions, source evidence, valid suggested definitions,
`Cannot Be Generated` items, configuration changes, redacted identifiers,
API/release read-back results, Persist handoff, automated and user/AWS evidence,
mocked/live status, cleanup and builder handoffs.
