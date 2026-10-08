# Environment capability map

Use Torterra to implement Environment and Shaymin to configure existing
capabilities. Follow the [shared workflow](../../SKILL.md). These 7 areas are a
starting inventory, not a fixed iteration count. Order dependencies and split
independently useful features further. Use at least four pieces for a full-product
build; narrow work selects only relevant pieces. Keep automated tests and user/AWS
feedback inside each piece, not as a final testing phase.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `plan` — inspect and validate a setup plan | Verified Account manifest and Marketplace read contracts | Deliver authenticated plan/read-back using the Account identity/AWS-access manifest, desired domain/region inputs and pinned bundles; compare complete/incomplete manifests, two regions and a caller from another account. Keep planning side-effect free. | Trace the API validation and dependency reads; confirm selected account, region, domain intent, pinned versions and zero provisioning writes. |
| `shared-routing` — prepare domains, certificates and endpoint resources | Valid plan and authorized domain inputs | Deliver idempotent Route 53/ACM lifecycle plus the shared API Gateway domain, usage-plan binding and supported routing metadata. Exercise a fresh domain, adopted compatible resources, missing validation and a path collision. Environment owns DNS/ACM lifecycle. | Inspect the correlated workflow, DNS validation, certificate state, API Gateway resources and non-secret SSM outputs; verify retries reuse owned resources and conflicts preserve existing resources. |
| `first-deploy` — close the cold-start gap | Validated plan and shared prerequisites | Deliver the constrained Bootstrap adapter for the first Deploy install and Environment API status/read-back. Compare an absent Deploy service, an already healthy one and failed first install. Reuse artifact validation without creating a second deployment engine. | Inspect authorized CloudFormation events and API health/status. Record how first-install output becomes visible to the Environment API; a CLI-only result leaves HTTP acceptance pending. |
| `subscriber-handoff` — make the environment self-deploying | Healthy Deploy API and pinned subscriber bundle | Deliver subscriber installation through current Deploy and readiness verification. Vary supported bundle versions and inject unhealthy subscriber output. Keep subscriber keys/history in Deploy's Puller component, separate from its run service. | Follow Environment request to Deploy run and subscriber health/read-back. Confirm an accepted Deploy run is not reported as a ready environment. |
| `product-endpoints` — attach and inspect product routes | Shared routing and an installed test product | Deliver supported endpoint registration/read-back and conflict handling for product-owned mappings. Exercise distinct paths, a duplicate claim and an unauthorized owner. Reuse Environment domain metadata. | Inspect route ownership, API Gateway mapping and a test API request; verify conflicts do not overwrite an existing product endpoint. |
| `resume` — recover interrupted setup | The selected setup capabilities | Deliver status, resumable progress and recovery for interrupted setup without replaying completed effects. Exercise pre/post-install failure and changed manifest/bundle input. Resume only under the discovered contract. | Compare original and resumed runs, effect counts and readiness. Verify resume metadata excludes keys, credentials and signed URLs; report cleanup of only owned test resources. |
| `configuration-provider-readiness` — prepare shared configuration installation | Healthy Deploy and pinned provider/service prerequisites | Install Deploy's shared provider through the supported setup path; compare absent, compatible and incompatible providers plus missing target API access. Avoid a provider self-install dependency. | Follow Environment to Deploy status; verify account/region, provider contract and scoped API discovery/access before readiness; no per-bundle Lambda. |

Read [the product contract](../../../build-bootstrap-cli/reference/PRD.md) and
[synthetic test data](../../../build-bootstrap-cli/reference/test-data.md).
Discover actual routes, auth, statuses and test adapters from the target revision.
Exercise each piece through the HTTP API, including submission/status/results for
async work. Direct AWS inspection supports evidence; it does not replace API use.
Start with faked dependencies, then run the real test-stack API/workflow using those
fakes. Use live dependencies only within authorized scope. Give one invocation and
at most three AWS inspection steps, collect the person’s redacted ID and observation,
and wait for that feedback before implementing or configuring the next piece.
Keep local tests, synthesis, deployed mocked execution and live effects distinct.

Keep identity, keys, the backing AWS account record/provisioning and bootstrap
manifest with Account. Environment consumes that manifest and owns domains,
certificates, shared routing and initial platform-installation readiness. Consume
Marketplace bundles and let Deploy execute product installations after its first
install. Treat Bootstrap as an Environment adapter, not another product. Install
Deploy's Puller component and hand ongoing subscriptions, polling and recovery to
Corviknight/Skarmory; Environment does not implement those subscriber capabilities.

For configuration-bundle work, follow [the shared installer contract](../../../build-product-deployer/reference/configuration-bundles.md).
Keep the new lifecycle/provider requirements distinct from observed deployment support.
