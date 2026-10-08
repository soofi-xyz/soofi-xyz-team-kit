# Deploy capability map

Use Corviknight to implement Deploy, including the configuration installer and
Puller, and Skarmory to configure existing run, configuration-installation and
subscriber capabilities. Follow the [shared workflow](../../SKILL.md).
These 16 areas are a starting inventory, not a fixed iteration count. Order dependencies and split
independently useful features further. Use at least four pieces for a full-product
build; narrow work selects only relevant pieces. Keep automated tests and user/AWS
feedback inside each piece, not as a final testing phase.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `single-stack` — run a validated simple deployment | Verified SigV4 run/status contract and a pinned Build fixture | Deliver authenticated minimal run/status/result for a no-asset stack using fake CloudFormation first. Reject wrong-account callers, bad digests and unsupported artifact shapes before writes. | Correlate API run to worker/workflow and terminal stack result. Verify signed caller scope and zero writes for rejected artifacts; distinguish mocked stacks from real resources. |
| `assets` — publish and deploy verified file assets | Single-stack path and Build asset manifest | Deliver validated asset publication and references for a stack with a small runtime asset. Vary object versions and inject hash/policy mismatch or upload failure. | Inspect artifact checks, publishing logs and resulting stack asset references; confirm unverified bytes never deploy and secrets stay out of logs. |
| `parameters-ordering` — deploy parameterized stack dependencies | Validated artifact execution | Deliver supported target parameter rendering and stack order for multi-stack assemblies. Compare two parameter sets, missing required input and failed predecessor. | Inspect resolved non-secret inputs and CloudFormation order; confirm account/region scope and that dependent stacks do not run after a failed prerequisite. |
| `failure-diagnostics` — explain incomplete deployment runs | Run and stack status | Deliver detailed status/result correlation for stack failure, timeout and supported CloudFormation rollback outcomes. Exercise missing run IDs and unauthorized reads as well as failed execution. | Compare API terminal result with actual stack events and logs; do not convert CloudFormation rollback into a newly invented rollback API or report a partial run as success. |
| `retry-recovery` — retry under the current run contract | Selected execution features | Deliver documented duplicate/retry behavior and reconciliation after interrupted execution without adding subscriber state to the run service. Test repeated same-input and changed-input requests; if idempotency is unsupported, report that limit and inspect before resubmitting. | Compare run IDs, resource effects and subscriber-owned installation history. Verify recovery respects current stack state; no automatic destroy or blind duplicate deployment. |
| `configuration-provider` — reuse one installer across bundles | Run/asset execution and Environment provider installation | Deliver the shared provider and typed Transform, Connect and System adapters; install two synthetic bundles against controlled APIs. Reject incompatible providers, wrong namespaces and tampered payloads. | Trace run to provider/API calls; verify shared provider reuse, no per-bundle Lambda and no configuration writes on failed preflight. |
| `configuration-apply` — install configurations and references | Provider and verified target configuration APIs | Deliver validation, stable identities, dependency ordering and completion/read-back. Change configuration while provider/service code stays fixed; preserve target API version/conflict semantics and activate entrypoints last where supported. | Inspect applied IDs/revisions and digest changes; no early installed state or implicit business runs. Keep consumer readiness separate from registration. |
| `configuration-recovery` — reconcile partial application | Configuration apply and API replay/read-back | Deliver durable operation receipts and recovery for duplicate delivery, lost responses, concurrent ownership claims and a failed successor. Preserve prior installed identity while exposing partial new effects. | Inspect target API state and provider receipts before retry; compare effect counts, reject conflicting changes and do not claim cross-API atomic rollback. |
| `configuration-retirement` — retire owned configuration effects | Configuration ownership and dependency references | Deliver supported deactivation/removal or prior-revision restoration, preserving shared and externally owned configurations. Exercise failed Create cleanup, unsupported compensation and retained versions. | Compare API results and remaining references; distinguish unsubscribe, stack deletion and actual configuration reversal. Report unsupported operations as gaps. |
| `puller-subscriptions` — manage tenant subscriptions | Verified Puller HTTP/auth contract | Deliver local subscription create/read/update and root/dependency identity with secure credential references. Compare two components and two callers; reject conflicting or cross-tenant operations. Keep Account service-key ownership. | Inspect API and subscription-state writes; read back selected components and policy, verify ownership and redaction. Do not require an unsupported Marketplace subscription endpoint. |
| `puller-polling` — discover updates on a schedule or on demand | Local subscriptions and verified Marketplace release reads | Deliver supported schedule configuration and manual reconcile/status with per-component decisions. Use controlled catalog releases; compare in-sync, newer eligible and failed/unreviewed bundles, throttling and a missed notification. | Invoke the Puller API, inspect the actual scheduler-triggered/reconcile workflow and compare desired/pending/installed versions. Polling works without webhooks; a queued update is not installed. |
| `puller-updates` — install subscribed releases and dependencies | Polling decisions and run execution | Deliver dependency-aware claims, SigV4 run submission and terminal state updates. Compare independent/shared dependencies, duplicate triggers and a failed predecessor; refresh expired artifact access without changing pinned identity. | Trace subscription/reconcile to run and stack results; verify dependencies finish before their target, one pending claim exists, and installed identity advances only on success. |
| `puller-notifications` — accelerate updates with supported notifications | Verified Marketplace notification support and shared update path | Deliver optional authenticated notification ingress using the actual event contract. Exercise valid/tampered, duplicate, late and missing events; use the same claim path as polling. Defer this feature if notifications are unsupported. | Inspect ingress/auth/dedupe and resulting reconcile/run IDs; verify no repeated update or downgrade, and polling still catches up when all events are lost. |
| `puller-recovery` — recover subscriber run state | Durable claims and run status | Deliver restart/status reconciliation and durable installation history. Simulate response loss after accepted submission, worker restart, status timeout and repeated terminal outcomes. Surface unresolved submission if the run contract cannot identify it. | Inspect recovery workflow and authoritative run state; retain previous installed version on failure, prevent stale completion from overwriting a new claim, and never blindly resubmit uncertain work. |
| `puller-controls` — control automatic updates and explicit retry | Observable subscribed updates | Deliver pause/resume and supported retry/redeploy policy through the API. Compare AUTO/PAUSED, already-running work and repeated failed-bundle polls; resume against current eligible state. | Inspect control request and next scheduled/manual reconcile; paused updates do not start new runs, repeated failures remain suppressed until allowed, and explicit retry records its result. |
| `puller-retirement` — retire subscriptions and report remaining resources | Subscriptions, dependency references and run history | Deliver retirement that stops future updates and prunes only unneeded dependency references/secrets. Compare a shared dependency and pending run. For scoped uninstall, use supported removal execution or report the missing capability; unsubscribe alone leaves installed resources intact. | Inspect subscription/dependency cleanup and any authorized removal result. Preserve shared resources and truthful installed state; never report safe account disable with remaining resources or unresolved runs. |

