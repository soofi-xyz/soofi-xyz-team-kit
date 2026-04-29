---
title: CDK Product Contract
impact: CRITICAL
tags: [integration, cdk, contract, product-sdk]
---

# CDK Product Contract

A "product" is a CDK app that satisfies this contract. Anything else cannot be deployed by the Deployer.

## Required Files

```
my-product/
├── marketplace.json          # component manifest (see below)
├── cdk.json                  # `"app": "npx ts-node bin/app.ts"`
├── bin/app.ts                # entrypoint
├── lib/                      # stacks/constructs
└── package.json              # depends on @marketplace/product-sdk
```

## Component Manifest (`marketplace.json`)

```json
{
  "componentName": "analytics-api",
  "contextSchemaVersion": "1",
  "adapter": "stackset",
  "basePathRequired": true,
  "identityRequired": true,
  "regions": ["us-east-1", "eu-west-1"]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `componentName` | yes | lowercase kebab-case |
| `contextSchemaVersion` | yes | the only `EnvironmentContext` version this product understands |
| `adapter` | yes | `stackset` \| `assume-role-cfn` |
| `basePathRequired` | yes | if true, the Deployer reserves a base path before synth |
| `identityRequired` | yes | if true, the product imports the shared authorizer |
| `regions` | yes | allowed regions; deploys to other regions are rejected |

## Required Entrypoint Shape

```ts
// bin/app.ts
import { App } from 'aws-cdk-lib';
import { MarketplaceProduct } from '@marketplace/product-sdk';
import { MainStack } from '../lib/main-stack';

const app = new App();

const product = new MarketplaceProduct(app, 'AnalyticsApi', {
  componentName: 'analytics-api',
});

new MainStack(product, 'Main', { ctx: product.ctx });

app.synth();
```

## Guarantees from `MarketplaceProduct`

The `MarketplaceProduct` construct gives the product, for free:

- A typed `ctx: EnvironmentContext` accessor with runtime validation.
- Stack environment set to `{ account: ctx.tenantAccountId, region: ctx.region }`.
- Stack name set to `<componentName>-<envSlug>`.
- Mandatory tags applied to all resources: `marketplace:component`, `marketplace:version`, `marketplace:env_slug`, `marketplace:customer_id`.
- Imported references for the auth Lambda authorizer (when `identityRequired`).
- Imported references for the API Gateway custom domain (when `basePathRequired`).

## Forbidden Patterns

- ❌ Reading `process.env` for any environment-specific value during synth.
- ❌ Reading SSM Parameter Store at synth time. (Reading it at *runtime* inside a Lambda is fine.)
- ❌ Hard-coding account IDs, regions, domains, or stack names.
- ❌ Creating ACM certificates, custom DNS, or API Gateway `DomainName` resources. Use the handles in `ctx.domain`.
- ❌ Implementing your own API key store. Import the authorizer from `ctx.identity.authorizerArn`.
- ❌ Multiple CDK apps under one component.

## Rules

1. **The contract is enforced at register time.** The marketplace registry runs a static validator on the uploaded artifact. Components that fail are rejected.
2. **`@marketplace/product-sdk` is the only sanctioned way** to read `marketplaceContext`. Reading it manually with `app.node.tryGetContext` is forbidden because it bypasses validation.
3. **Stack name is computed, not chosen.** Producers MUST NOT override it.
4. **All resources MUST be in the stack with name `<componentName>-<envSlug>`.** Multi-stack apps are not supported in v1.
