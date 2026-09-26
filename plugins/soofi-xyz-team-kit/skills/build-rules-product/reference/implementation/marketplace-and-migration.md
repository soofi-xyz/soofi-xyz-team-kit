# Marketplace and migration requirements

This file describes the **target**, not a completed marketplace implementation.
Use [known gaps](known-gaps.md) and inspect the current deployment before changes.
Gallade owns the service; coordinate distribution with Regigigas and platform
changes with the corresponding product owner.

## Required source and artifact contracts

Add `marketplace/app.ts` and `marketplace.product.json` only as part of implementing
the Build/Deployer contract. Pass tenant account/region tokens and validated
`MarketplaceContext.customParameters`; never bake the Build account into templates.

Target declarative product manifest:

```json
{
  "component_id": "Rules",
  "component_name": "Rules",
  "bundle_type": "SERVICE",
  "context_schema_version": "1",
  "stacks": ["RulesStack"],
  "requires": { "domain": false, "shared_usage_plan": false, "identity": false }
}
```

Omit `base_path`: there is no public API Gateway mapping. Let Build synthesize the
CDK cloud assembly and Deployer publish assets/apply CloudFormation. Do not embed
product-owned deploy commands or execution hooks in the artifact manifest.

Require `cdk.out/manifest.json`, stack templates, staged assets and
`build/build.manifest.json`. Publish `artifact_kind=CDK_CLOUD_ASSEMBLY` and
`bundle_type=SERVICE` consistently in Build/Marketplace metadata; use the current
JWT-shaped `x-amz-meta-service-*` metadata contract. Validate HTTPS bundle reachability,
size limits and provenance against the current Build/Marketplace references before
publishing. Do not ship source directories or legacy executable bundle manifests.

## Dependencies and install parameters

Declare Persist and Lexicon runtime dependencies. The current Filter stack also
resolves their SSM discovery values during deployment, including Lexicon location
for IAM. Encode deployment ordering in the marketplace contract, or refactor that
discovery boundary first. Do not copy an empty deploy-time dependency list while
retaining these deployment-time lookups.

| Parameter | Target |
| --- | --- |
| `persistApiUrlSsmParam` | Default `persist-api-url` |
| `persistExecuteApiArn` | Scoped Persist API/method paths or equivalent verified grant |
| `persistSigningRegion` | Tenant region by default; explicit override only for a verified cross-region API |
| `lexiconRulesetsUriSsmParam` | Default `/lexicon/rulesets-uri` |
| `allowedInputS3Prefixes` | Authorized caller populations |
| `allowedRulesetS3Prefixes` | Authorized catalog/subset sources |
| `outputRetentionDays` | Explicit lifecycle policy; retain by default if omitted |
| `batchSize`, `maxConcurrency`, `maxRetries` | Validated worker defaults consistent with global capacity |
| `singleEntityProvisionedConcurrency` | Preserve warm alias support; tune against measured use |
| `singleEntityPersistTimeoutMs` | Validated budget after resolving the current 32-second/target 220-ms discrepancy |

Include the capacity, snapshot and writeback infrastructure in packaging and IAM
planning; the service is no longer only the original batch workers. Define runtime
activation and incident-integration configuration without inventing undeployed
SSM keys as existing discovery contracts.

## Compatible public migration

| Current | Target |
| --- | --- |
| `@soc/filter` | `@soc/rules` or agreed internal package identity |
| `FilterStack` / Filter state machine naming | Rules public identity; preserve physical resources through migration |
| `filter-workflow-state-machine-arn` | Add `/rules/workflow/state-machine-arn`; keep the legacy pointer for current callers |
| `/rules/sync/evaluator-function-arn` | Already implemented; preserve qualified alias behavior |
| `filter/...` output prefixes | `rules/...` for migrated/new contracts after consumers can handle both |
| `project_name=filter` | `sc:service:name=rules`, `sc:product:name=Rules` |
| Filter metric dimensions/services | Rules dimensions with coordinated dashboard/consumer migration |
| Node 22 | Node 24 after parser/ESM/bundling verification |
| Hardcoded `us-east-2` | Verified tenant region across every signing and deployment path |

Add the batch discovery alias as a small compatible step. Do not rename stateful
CDK constructs or replace retained buckets/tables merely to align vocabulary.
Inventory consumers of output paths, metric dimensions, capacity discovery and
workflow ARNs before changing any of them.

## Completion evidence

Require fresh-tenant synth/install with prerequisites, existing-install migration
without unintended replacements, scoped access tests, batch and sync smokes,
snapshot/capacity/writeback coverage, and verified downstream discovery. Keep
marketplace publication and production rollout evidence distinct from local tests.
