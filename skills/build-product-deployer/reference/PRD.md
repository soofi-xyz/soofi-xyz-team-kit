# Deploy implementation scope

Use **Deploy** as the product name, Corviknight as builder and Skarmory as configurer.
Deploy owns deployment execution, the shared configuration-bundle installer and
the Puller subscriber component. Follow
[the capability map](../../guide-product-work/reference/iterations/deploy.md) and
[synthetic test data](test-data.md) for feature increments and user/AWS checks.

## Product components

- **Run service:** accept validated deployment requests, execute artifacts and
  expose correlated run status/results. Keep it stateless with respect to
  subscriber desired state, installation history and subscription secrets.
- **Configuration installer:** reuse shared providers and typed Transform, Connect
  and System API adapters across configuration bundles. Own durable operation
  receipts and partial-failure recovery separately from subscriber state. Load
  [the configuration-bundle contract](configuration-bundles.md); do not ship a
  custom installer Lambda in each bundle.
- **Puller:** own subscriptions, periodic/manual catalog polling, desired/pending/
  installed versions, dependency-aware updates, installation history, update
  controls and recovery. Keep that state in this Deploy-owned component; separate
  packages, APIs or stacks do not make Puller a separate product.

Load [the Puller skill](../../build-marketplace-puller/SKILL.md) and
[subscriber contract](../../build-marketplace-puller/reference/PRD.md) when building
or configuring subscriber features. Include them in full-product planning. A
complete run API by itself does not complete the Deploy product.

## Run interface

The supplied comparison describes a small IAM SigV4 service with `POST /deploy/run`
and run-status retrieval. Inspect the target revision for exact auth, request,
artifact and status shapes. Do not infer them from historical token-deploy APIs.
Preserve working contracts; record unsupported capabilities as implementation gaps.

Verify selected AWS profile, account/region, caller permissions and artifact/target
scope before writes. Validate supported artifact identity, parameters, digests and
asset policy; test terminal results against actual stack events. Reuse current
execution machinery. Do not add old review, token-deploy or rollback routes merely
to satisfy a subscriber reference. Discover supported retry/idempotency behavior;
never turn uncertain submission into a blind second deployment.

## Subscriber behavior and boundaries

Implement Puller HTTP operations for subscriptions, polling configuration,
manual reconcile, update control and status/history. Use the current Marketplace
catalog/release contract; published artifacts need not imply a Build service call.
Keep polling operational without notifications. If supported, publication events
feed the same deduplicated update path as polling.

Keep Marketplace on catalog, review, publication and its supported notifications.
Keep Account on identity, provisioning and service-key lifecycle. Environment
bootstraps the run service and installs the Puller component, then hands ongoing
subscriber behavior to Deploy. Puller requests execution through the run API;
it does not deploy CloudFormation directly or acquire cross-tenant authority.

## Acceptance

Verify each selected feature through its component's authenticated HTTP API,
including submission/status/results for async work. Use local fakes first, then
actual test API/workflow executions with controlled adapters. Test baseline,
supported variant, invalid/unauthorized input and relevant concurrency/recovery
cases within each piece. Wait for user-run API and AWS observations before the
next piece. Report local tests, synthesis, deployed mocked runs and authorized
live effects separately. A bundle becomes installed only after terminal execution
success; a poll or submission response alone does not prove readiness.
