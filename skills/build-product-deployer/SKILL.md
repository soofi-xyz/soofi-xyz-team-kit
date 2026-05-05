---
name: build-product-deployer
description: "Guides building the Product Deployer — a standalone marketplace product that defines the common interface every other product implements, owns the CDK input contract, and is the single component that actually runs `cdk synth` / deploys CloudFormation into target accounts. Covers the standard CDK app shape every product MUST conform to, the canonical environment-context object injected at deploy time, the resolution of per-environment handles (domain, identity, region, tenant account), and the orchestration that turns `(component, version, env_slug)` into a deployed stack. Triggers on: standard product interface, cdk app contract, environment context injection, deploy orchestrator, common deploy interface, marketplace deployer, base path injection, env-aware cdk."
---

# Building the Product Deployer

This skill builds **one** of the four standalone products in the marketplace ecosystem. It is the only product that is allowed to invoke CloudFormation deploys; every other product (including the Marketplace itself, the Tenant Domain Router, the Tenant Account Manager, and the Marketplace Puller) goes through it. It is itself a marketplace component.

The authoritative blueprint is in [`reference/PRD.md`](./reference/PRD.md). Consult it for the current Deployer service route map, bundle contract, workflow requirements, and infrastructure topology before implementation.

Load this skill alongside `skills/build-saas-marketplace/` whenever you are working on the deploy interface, CDK contract, or "how does product X get the right inputs for environment Y".

## What This Product Owns

1. **The CDK app contract** every product MUST follow so the deployer can synthesize and deploy any product without product-specific code paths.
2. **The canonical `EnvironmentContext` object** that gets injected into a product's `cdk synth` invocation as CDK context. It holds everything a product needs to know about the environment it is being deployed into (env slug, tenant account ID, region, domain handles, identity handles, reserved base path, secrets references).
3. **The orchestration** that resolves `(component, version, env_slug)` → builds context → invokes `cdk synth` (locally on the artifact) or deploys the pre-synthesized template — and reports back to the marketplace registry's `Deployments` table.
4. **The standard `IMarketplaceProduct` CDK construct** that products extend. Extending it gives them automatic wiring of base path, identity, observability, and tagging.

## Architecture

```
┌──────────────── Marketplace account (control plane) ────────────────┐
│                                                                     │
│   Marketplace API → enqueues deploy intents into SQS                │
│                                                                     │
│   Deployer Step Function (one execution per intent):                │
│     1. Resolve EnvironmentContext from Domain Router + Account Mgr  │
│     2. Pull artifact from S3                                        │
│     3. Stamp parameters into the CFN template                       │
│     4. Trigger StackSet stack-instance create/update OR              │
│        AssumeRole into tenant + raw CloudFormation                  │
│     5. Wait for terminal state                                      │
│     6. Write Deployments row, emit deploy.completed event           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Required Implementation Checklist

- [ ] `IMarketplaceProduct` CDK construct published as a versioned npm package (`@marketplace/product-sdk`)
- [ ] `EnvironmentContext` schema defined in TypeScript, validated with Zod, versioned with semver
- [ ] Deployer Step Function deployed in marketplace account, fed by a single SQS queue
- [ ] Resolution Lambdas read Domain Router + Account Manager via their public APIs (no DB peeking)
- [ ] Deploy adapter implements StackSet path AND assume-role-CFN path; chosen per component manifest
- [ ] Every deploy writes a row to `Deployments` (start, end, parameters digest, status)
- [ ] Idempotent: re-enqueuing the same `(component, version, env_slug)` is a no-op if the stack is already in that exact state
- [ ] Self-deploys: the Deployer is itself a component; the bootstrap deploys it via a one-shot CDK pipeline before any marketplace-API-driven deploy is possible

## The CDK Contract Every Product Implements

Every product is a CDK app whose entrypoint conforms to:

```ts
// products/<name>/bin/app.ts
import { App } from 'aws-cdk-lib';
import { MarketplaceProduct } from '@marketplace/product-sdk';
import { MyProductStack } from '../lib/my-product-stack';

const app = new App();

// MarketplaceProduct reads CDK context injected by the deployer
// (envSlug, tenantAccountId, region, domainHandles, identityHandles, basePath, secrets, ...)
// and exposes them as a strongly typed `ctx`.
const product = new MarketplaceProduct(app, 'MyProduct', {
  componentName: 'analytics-api',
  basePathRequired: true,    // declares this product needs a base path reservation
  identityRequired: true,    // declares this product calls Account Manager introspection
});

new MyProductStack(product, 'MainStack', { ctx: product.ctx });

