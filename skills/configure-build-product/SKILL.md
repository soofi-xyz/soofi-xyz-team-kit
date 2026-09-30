---
name: configure-build-product
description: "Configure and test Build through its existing HTTP API. Use Metang for source intake, isolated build jobs, CDK synthesis, runtime asset policy, provenance, observable results and delivery; route service gaps to Tinkaton."
---

# Configure Build

Use `metang`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Build capability map](../guide-product-work/reference/iterations/build.md).
Read the relevant [product contract](../build-build-service/reference/PRD.md) and
[synthetic test data](../build-build-service/reference/test-data.md).

1. Discover the existing service/revision, supported API, authentication and
   resource authorization, selected AWS profile, account and region. Separate
   required, implemented and observed capabilities. Do not guess route names.
2. Select the requested feature pieces and dependencies. Explain each with a
   synthetic fixture. Use a baseline, materially different supported configuration,
   invalid/unauthorized input and relevant replay/recovery cases inside each piece;
   use four as a full walkthrough floor, not a fixed count or a quota for narrow work.
3. Submit source and supported build options through the existing Build API; follow job status, retrieve logs and validate manifest/artifact digests. A product source correction remains source work; a missing runner/API capability or validation defect goes to Tinkaton. Do not edit service buildspecs to make one configuration pass.
4. Use the deployment's verified test adapters for external effects. If it lacks
   a safe test mode or required capability, leave that check pending and hand a
   redacted reproducer to `tinkaton`. Do not edit service code, write internal storage,
   or silently fall back to direct AWS mutations to pass a configuration check.
5. Give the user one copyable API invocation, expected result and at most three
   steps to inspect its actual AWS logs/workflow. Have them run the baseline and
   variant, read back results and return redacted IDs and observations. Wait for
   that evidence before advancing; request acceptance is not async completion.
6. Keep secrets in the approved local credential channel. Verify live effects
   are covered by the requested scope and record cleanup without removing shared
   resources. Keep mocked execution distinct from actual dependency readiness.

Keep Marketplace publication/review with Regigigas/Registeel and deployment execution with Corviknight/Skarmory. A successful build proves artifact creation, not publication or installation.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
