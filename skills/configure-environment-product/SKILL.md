---
name: configure-environment-product
description: "Configure and test Environment through its existing HTTP API. Use Shaymin for plans, Account manifest intake, domains, certificates, shared routing, initial Prism installation and resumable readiness; route service gaps to Torterra."
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
3. Configure verified environment plans, domain/certificate lifecycle, shared routing, initial installs and recovery through the existing Environment API. If only Bootstrap exists, identify the API gap and hand it to Torterra. Run a supported cold-start adapter only when explicitly in scope; its successful CLI run does not satisfy HTTP API acceptance.
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

## Customer accounts and live installs

- **Onboard a customer account through its governed role.** A Marketplace-installed
  Deploy has no invoker resource policy, so Environment reaches it only by assuming
  the customer-account role `/prism/environment-target`. Create that role (Deploy
  invoke only, trusting Environment's caller roles), add the account to
  `CustomerAccountIds`, and give its routing inventory entry `target_role_arn`. Follow
  the Environment README's [per-account customer role](https://github.com/prismteam-ai/environment#per-account-customer-role-2026-10-05)
  and [onboarding](https://github.com/prismteam-ai/environment#onboard-a-new-customer-account-operator)
  sections for the exact policy, trust and inventory entry.
- **Record the region's API Gateway CloudWatch role before installing a product.**
  `apigateway get-account` holds one role per account and region, and installing a
  product whose REST API manages it (Deploy and Account today) silently replaces it.
  Restore the recorded role before deleting that product's retained role, or another
  team's API logging breaks.
- **Choose a low-footprint test product.** Before an install, inspect the bundle's
  templates: prefer one without `AWS::ApiGateway::Account`, without required
  parameters and without resources retained on delete, and check that its stack name
  (often `<Product>-review`) does not already exist in the target account.

Keep identity, keys, the backing AWS account record/provisioning and bootstrap
manifest with Account. Consume that non-secret manifest, then own domain and
certificate lifecycle, shared routing and initial platform-installation readiness.
Consume Marketplace bundles and let Deploy execute product installations after its
first install. Treat Bootstrap as an Environment adapter, not another product.
Install Deploy's Puller component and hand ongoing subscriptions, polling and
recovery to Corviknight/Skarmory; Environment does not implement those subscriber
capabilities.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Verify shared provider/API prerequisites through existing Environment operations before reporting configuration installation readiness.
