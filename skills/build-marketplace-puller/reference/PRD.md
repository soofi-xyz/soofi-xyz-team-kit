# Deploy Puller component contract

Build and configure Puller as part of **Deploy**. Corviknight owns implementation;
Skarmory owns configuration through existing APIs. Keep the source skill path for
callers; it does not name another product. Follow the
[Deploy feature map](../../guide-product-work/reference/iterations/deploy.md),
[run contract](../../build-product-deployer/reference/PRD.md) and
[test data](../../build-product-deployer/reference/test-data.md).

Use this contract as requirements, not proof of a deployed service. Discover the
target revision, APIs/auth, state ownership and artifact contract before coding
or invoking operations. Preserve verified caller contracts. This scope replaces
obsolete mandatory Marketplace subscription, token-deploy and callback assumptions;
use Git history for superseded schemas and route examples.

## Ownership and execution

Keep execution, configuration installation and subscriber responsibilities within Deploy:

- The run service validates and executes artifacts using the current SigV4 run
  API and reports status/results. It does not own subscriber desired state.
- The shared configuration installer applies bundles through typed Transform, Connect
  and System API adapters and exposes per-resource results through the run contract.
  Keep its operation receipts distinct from subscriber state. Follow
  [the configuration-bundle contract](../../build-product-deployer/reference/configuration-bundles.md).
- Puller owns local subscriptions, polling schedules, desired/pending/installed
  bundle identities, dependency relationships, installation history, update policy
  and subscription secrets. It submits runs and reconciles their outcomes.

Keep Marketplace on catalog/review/publication and supported notifications, and
Account on identity, AWS account provisioning and service-key lifecycle. Consume
Account-managed credentials without minting or rotating those keys in Puller.
Environment installs the run service and then its Puller component, using shared
routing and Account inputs. Deploy owns ongoing subscriber behavior after that
handoff. Keep one component's subscriber state scoped to its tenant account;
do not add cross-tenant role assumption or central deployment fan-out.

Use TypeScript/CDK and the shared engineering standards. Implement durable polling,
dependency updates and recovery using the target's Step Functions workflows and
scheduler. Keep handlers bounded; do not create an in-process orchestration engine.
Use least-privilege roles, encrypted secret storage and explicit account/region
checks. Do not force old stack names, table schemas or fixed scheduling rates onto
an existing service; discover and preserve its supported contracts.

## Required API capabilities

Expose authenticated, tenant-authorized HTTP operations for these capabilities.
Discover exact routes and schemas; the list is not a claim of existing endpoints.
Keep existing separate run/Puller APIs usable while treating both as one product.

| Capability | Required result |
| --- | --- |
| Subscriptions | Create/read/update/retire local root subscriptions; expose component selection and supported update policy without returning secret values |
| Polling configuration | Read/change supported schedule and enablement; report effective configuration and next/last run where supported |
| Manual reconciliation | Start a scoped catalog check and retrieve correlated status, per-component decisions and errors |
| Component/install history | Read desired, pending and installed bundle identities, deployment run IDs, history and failure reason |
| Update control | Pause/resume and request an explicit retry/redeploy under the supported contract; report outcomes separately from acceptance |
| Retirement | Stop future updates, resolve in-flight work and release unneeded subscription/dependency references; separate unsubscribe from resource deletion |

Async operations expose submission, status and terminal results. Missing APIs go
to Corviknight; Skarmory must not substitute direct database, scheduler or stack
changes. API auth must include tenant/resource authorization, not just accepting
a key. Keep secrets, signed URLs and callback tokens out of returned state/logs.

## Subscription state

Model state using the target's schema with these distinctions:

- Root subscriptions identify what the operator wants managed. Dependency-managed
  entries record which roots need them; a component may be both root and dependency.
- Desired/released bundle identity is separate from installed identity. Track a
  pending bundle/run when an update is claimed; acceptance never advances installed
  state. Preserve the last successfully installed version after a failed update.
- Record subscription/component, reconcile run, deployment run, trigger and bundle
  IDs for traceability. Keep failure details, attempts and retry eligibility visible.
- Keep Account-owned service credentials separate from Puller-owned subscription
  or notification secrets. Store only secret references in ordinary records.

Create/update/retire through the Puller API. Validate ownership and conflict
semantics, support replay as the actual contract defines, and reject unauthorized
reads/writes. Retiring one root must retain dependencies still referenced by another
root or explicit subscription. Never invent a required remote Marketplace
subscription registry: create remote registrations only when the current supported
integration uses them, and then reconcile its state and secret lifecycle explicitly.

## Catalog polling and update decisions

Make scheduled and manual polling work with Marketplace catalog reads alone:

1. Load the selected active local subscriptions and their supported update policy.
2. Query the verified Marketplace release interface. Use only reviewed, deployable
   releases under its current status/version rules. Follow pagination, bounded
   concurrency and retry/backoff for throttling or transient failure. Record
   per-component failure without changing installed state or hiding other results.
