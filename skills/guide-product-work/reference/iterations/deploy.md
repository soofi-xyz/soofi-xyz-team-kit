# Deploy capability map

Use Corviknight to implement Deploy and Skarmory to configure existing
capabilities. Follow the [shared workflow](../../SKILL.md). These 5 areas are a
starting inventory, not a fixed iteration count. Order dependencies and split
independently useful features further. Use at least four pieces for a full-product
build; narrow work selects only relevant pieces. Keep automated tests and user/AWS
feedback inside each piece, not as a final testing phase.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `single-stack` — run a validated simple deployment | Verified SigV4 run/status contract and a pinned Build fixture | Deliver authenticated minimal run/status/result for a no-asset stack using fake CloudFormation first. Reject wrong-account callers, bad digests and unsupported artifact shapes before writes. | Correlate API run to worker/workflow and terminal stack result. Verify signed caller scope and zero writes for rejected artifacts; distinguish mocked stacks from real resources. |
| `assets` — publish and deploy verified file assets | Single-stack path and Build asset manifest | Deliver validated asset publication and references for a stack with a small runtime asset. Vary object versions and inject hash/policy mismatch or upload failure. | Inspect artifact checks, publishing logs and resulting stack asset references; confirm unverified bytes never deploy and secrets stay out of logs. |
| `parameters-ordering` — deploy parameterized stack dependencies | Validated artifact execution | Deliver supported target parameter rendering and stack order for multi-stack assemblies. Compare two parameter sets, missing required input and failed predecessor. | Inspect resolved non-secret inputs and CloudFormation order; confirm account/region scope and that dependent stacks do not run after a failed prerequisite. |
| `failure-diagnostics` — explain incomplete deployment runs | Run and stack status | Deliver detailed status/result correlation for stack failure, timeout and supported CloudFormation rollback outcomes. Exercise missing run IDs and unauthorized reads as well as failed execution. | Compare API terminal result with actual stack events and logs; do not convert CloudFormation rollback into a newly invented rollback API or report a partial run as success. |
| `retry-recovery` — retry under the current run contract | Selected execution features | Deliver documented duplicate/retry behavior and reconciliation after interrupted execution without adding subscriber state. Test repeated same-input and changed-input requests; if idempotency is unsupported, report that limit and inspect before resubmitting. | Compare run IDs, resource effects and subscriber-owned installation history. Verify recovery respects current stack state; no automatic destroy or blind duplicate deployment. |

Read [the product contract](../../../build-product-deployer/reference/PRD.md) and
[synthetic test data](../../../build-product-deployer/reference/test-data.md).
Discover actual routes, auth, statuses and test adapters from the target revision.
Exercise each piece through the HTTP API, including submission/status/results for
async work. Direct AWS inspection supports evidence; it does not replace API use.
Start with faked dependencies, then run the real test-stack API/workflow using those
fakes. Use live dependencies only within authorized scope. Give one invocation and
at most three AWS inspection steps, collect the person’s redacted ID and observation,
and wait for that feedback before implementing or configuring the next piece.
Keep local tests, synthesis, deployed mocked execution and live effects distinct.

Keep Deploy stateless with respect to subscriber desired state, installation history and keys. The subscriber-side Puller keeps that state; coordinate its current integration with Marketplace without adding a Puller product or putting its state into Deploy.