Keep `puller-controls` and `puller-retirement` as separate increments: controls
retain the subscription and change update behavior; retirement removes references
and may clean up secrets or require resource-removal evidence.

Read [the product contract](../../../build-product-deployer/reference/PRD.md) and
[synthetic test data](../../../build-product-deployer/reference/test-data.md).
Load [the Puller skill](../../../build-marketplace-puller/SKILL.md) and
[subscriber contract](../../../build-marketplace-puller/reference/PRD.md) for the
subscriber features. A full-product plan must cover run execution, the shared
configuration installer and Puller; selecting only the run API areas leaves Deploy
incomplete. Record unsupported optional
notification or scoped removal capabilities explicitly rather than fabricating them.
Discover actual routes, auth, statuses and test adapters from the target revision.
Exercise each piece through the HTTP API, including submission/status/results for
async work. Direct AWS inspection supports evidence; it does not replace API use.
Start with faked dependencies, then run the real test-stack API/workflow using those
fakes. Use live dependencies only within authorized scope. Give one invocation and
at most three AWS inspection steps, collect the person’s redacted ID and observation,
and wait for that feedback before implementing or configuring the next piece.
Keep local tests, synthesis, deployed mocked execution and live effects distinct.

Own Puller as a subscriber component of Deploy. Keep its subscriptions, polling schedules, desired state, installation history and subscription secrets separate from the stateless SigV4 run API. Packages or stacks may remain separate; both belong to Corviknight/Skarmory. Keep Marketplace on catalog/publication and Environment on first installation.

For configuration installation, load [the shared contract](../../../build-product-deployer/reference/configuration-bundles.md)
and its synthetic acceptance matrix. These additions are requirements to verify,
not claims about an existing provider deployment.
