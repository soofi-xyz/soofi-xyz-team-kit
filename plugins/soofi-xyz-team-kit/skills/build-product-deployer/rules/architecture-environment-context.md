---
title: Environment Context
impact: CRITICAL
tags: [architecture, context, cdk]
---

# Environment Context

The Deployer resolves and injects exactly one object into every CDK app: `EnvironmentContext`. Products consume it through `MarketplaceProduct.ctx`. Do NOT introduce alternative injection paths.

## Schema (v1)

```ts
type EnvironmentContext = {
  contextSchemaVersion: '1';

  // Identity of the deploy target
  envSlug: string;
  tenantAccountId: string;
  region: string;
  customerId: string;
  envId: string;

  // Domain handles (sourced from build-tenant-domain-router)
  domain: {
    subdomain: string;
    hostedZoneId: string;
    certificateArn: string;
    certificateArnUsEast1: string;
    apiGatewayDomainName: string;
    apiGatewayDomainAlias: string;
    apiGatewayDomainAliasZoneId: string;
  };

  // Identity handles (sourced from build-tenant-account-manager)
  identity: {
    introspectionEndpoint: string;
    authorizerArn: string;
  };

  // Per-component overlays
  basePath?: string;
  secretsPrefix: string;

  // Marketplace metadata
  componentName: string;
  componentVersion: string;
  releaseId: string;
};
```

## Resolution Order

When the Deployer assembles context for an intent:

1. Read `Environments[env_id]` from Account Manager API → fills identity, region, tenantAccountId, slug.
2. Read `/environments/{env_slug}/handles` from Domain Router API → fills `domain`.
3. Read SSM `/marketplace/auth/authorizer-arn` and `/marketplace/auth/introspection-endpoint` → fills `identity.*`.
4. If `basePathRequired`, call `POST /environments/{env_slug}/base-paths` → fills `basePath`.
5. Compute `secretsPrefix` from environment + componentName.
6. Validate the assembled object against the Zod schema for `contextSchemaVersion`.

Resolution is its own Step Function state; it MUST be idempotent and cached for 60 seconds keyed by `env_slug` (other attributes are stable).

## Schema Versioning

- `contextSchemaVersion` is incremented on **breaking** field changes only.
- Products pin the version they accept in `marketplace.json`. The Deployer refuses to deploy a component whose pinned version is not currently supported.
- Add new optional fields without bumping; bump only on rename / removal / type change.

## Rules

1. **One object, one context key (`marketplaceContext`).** No spreading values across multiple keys.
2. **Validate at boundaries.** The Deployer validates before injecting; `MarketplaceProduct.ctx` validates on read.
3. **No mutability.** Products MUST NOT modify `ctx` at runtime; treat as `readonly`.
4. **No environment lookups inside `synth`.** No SSM, no Secrets Manager, no API calls during `cdk synth`. The synth output must be pure given `marketplaceContext`.
5. **Reject deploys with mismatched schema versions.** Fail loudly, not silently.
