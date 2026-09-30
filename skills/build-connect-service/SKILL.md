---
name: build-connect-service
description: "Maintain the current Connect service runtime and caller compatibility. Use Lapras for engine changes and Wingull for partner configuration."
disable-model-invocation: true
---

# Build Connect

Use `lapras` for the reusable product implementation and `wingull` for
configuration on an existing deployment. Follow
[guide-product-work](../guide-product-work/SKILL.md) and
[engineering guidelines](../apply-engineering-guidelines/SKILL.md).

Read [the block skill](../build-connect-product/SKILL.md) for generic verbs, connections and flow contracts.

Read [the current scope](reference/PRD.md) before implementation. Discover the
target repository, revision and environment. Reuse an existing service when
appropriate; agent availability does not prove deployment or feature support.

Separate historical requirements, current implementation and live evidence.
Where references conflict, inspect the target contract and tests and record the
resolution. Do not silently restore obsolete features or remove working behavior.

Use supporting skills directly for workflow capacity, metrics and model reasoning.
Resolve other products through the catalog. Do not use a general platform owner.
Use Registeel for Marketplace publication; keep deployment prerequisites explicit.

Derive the scoped feature plan from the shared workflow and product capability
map. Require a user-run configuration and AWS inspection after every piece. Return the
implementation changes, verification results, human observations, current stage
and any remaining runtime or integration gaps.
