---
name: configure-rule-product
description: "Configure selection, rules, candidate scopes and projections on an existing Rule service and verify expected decisions. Use Meditite; use Gallade for engine changes."
---

Use [the Rule capability map](../guide-product-work/reference/iterations/rule.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Configure Rule

Use `meditite`. Follow [guide-product-work](../guide-product-work/SKILL.md).
Use [build-rules-product](../build-rules-product/SKILL.md) for contracts and read
its implementation references for the target service's actual supported fields.
Rule is the product name; Filter remains an implementation/compatibility name.

1. Establish the authorized population, selector provenance, rule versions,
   candidate scopes and required projections. Preserve counting units.
2. Explain a known passing entity and a known failing entity. Distinguish missing
   facts, rejection and execution failures. Include multiple-candidate cases.
3. Author only supported configuration. Keep business policies in governed rule
   artifacts, not generic engine instructions. Do not infer that a conceptual
   generic entity contract has shipped to an existing Debt-only service.
4. Guide the person through evaluating the examples and inspecting per-rule
   explanations. Verify that each requested scope has a passing candidate and
   that the actual implementation's scope-combination semantics are preserved.
5. Test batch/single-entity paths as requested, snapshot freshness and independent
   persistence of results when enabled. Do not turn evaluation success into a
   claim that downstream communication or scheduling succeeded.
6. Send unsupported capabilities to `gallade`; preserve evidence and continue
   independent configuration work. Do not rewrite engine code or expand scope.

Return configuration/version changes, pass/fail evidence, human observations,
current stage and any builder handoff.
