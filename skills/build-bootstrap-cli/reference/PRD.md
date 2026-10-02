# Environment implementation contract

Use **Environment** as the product identity, Torterra as builder and Shaymin as
configurer. Treat this contract as requirements; discover the target repository,
revision and deployed interfaces before implementation or invocation. Bootstrap
is the existing setup adapter, not a separate product or proof of an HTTP service.

## Product surface

Deliver an authenticated HTTP API for environment planning, setup submission,
status/results, shared endpoint configuration and recovery. Authorize each caller
for the target account/environment, validate requests and return correlated errors.
Discover existing routes or implement missing ones in the target service; this
contract does not assert route paths, deployment topology or current availability.
Expose async status and results through the API, with AWS execution/log correlation.

Preserve supported `bootstrap plan`, `bootstrap environment`, `bootstrap resume`,
`bootstrap status` and `bootstrap version` behavior as CLI adapters. Reuse the same
validation/execution modules; keep CLI-only setup evidence separate from HTTP
acceptance. Do not build parallel orchestration engines.

## Ownership

- Account owns identity, underlying AWS account provisioning, canonical DNS/zone
  and certificate inventory, service-key lifecycle and bootstrap-manifest output.
- Environment owns setup plans, shared API Gateway domain/usage-plan resources,
  non-secret environment defaults, endpoint attachment coordination and readiness.
  Consume Account-owned domain/certificate inventory; reconcile routing aliases
  through the supported Account integration rather than creating competing zones.
- Marketplace owns catalog/bundle discovery, review and publication.
- Deploy owns execution of validated deployment artifacts once available. Preserve
  its current stateless SigV4 run/status contract.
- Deploy owns the subscriber-side Puller component, including installation
  history, subscription secrets, subscriptions, polling and local reconciliation.
  Corviknight builds it and Skarmory configures it. Environment installs it; keep
  its state separate from the stateless run service without creating another product.
- Product stacks own their endpoint mapping resources under Environment's shared
  routing contract. Reject a conflicting path claim rather than overwrite it.

## Inputs and discovery

Verify the selected AWS profile with STS and explicitly confirm region and account
against the Account manifest before any AWS write. Reuse the verified profile;
show commands with `AWS_PROFILE=<selected-profile>`, never a personal profile.

Discover Account's bootstrap-manifest operation (the reference uses
`GET /accounts/{account_id}/bootstrap-manifest`) and validate the supported schema.
Require identity, AWS account, domain/zone, a certificate for the selected region,
service-key identifier when the target routing contract requires it, deployment
regions and system-component coordinates. Refuse an incomplete or mismatched
manifest before setup. Retrieve secret material only through authorized Account
operations into the approved local secret channel.

Resolve valid Marketplace bundles and pin component, bundle and artifact identity
for the plan. Validate size, safe archive paths, component/type, Build manifest,
assembly/template/asset digests and supported runtime asset policy. Reject raw
credentials, source/lifecycle commands and incompatible artifact formats. Never
infer current Deploy request fields from old token-deploy examples.

Preserve verified non-secret output contracts used by existing products:

| Output | Ownership / handling |
| --- | --- |
| Manifest-selected domain configuration SSM parameter | Environment writes resolved API Gateway domain handles; Account supplies zone/certificate identity |
| `/account/shared-usage-plan-id` or verified manifest override | Environment creates/discovers one supported shared plan and binds the Account key; products attach their own stages |
| `/account/env-parameters` or verified manifest override | Environment stores non-secret shared handles/defaults; never keys or signed URLs |

These reference parameter names are compatibility contracts to verify, not a
requirement to force API-key usage onto a SigV4-only Deploy implementation.

## Feature behavior

1. **Plan:** read and validate Account/Marketplace inputs, check target scope,
   inspect artifacts and show pinned versions, intended resources and non-secret
   parameter names. Planning and dry-run perform no provisioning writes.
2. **Shared routing:** create or reuse supported API Gateway domain and shared
   usage-plan resources from existing domain/certificate inventory. Preserve
   stage/key binding ownership and published handles; verify existing resources
   agree with account, domain and region before adopting them.
3. **First Deploy install:** use the operator-run Bootstrap adapter only for the
   manifest's Deploy component when its API does not exist. Share Deploy's artifact
   validation, parameter rendering and deployment modules. Display the affected
   stack plan and verify account/region before writes. Do not offer arbitrary
   local product deployment after Deploy is available.
4. **Subscriber handoff:** invoke the verified current Deploy run API using its
   actual auth and payload, follow run status, then check readiness of the Deploy-owned
   Puller component. Hand ongoing subscriptions, polling and recovery to Corviknight/Skarmory.
   Do not use `/infra-deployer/deploy-by-token` from superseded instructions.
5. **Product endpoints:** coordinate supported route claims and read-back against
   the shared domain. Keep product-owned mapping resources with their stack;
   refuse path collisions and unauthorized changes before mutation.
6. **Resume/status:** expose observable progress and recovery without blindly
   replaying completed effects. Re-resolve credentials and signed URLs; pin prior
   bundle identity or explicitly reject changed inputs under the current contract.
   Inspect existing stack operations before retrying interrupted deployment.

The cold-start CLI may execute before an Environment endpoint is available.
Define and test how its non-secret result is adopted/read back through the API;
select the Environment service placement from the target architecture. Do not
assume a central deployment or provision a duplicate service. A successful CLI
run alone leaves the product's API acceptance pending.

## State, errors and security

Persist only non-secret resume metadata: schema version, account/environment
identity, bundle identities, stack/run IDs, completed steps and update time.
Store API-managed status using the target's supported persistence; keep subscriber
installation state in Deploy's Puller component, separate from the run service.
Do not trust persisted signed URLs or secrets.

Return stable errors for missing input, incomplete manifest, account/region
mismatch, invalid bundle, path conflict, unsupported local component, health
timeout and failed deployment. Include a safe correlation ID and remediation.
Normalize the CLI exit and HTTP error behavior around the same domain errors.

Redact API keys, authorization headers, credentials, service keys, signed URLs,
subscription signing secrets and session tokens from logs, state and evidence.
Do not add unsafe URL-printing options. Noninteractive flags do not bypass scope,
bundle or authorization checks. Guard cleanup so it cannot remove shared resources
or accounts merely to finish a test.

## Verification

Follow the [capability map](../../guide-product-work/reference/iterations/environment.md)
and [test data](test-data.md). Test HTTP authorization, read-back/status,
manifest/bundle rejection, idempotent shared-resource behavior, route conflicts,
first-install restriction, current Deploy handoff, secret redaction and resume.
Use dependency fakes first; then invoke the actual test API/workflow with controlled
adapters. Give the user one invocation and at most three AWS inspection steps
for every piece; wait for observed feedback before implementing the next piece.
Distinguish local tests, synthesis, deployed mocked execution and authorized live
resources. Finish with cumulative selected-feature acceptance and explicit gaps.
