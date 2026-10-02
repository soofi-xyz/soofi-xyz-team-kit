---
name: build-marketplace-puller
description: "Build or configure Deploy's Puller component: subscriptions, catalog polling, dependency updates, installation history and recovery. Use Corviknight for implementation and Skarmory for existing-service configuration."
disable-model-invocation: true
---

# Deploy Puller component

Use `corviknight` to build Puller and `skarmory` to configure its existing APIs.
Puller is part of **Deploy**, even when packaged or installed separately from the
run service. Include its relevant capabilities in a full Deploy plan; do not leave
subscriber implementation unassigned or create a separate product/agent pair.

Load [guide-product-work](../guide-product-work/SKILL.md),
[the Deploy capability map](../guide-product-work/reference/iterations/deploy.md),
[the subscriber contract](reference/PRD.md) and
[Deploy test data](../build-product-deployer/reference/test-data.md).
Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md) to code.
Read [the run contract](../build-product-deployer/reference/PRD.md) before changing
handoffs, and [Marketplace's current scope](../build-saas-marketplace/reference/PRD.md)
when discovering releases or handling notifications.

1. Discover the target revision, installed components, API/auth contracts,
   subscriber state, selected AWS profile, account and region. Treat requirements
   as build scope until implemented and observed. Reuse supported contracts.
2. Keep subscription records, polling schedules, desired/pending/installed versions,
   installation history and subscription secrets in the Deploy-owned Puller
   component. Keep the run API stateless with respect to that subscriber state.
   Preserve Account ownership of tenant identity and service credentials.
3. In build mode, implement each selected Puller feature through authenticated
   HTTP operations, with async status/results and correlation. Use supported
   Marketplace catalog reads for scheduled/manual polling. Coordinate deployment
   through the current SigV4 run/status API; never add a second stack executor.
4. Add notification intake only where the current Marketplace supports it.
   Polling must operate without webhooks or old Marketplace subscription routes.
   Do not restore token-deploy, callback or delete routes from obsolete examples.
5. In configure mode, use only deployed APIs for subscriptions, schedules, update
   policy, reconcile, pause/resume/retry and retirement. Hand missing capabilities
   to Corviknight. Do not write DynamoDB or alter schedules directly to pass a test.
6. Use synthetic releases and fake Marketplace/run-service responses first.
   Test supported variants, auth failures, duplicates, concurrent triggers,
   missing notifications, upstream failures and worker restart inside each piece.
   Run the actual test API/workflow with those adapters before authorized live use.
7. Give one API invocation, expected result and at most three AWS inspection steps.
   Have the user run the baseline and variant and return redacted IDs and their
   observation. Wait for that evidence before implementing/configuring the next
   piece. A scheduled poll, queued update or accepted run is not an installed version.

Environment installs the Deploy components and checks initial readiness. Deploy
owns their subsequent operation. Return implementation/configuration changes,
expected/actual state, automated and user/AWS evidence, cleanup and remaining gaps.
