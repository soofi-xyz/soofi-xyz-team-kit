---
name: configure-environment-product
description: "Configure and test Environment through its existing HTTP API. Use Shaymin for environment plans, Account manifest intake, shared API routing, initial Deploy installation, subscriber handoff and resumable readiness checks; route service gaps to Torterra."
---

# Configure Environment

Use `shaymin`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Environment capability map](../guide-product-work/reference/iterations/environment.md).
Read the relevant [product contract](../build-bootstrap-cli/reference/PRD.md) and
[synthetic test data](../build-bootstrap-cli/reference/test-data.md).

1. Discover the existing service/revision, supported API, authentication and
   resource authorization, selected AWS profile, account and region. Separate
   required, implemented and observed capabilities. Do not guess route names.
2. Select the requested feature pieces and dependencies. Explain each with a
   synthetic fixture. Use a baseline, materially different supported configuration,
   invalid/unauthorized input and relevant replay/recovery cases inside each piece;
   use four as a full walkthrough floor, not a fixed count or a quota for narrow work.
3. Configure verified environment plans, shared routing, initial installs and recovery through the existing Environment API. If only Bootstrap exists, identify the API gap and hand it to Torterra. Run a supported cold-start adapter only when explicitly in scope; its successful CLI run does not satisfy HTTP API acceptance.
4. Use the deployment's verified test adapters for external effects. If it lacks
   a safe test mode or required capability, leave that check pending and hand a
   redacted reproducer to `torterra`. Do not edit service code, write internal storage,
   or silently fall back to direct AWS mutations to pass a configuration check.
5. Give the user one copyable API invocation, expected result and at most three
   steps to inspect its actual AWS logs/workflow. Have them run the baseline and
   variant, read back results and return redacted IDs and observations. Wait for
   that evidence before advancing; request acceptance is not async completion.
6. Keep secrets in the approved local credential channel. Verify live effects
   are covered by the requested scope and record cleanup without removing shared
   resources. Keep mocked execution distinct from actual dependency readiness.

Keep identity, underlying AWS account provisioning, DNS/certificate inventory and service keys with Account. Consume Marketplace bundles and let Deploy execute product installations after its first install. Treat Bootstrap as an Environment adapter, not another product.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.
