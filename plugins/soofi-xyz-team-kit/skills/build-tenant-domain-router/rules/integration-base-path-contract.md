---
title: Base Path Contract
impact: CRITICAL
tags: [integration, base-path, ssm, cdk]
---

# Base Path Contract

Every product that exposes HTTP traffic in a tenant environment MUST consume DNS, certificate, and custom-domain resources through this contract. Do NOT create your own.

## Published Handles

The Tenant Domain Router publishes these SSM Parameter Store entries in the tenant account, scoped to the environment:

| Key | Type | Required for |
| --- | --- | --- |
| `/<env>/domain/subdomain` | `String` | All consumers — the FQDN |
| `/<env>/domain/hosted-zone-id` | `String` | Products that add their own A/AAAA records |
| `/<env>/domain/certificate-arn` | `String` | API Gateway / ALB / CloudFront consumers in the cert's region |
| `/<env>/domain/certificate-arn-us-east-1` | `String` | CloudFront consumers (cert MUST be in `us-east-1`) |
| `/<env>/domain/api-gateway-domain-name` | `String` | API Gateway base-path-mapping consumers |
| `/<env>/domain/api-gateway-domain-alias` | `String` | the alias hosted zone target for the API Gateway custom domain |
| `/<env>/domain/api-gateway-domain-alias-zone-id` | `String` | the alias hosted zone id |
| `/<env>/domain/cloudfront-distribution-id` | `String` (optional) | CloudFront-fronted base-path consumers |

## Reservation Workflow

1. **Producer reserves the base path at registration time.** When registering a new component version, the producer calls `POST /environments/{env_slug}/base-paths` with `{ base_path, component_name }`. The marketplace conditionally writes a row in the `BasePaths` table; collisions return HTTP 409.
2. **Producer passes the reserved base path as a CDK input.** It becomes a `CfnParameter` on the component's stack so the deploy product can inject it per environment.
3. **Consumer reads the SSM handles inside its CDK app**, builds a `BasePathMapping`, and points it at its own `RestApi`.

## CDK Consumption Pattern

```ts
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { DomainName, BasePathMapping } from 'aws-cdk-lib/aws-apigateway';

const env = this.node.tryGetContext('envSlug'); // injected by deploy product
const basePath = this.node.tryGetContext('basePath'); // 'billing'

const tenantDomain = DomainName.fromDomainNameAttributes(this, 'TenantDomain', {
  domainName: StringParameter.valueForStringParameter(this, `/${env}/domain/api-gateway-domain-name`),
  domainNameAliasHostedZoneId: StringParameter.valueForStringParameter(this, `/${env}/domain/api-gateway-domain-alias-zone-id`),
  domainNameAliasTarget: StringParameter.valueForStringParameter(this, `/${env}/domain/api-gateway-domain-alias`),
});

new BasePathMapping(this, 'Mapping', {
  domainName: tenantDomain,
  restApi: this.api,
  basePath, // 'billing'
});
```

## Rules

1. **Never create an ACM certificate in a consuming product.** Read `certificate-arn` from SSM.
2. **Never create the API Gateway `DomainName` resource in a consuming product.** Import it from SSM and only attach a `BasePathMapping`.
3. **Never write A/AAAA/CNAME records in the parent zone.** If you need an extra DNS record, write it in the child zone using the SSM `hosted-zone-id`.
4. **The `/` base path is reserved.** The Tenant Domain Router's own subscribe flow may attach a default landing page at the root; otherwise it is empty. Components must claim a non-empty base path.
5. **Reservations are environment-scoped.** Reserving `billing` in `acme-prod` does not reserve it in `acme-staging`.

## Anti-patterns

- ❌ Hard-coding the FQDN in product source. Always read from SSM.
- ❌ Letting the deploy succeed and then "discovering" a base path collision at API Gateway level. The marketplace blocks this at registration.
- ❌ Mixing CloudFront and API Gateway custom-domain handles for the same product without an explicit decision recorded in the component manifest.
