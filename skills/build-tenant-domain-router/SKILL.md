---
name: build-tenant-domain-router
description: "Guides building the Tenant Domain Router — a standalone marketplace product that owns a single root domain (e.g. `provider.xyz`), mints one delegated subdomain per tenant environment (e.g. `customer.provider.xyz`), and exposes a uniform contract for any other product to attach a base path under that subdomain. Covers the marketplace-account parent hosted zone, NS-delegation to per-tenant child hosted zones, ACM certificate strategy, and the API Gateway / CloudFront base-path-mapping interface that other products consume. Triggers on: tenant subdomain, root domain delegation, route53 hosted zone delegation, per-tenant DNS, base path mapping, multi-tenant custom domain, ACM wildcard, marketplace domain product."
---

# Building the Tenant Domain Router

This skill builds **one** of the four standalone products that make the marketplace ecosystem work. It is published to the marketplace registry like any other component (`cdk synth` → register → release → subscribe). When subscribed by a tenant environment, it provisions that environment's public DNS surface and exposes a stable interface that every other product in that environment uses to publish HTTP(S) endpoints.

Load this skill alongside `skills/build-saas-marketplace/` whenever you are working on multi-tenant DNS, custom domains, base paths, or "where does product X live on the internet for tenant Y".

## What This Product Owns

1. **The root domain.** Exactly one root domain (e.g. `provider.xyz`) lives in the marketplace account's Route 53 hosted zone. Registrar NS records point at this zone. The marketplace owns the apex.
2. **Per-environment subdomains.** Each tenant environment gets exactly one subdomain of the form `<env-slug>.provider.xyz` (e.g. `acme-prod.provider.xyz`, `acme-staging.provider.xyz`). The slug is derived from `(tenant, environment)` and is immutable for the lifetime of the environment.
3. **NS-delegation to the tenant.** The marketplace zone holds an `NS` record set for `<env-slug>.provider.xyz` pointing at a child hosted zone created **inside the tenant account**. After delegation, the tenant owns every record under their subdomain; the marketplace never touches it again.
4. **An ACM strategy** that lets each product in the tenant terminate TLS on its slice of the subdomain without coordinating certificates manually.
5. **A base-path contract** that every other product consumes to attach itself at a stable path on the tenant subdomain (`https://<env-slug>.provider.xyz/<base-path>`).

## Architecture

```
Registrar
  │  NS → marketplace account
  ▼
┌─────────────────── Marketplace account ───────────────────┐
│   Route 53 hosted zone: provider.xyz (parent)             │
│     ├─ A/AAAA  (apex marketing site, optional)            │
│     └─ NS      acme-prod.provider.xyz → tenant zone NS    │
│        NS      acme-stg.provider.xyz  → tenant zone NS    │
│        NS      globex-prod.provider.xyz → tenant zone NS  │
│                                                            │
│   ACM (us-east-1): wildcard *.provider.xyz                │
│     (used only for marketplace-owned UIs on the apex)     │
└────────────────────────────────────────────────────────────┘
                       │ NS delegation
                       ▼
┌──────────────── Tenant account (acme-prod) ───────────────┐
│   Route 53 hosted zone: acme-prod.provider.xyz (child)    │
│     ├─ A     api      → API Gateway custom domain         │
│     ├─ A     app      → CloudFront distribution           │
│     └─ TXT   _amp...  → ACM DNS validation                │
│                                                            │
│   ACM (us-east-1 + region): acme-prod.provider.xyz +      │
│                              *.acme-prod.provider.xyz      │
│                                                            │
│   API Gateway custom domain: acme-prod.provider.xyz       │
│     ├─ base path /billing   → billing-worker stack        │
│     ├─ base path /analytics → analytics-api stack         │
│     └─ base path /          → app-shell                   │
└────────────────────────────────────────────────────────────┘
```

## Required Implementation Checklist

- [ ] Root domain registered and pointed at the marketplace account's Route 53 zone via NS records at the registrar
- [ ] Marketplace-account parent hosted zone for the root domain is created exactly once and is owned by this product's stack
- [ ] Marketplace API endpoint `POST /environments/{env_slug}/domain` provisions the tenant child hosted zone and writes the parent `NS` delegation
- [ ] Marketplace API endpoint `DELETE /environments/{env_slug}/domain` deletes the parent `NS` records and (optionally) the tenant zone
- [ ] Tenant-side stack creates the child hosted zone, ACM certificate (DNS-validated), and the API Gateway / CloudFront custom-domain resources
- [ ] Tenant-side stack exports a stable set of CloudFormation outputs and SSM parameters that every other product reads (see "Base Path Contract")
- [ ] Idempotent on every retry; re-subscribing the same tenant returns the same `env_slug` → subdomain mapping
- [ ] Audit event recorded in the marketplace `Deployments` log for create / delegate / delete

