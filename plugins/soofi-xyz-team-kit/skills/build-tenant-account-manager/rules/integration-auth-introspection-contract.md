---
title: Auth Introspection Contract
impact: CRITICAL
tags: [integration, auth, lambda-authorizer]
---

# Auth Introspection Contract

Every other marketplace API authenticates by delegating to this product. There is no second auth path.

## The Contract

`POST /internal/introspect` (callable only via VPC endpoint or signed marketplace-internal IAM):

```json
// request
{ "api_key": "sk_acmepd_..." }

// 200
{
  "customer_id": "cus_01H...",
  "env_id": "env_01H...",
  "env_slug": "acme-prod",
  "tenant_account_id": "123456789012",
  "scopes": ["env:admin", "env:read", "customer:read"],
  "key_id": "key_01H...",
  "status": "active",
  "expires_at": null
}

// 401
{ "error": "unknown_or_revoked_key" }
```

## Lambda Authorizer (shipped by this product, consumed by every other product)

The product publishes a stable Lambda ARN as an SSM parameter `/marketplace/auth/authorizer-arn`. Every other marketplace API references it from its `cdk synth` template:

```ts
import { TokenAuthorizer } from 'aws-cdk-lib/aws-apigateway';

const authorizerArn = StringParameter.valueForStringParameter(this, '/marketplace/auth/authorizer-arn');
const authorizer = TokenAuthorizer.fromTokenAuthorizerAttributes(this, 'MpAuth', { authorizerArn });
```

The authorizer:

1. Reads `Authorization: Bearer sk_...`
2. Computes `sha256(key)`, looks up in DynamoDB GSI `key_hash`
3. Returns an IAM policy plus a context object `{ customer_id, env_id, env_slug, tenant_account_id, scopes }`
4. Caches results for 60 seconds keyed by hash

## Cache Invalidation

EventBridge events `key.revoked`, `key.rotated` (after grace), `env.deleted`, `customer.deleted` MUST be consumed by every authorizer instance via a fanout SNS topic to evict the corresponding cache entry within one minute.

## Rules

1. **No product implements its own authorizer.** Importing the shared one is mandatory.
2. **No product writes to `ApiKeys` directly.** All key lifecycle goes through the public Account Manager API.
3. **Introspection MUST NOT be exposed to the public internet.** Wire it as a VPC endpoint or use IAM auth on the API Gateway resource.
4. **Scopes are checked by the consuming product, not by the authorizer.** The authorizer returns scopes; the product authorizes the action.
5. **Cleartext keys MUST NEVER be logged.** The authorizer logs `key_id` and `last_four` only.