3. Resolve dependency metadata using the current artifact contract. Compare the
   eligible desired bundle with installed, pending and last-failed identities.
4. Record a decision: in sync, already in flight, paused, blocked by dependencies,
   failed/retry suppressed, or eligible update. Keep paused components observable
   without scheduling a new deployment.
5. Atomically claim eligible component/bundle work before submitting execution.
   Concurrent manual/scheduled polls and notifications must converge on one pending
   intent. Re-read state after a lost claim; do not enqueue duplicate executions.
6. Return a reconciliation result with decisions and correlated update/run IDs.
   Poll completion means the check finished; separately expose installation results.

Use a supported configurable schedule and verify it in the target environment;
do not assume the previous hourly or fifteen-minute defaults are deployed.
Prevent unbounded automatic retries of the same failed bundle. Clear suppression
only under a defined policy, a newer eligible release or an explicit authorized
retry. Missing catalog/auth capabilities remain visible gaps, not a reason to
recreate Marketplace APIs or read its database directly.

## Dependency-aware update execution

Maintain dependency references from the current eligible bundle's dependency
closure. Detect cycles, incompatible/missing dependencies and invalid artifact
references before a target update. Deploy dependencies in the supported order;
shared dependencies must reuse an existing pending run or installed compatible
version. Do not start a target while a required predecessor is failed, paused or
incomplete. Recheck references when a release changes its dependency graph.

Resolve a current approved artifact reference, retaining pinned bundle identity
and digest. Refresh expiring access URLs through the supported Marketplace
interface without silently switching versions. Submit using the verified SigV4
run contract, persist its correlation and follow status. Keep artifact validation,
asset publication and CloudFormation execution in the run service.

Atomically close terminal outcomes: success advances installed identity and clears
that pending claim; failure preserves the previous installed identity and records
failure/suppression. Ignore stale completion for an older claim; accept identical
repeated terminal results idempotently and surface contradictory results.

Handle uncertain submission explicitly. If the caller loses the response after
the run service accepted work, reconcile using its supported correlation/status
or idempotency mechanism before retrying. Do not claim exactly-once execution if
the current run API cannot resolve the ambiguity; surface the gap for Corviknight
and leave the component pending for investigation instead of blind resubmission.

## Optional publication notifications

When Marketplace supports publication notifications, add an adapter that feeds
the same desired-state evaluation and atomic claim path as polling. Verify its
actual handshake, authentication, signature and event schema. Authenticate raw
bytes before parsing for HMAC contracts, including base64 proxy-body decoding;
deduplicate events and keep ingress independent of long deployment execution.

Treat late/replayed notifications as hints to resolve current eligible state.
Do not downgrade a component because an older event arrived last. Keep polling
working when every notification is lost. Do not add historical Marketplace
subscription routes to enable this optional adapter. If unsupported, record that
feature as deferred while completing polling-based operation.

## Recovery, controls and retirement

Reconcile pending installations after worker restart or lost status responses by
reading authoritative run status. Do not mark a still-running deployment failed
merely because a local wait budget elapsed. Bound each check, expose stale/unresolved
state and schedule further checks under the supported policy. Callbacks are optional
and used only if the current run service provides a verified authenticated contract;
status polling must be sufficient for completion and history.

Make pause/resume and explicit retry observable through the API. A pause prevents
new automatic work and does not pretend to cancel a deployment already running.
On resume, re-read desired and actual state before queuing work. Expose installed
history and the difference between current, pending, failed and paused updates.

Retire subscriptions without automatically destroying their resources. Stop
future scheduling/notifications where configured, inspect pending work, prune
unreferenced dependency entries and clean up only owned subscription secrets.
For an explicitly scoped uninstall, discover the supported execution contract,
order removal by dependencies and require terminal removal evidence before clearing
installed state. If the run service cannot remove resources, leave uninstall
pending as a builder gap; never call imaginary delete-by-token routes or issue
direct stack deletes as a configuration workaround. Do not report an account safe
for disable while managed resources or unresolved runs remain. Preserve shared
Environment routing, Account resources and Deploy itself during ordinary retirement.

## Verification and evidence

Implement tests inside each selected feature increment. Start with synthetic
subscriptions/releases and fake Marketplace/run-service responses; then invoke the
actual test API/workflows using those fakes. Cover baseline and materially different
supported configurations plus unauthorized calls, duplicate/concurrent triggers,
lost notifications, dependency failure, throttling, expired URLs, interrupted
submission, restart and retirement with shared dependencies. Assert request counts
and desired/pending/installed state, not only successful HTTP status.

Correlate API request, subscription/component, reconcile workflow and deployment
run in logs without secrets. For every piece, provide one user-run invocation,
expected result and at most three AWS inspection steps. Collect the person's
redacted IDs and observations before implementing the next piece. Distinguish
local fixtures, synthesis, deployed mocked execution and authorized live effects.
No product API, polling job or live update is established by editing this kit.