## Two-Stack Layout

This product ships **two** synthesized CloudFormation templates inside one component bundle. The `cdk synth` output contains both, and the deploy product (see `skills/build-product-deployer/`) decides which template runs in which account.

| Template | Runs in | Responsibility |
| --- | --- | --- |
| `parent-zone.template.json` | Marketplace account | Owns the parent hosted zone for `provider.xyz`. One stack ever. |
| `tenant-subdomain.template.json` | Tenant account | Owns the child hosted zone, ACM cert, and custom-domain wiring. One stack per tenant environment. |

The marketplace account also runs a small Lambda — packaged as part of the parent-zone stack — that writes the `NS` delegation record into the parent zone whenever a new tenant subdomain is provisioned. The tenant-subdomain stack reports its child-zone NS records back to the marketplace via a CloudFormation custom resource that calls this Lambda.

Read `rules/architecture-parent-and-child-zones.md`.

## Base Path Contract (How Other Products Consume This)

Every other product that wants to expose HTTP traffic in a tenant environment MUST read these stable handles instead of creating its own DNS / certificate / custom-domain resources:

| Handle | Where | Example |
| --- | --- | --- |
| `/<env>/domain/subdomain` | SSM Parameter Store | `acme-prod.provider.xyz` |
| `/<env>/domain/hosted-zone-id` | SSM Parameter Store | `Z0123456789ABCDEFGHIJ` |
| `/<env>/domain/certificate-arn` | SSM Parameter Store | `arn:aws:acm:us-east-1:...:certificate/...` |
| `/<env>/domain/api-gateway-domain-name` | SSM Parameter Store | `acme-prod.provider.xyz` (the `aws_apigateway.DomainName.domainName`) |
| `/<env>/domain/api-gateway-domain-id` | SSM Parameter Store | the `aws_apigateway.DomainName` logical id |
| `/<env>/domain/cloudfront-distribution-id` (optional) | SSM Parameter Store | for products that prefer CloudFront-fronted base paths |

A consuming product attaches a base path with a single CDK construct call:

```ts
import { BasePathMapping } from 'aws-cdk-lib/aws-apigateway';

new BasePathMapping(this, 'BillingBasePath', {
  domainName: DomainName.fromDomainNameAttributes(this, 'TenantDomain', {
    domainName: ssmDomainName,
    domainNameAliasHostedZoneId: ssmHostedZoneId,
    domainNameAliasTarget: ssmAliasTarget,
  }),
  restApi: this.api,
  basePath: 'billing', // becomes https://<env>.provider.xyz/billing
});
```

Base paths are claimed first-come-first-served per environment. The Tenant Domain Router exposes a `POST /environments/{env_slug}/base-paths` API to reserve a base path for a component before it deploys, so two products cannot collide.

Read `rules/integration-base-path-contract.md`.

## API Surface

This product extends the Marketplace API with three endpoints (all in the marketplace account, all idempotent):

| Operation | Method | Path | Effect |
| --- | --- | --- | --- |
| Provision environment subdomain | `POST` | `/environments/{env_slug}/domain` | Body: `{ tenant_account_id, region }`. Creates the child hosted zone in the tenant; writes `NS` delegation in the parent. |
| Reserve base path | `POST` | `/environments/{env_slug}/base-paths` | Body: `{ base_path, component_name }`. Reserves `<base_path>` on the tenant subdomain for `<component>`. Conditional write — fails on collision. |
| Release environment subdomain | `DELETE` | `/environments/{env_slug}/domain` | Removes the parent `NS` record set; deletes the tenant child zone if `force=true`. |

Read `rules/implementation-domain-api.md`.

## Non-Negotiable Principles

1. **Marketplace owns the apex; tenants own their subdomain.** Once `NS` delegation is written, the marketplace never reads or writes records under `<env>.provider.xyz` again.
2. **One subdomain per environment, immutable.** Slug is derived from `(tenant, environment)` and never changes for the life of the environment.
3. **No product creates DNS, ACM, or custom-domain resources on its own.** Every product reads the SSM handles published by this product.
4. **Base paths are reserved before deploy.** Components call the reserve API and pass the reserved base path as a CDK input; collisions are impossible at deploy time because they were impossible at register time.
5. **Self-hosting.** This product is itself a marketplace component. The marketplace deploys it into the marketplace account (parent zone) and into every tenant account (child zone) via its own subscribe flow.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Domain Ontology | `rules/foundation-domain-ontology.md` | HIGH |
| Parent and Child Zones | `rules/architecture-parent-and-child-zones.md` | CRITICAL |
| Base Path Contract | `rules/integration-base-path-contract.md` | CRITICAL |
| Domain API | `rules/implementation-domain-api.md` | CRITICAL |
| Delegation & Verification | `rules/delivery-delegation-and-verification.md` | HIGH |