app.synth();
```

The contract requires:

- **One CDK app per component.** Multi-app components are not supported.
- **All env-specific values come from `product.ctx`,** never from `process.env` or hard-coded literals.
- **All resources tagged** with `marketplace:component`, `marketplace:version`, `marketplace:env_slug`. The `MarketplaceProduct` construct applies tags automatically.
- **Stack name** is `<componentName>-<envSlug>` and is set automatically.

Read `rules/integration-cdk-product-contract.md`.

## EnvironmentContext (the canonical injection)

```ts
type EnvironmentContext = {
  envSlug: string;                  // 'acme-prod'
  tenantAccountId: string;          // '123456789012'
  region: string;                   // 'us-east-1'
  customerId: string;               // 'cus_01H...'
  envId: string;                    // 'env_01H...'

  domain: {
    subdomain: string;              // 'acme-prod.provider.xyz'
    hostedZoneId: string;
    certificateArn: string;
    certificateArnUsEast1: string;
    apiGatewayDomainName: string;
    apiGatewayDomainAlias: string;
    apiGatewayDomainAliasZoneId: string;
  };

  identity: {
    introspectionEndpoint: string;  // for non-CDK runtime use
    authorizerArn: string;          // CDK-importable Lambda authorizer
  };

  basePath?: string;                // 'billing' — present iff basePathRequired
  secretsPrefix: string;            // 'arn:aws:secretsmanager:<region>:<acct>:secret:/<env>/<component>/'

  contextSchemaVersion: '1';        // bump on breaking changes; products pin
};
```

The Deployer injects this as a single CDK context entry: `--context marketplaceContext=<base64-json>`. The `MarketplaceProduct` construct decodes it.

Read `rules/architecture-environment-context.md`.

## Deploy Orchestration

Each deploy intent is `(component, version, env_slug, base_path?)`. The Step Function:

1. **Resolve context** — call Domain Router `GET /environments/{env_slug}/handles` and Account Manager `GET /environments/{env_id}` to populate `EnvironmentContext`.
2. **Reserve base path if required** — call Domain Router `POST /environments/{env_slug}/base-paths` (idempotent).
3. **Materialize the template** — pull `template.json` and assets from `s3://component-artifacts/<component>/<version>/`. Stamp the `EnvironmentContext` into CloudFormation `Parameters` (NOT into the template body).
4. **Execute deploy** — StackSet preferred; assume-role + raw CFN as fallback. The component manifest says which.
5. **Wait** — poll terminal state via the StackSet status APIs or CFN describe-stacks.
6. **Audit** — append a `Deployments` row with `parameters_digest = sha256(canonicalize(parameters))` and `status = succeeded | failed`.
7. **Emit** — `deploy.completed` event onto the marketplace bus.

Read `rules/implementation-deploy-orchestrator.md`.

## Adapters

| Adapter | Mechanism | When to use |
| --- | --- | --- |
| `stackset` | CloudFormation StackSets (service-managed) | Default. Use whenever StackSet overrides can express the required parameterization. |
| `assume-role-cfn` | STS AssumeRole into `MarketplaceAdmin` + raw CFN | When per-tenant parameter overrides are too rich for StackSets, or the target is outside the Org. |
| `cdk-pipelines-bootstrap` | Local `cdk deploy` run from a CodeBuild | Used **only** by the marketplace bootstrap to deploy the Deployer itself. Forbidden for any normal subscribe/release. |

Read `rules/integration-deploy-adapters.md`.

## Non-Negotiable Principles

1. **One deploy path for everything.** Every other product, including the marketplace itself, deploys through this product's Step Function.
2. **Synthesized template is immutable.** Parameter overrides happen at the CloudFormation `Parameters` boundary, never by editing the template.
3. **`EnvironmentContext` is the only injection mechanism.** Products MUST NOT read `process.env` or AWS SSM at synth time for environment values.
4. **Resolution goes through public APIs**, not by directly reading other products' DynamoDB tables.
5. **Idempotent re-deploy.** Enqueuing the same intent twice produces zero CloudFormation churn the second time.
6. **Self-deploy.** The Deployer's own bootstrap is the only `cdk-pipelines-bootstrap` use; from then on the Deployer redeploys itself via its own Step Function.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Deployer Ontology | `rules/foundation-deployer-ontology.md` | HIGH |
| Environment Context | `rules/architecture-environment-context.md` | CRITICAL |
| CDK Product Contract | `rules/integration-cdk-product-contract.md` | CRITICAL |
| Deploy Adapters | `rules/integration-deploy-adapters.md` | CRITICAL |
| Deploy Orchestrator | `rules/implementation-deploy-orchestrator.md` | CRITICAL |
| Bootstrap and Self-Deploy | `rules/delivery-bootstrap-and-self-deploy.md` | HIGH |
