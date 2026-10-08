---
name: configure-deploy-product
description: "Configure and test Deploy through its existing HTTP API. Use Skarmory for deployment runs plus Puller subscriptions, polling, update policy and recovery; route service gaps to Corviknight."
---

# Configure Deploy

Use `skarmory`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Deploy capability map](../guide-product-work/reference/iterations/deploy.md).
Read the relevant [product contract](../build-product-deployer/reference/PRD.md) and
[synthetic test data](../build-product-deployer/reference/test-data.md).
Load [the Puller skill](../build-marketplace-puller/SKILL.md) and its
[subscriber contract](../build-marketplace-puller/reference/PRD.md) in configure
mode. Keep engine changes with Corviknight. Include subscriber configuration in a
full Deploy walkthrough; scope run-only or polling-only tasks to their features.

1. Discover the existing service/revision, supported API, authentication and
   resource authorization, selected AWS profile, account and region. Separate
   required, implemented and observed capabilities. Do not guess route names.
2. Select the requested feature pieces and dependencies. Explain each with a
   synthetic fixture. Use a baseline, materially different supported configuration,
   invalid/unauthorized input and relevant replay/recovery cases inside each piece;
   use four as a full walkthrough floor, not a fixed count or a quota for narrow work.
3. Sign requests to the discovered Deploy API using the selected credentials; submit a validated artifact with supported parameters and follow status to actual CloudFormation completion. Keep installation history/keys in the verified subscriber component. Do not use old token-deploy payloads or bypass Deploy with direct stack edits.
4. Configure Puller subscriptions and supported polling schedules through its
   existing API. Compare AUTO and PAUSED behavior, manual and scheduled reconcile,
   installed versus desired versions, and recovery from a missed update. Use
   discovered pause/resume/retry and subscription-retirement operations; verify
   installed state changes only after terminal run success. Do not create a cron
   job, edit DynamoDB or change EventBridge directly to bypass a missing API.
5. Use the deployment's verified test adapters for external effects. If it lacks
   a safe test mode or required capability, leave that check pending and hand a
   redacted reproducer to `corviknight`. Do not edit service code, write internal storage,
   or silently fall back to direct AWS mutations to pass a configuration check.
6. Give the user one copyable API invocation, expected result and at most three
   steps to inspect its actual AWS logs/workflow. Have them run the baseline and
   variant, read back results and return redacted IDs and observations. Wait for
   that evidence before advancing; request acceptance is not async completion.
7. Keep secrets in the approved local credential channel. Verify live effects
   are covered by the requested scope and record cleanup without removing shared
   resources. Keep mocked execution distinct from actual dependency readiness.

Own Puller as a subscriber component of Deploy. Keep its subscriptions, polling schedules, desired state, installation history and subscription secrets separate from the stateless SigV4 run API. Packages or stacks may remain separate; both belong to Corviknight/Skarmory. Keep Marketplace on catalog/publication and Environment on first installation.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder handoffs.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Verify provider/API prerequisites and operate installation, read-back, retry and retirement through supported APIs.
