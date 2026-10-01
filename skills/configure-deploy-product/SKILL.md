---
name: configure-deploy-product
description: "Configure and test Deploy through its existing HTTP API. Use Skarmory for SigV4 run admission, artifact validation, deployment execution, correlated status and failure/retry handling; route service gaps to Corviknight."
---

# Configure Deploy

Use `skarmory`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Deploy capability map](../guide-product-work/reference/iterations/deploy.md).
Read the relevant [product contract](../build-product-deployer/reference/PRD.md) and
[synthetic test data](../build-product-deployer/reference/test-data.md).

1. Discover the existing service/revision, supported API, authentication and
   resource authorization, selected AWS profile, account and region. Separate
   required, implemented and observed capabilities. Do not guess route names.
2. Select the requested feature pieces and dependencies. Explain each with a
   synthetic fixture. Use a baseline, materially different supported configuration,
   invalid/unauthorized input and relevant replay/recovery cases inside each piece;
   use four as a full walkthrough floor, not a fixed count or a quota for narrow work.
3. Sign requests to the discovered Deploy API using the selected credentials; submit a validated artifact with supported parameters and follow status to actual CloudFormation completion. Keep installation history/keys in the verified subscriber component. Do not use old token-deploy payloads or bypass Deploy with direct stack edits.
4. Use the deployment's verified test adapters for external effects. If it lacks
   a safe test mode or required capability, leave that check pending and hand a
   redacted reproducer to `corviknight`. Do not edit service code, write internal storage,
   or silently fall back to direct AWS mutations to pass a configuration check.
5. Give the user one copyable API invocation, expected result and at most three
   steps to inspect its actual AWS logs/workflow. Have them run the baseline and
   variant, read back results and return redacted IDs and observations. Wait for
   that evidence before advancing; request acceptance is not async completion.
6. Keep secrets in the approved local credential channel. Verify live effects
   are covered by the requested scope and record cleanup without removing shared
   resources. Keep mocked execution distinct from actual dependency readiness.

Keep Deploy stateless with respect to subscriber desired state, installation history and keys. The subscriber-side Puller keeps that state; coordinate its current integration with Marketplace without adding a Puller product or putting its state into Deploy.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
