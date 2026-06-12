---
name: manage-short-urls
description: "Design, rebuild, and operate a generic Persist-backed short-URL service. Covers token issuance, GraphSON v3 persistence, graph-query resolution, public redirects, GraphFactProduced click facts on EventBridge, SQS DLQ replay, custom-domain discovery, and forbidden legacy patterns such as DynamoDB token tables, Snowflake dependencies, webhooks, metadata blobs, and business logic in the resolver."
---

# Manage Short URLs

Use this skill for any first-party short-URL / link-shortener / click-telemetry service. The service is generic: it wraps URLs, stores the durable short URL artifact in Persist, resolves tokens through graph queries, redirects clicks, and emits graph facts for click telemetry.

Do not use it for audience selection, template authoring, communication scheduling, provider delivery, or downstream business interpretation of clicks.

## One-Sentence Identity

**Linoone is a generic URL-wrapping product backed by Persist. Input is a URL; output is a short URL; clicks become graph facts on EventBridge.**

## Core Responsibilities

Linoone owns:

- `POST /shorten`: private IAM-signed issuance API
- 10-character base62 token generation
- synchronous Persist `/persist/ingest` writes for short URL artifacts
- `GET /{token}`: public resolver API
- Persist `/persist/gremlin` lookup by `short_url_token`
- `302` redirect to `target_url`
- EventBridge `GraphFactProduced` publication for clicks
- SQS click DLQ and replay Lambda for failed EventBridge publication
- custom-domain and shared-infrastructure discovery

Linoone does not own:

- producer business records
- campaign, account, message, person, or channel semantics
- provider delivery feedback
- downstream lifecycle updates
- suppression policy
- warehouse mirrors
- per-token webhooks
- product-specific graph labels outside the short URL graph schema

## Default Architecture

```text
POST /shorten
  private, IAM-signed
        |
        v
IssueFn
  - validate { target_url }
  - generate 10-char base62 token
  - build short_url_path from resolver base URL
  - build GraphSON v3 short_url artifact
  - POST /persist/ingest
  - return { token, short_url }

Persist graph
  - short_url vertex is the source of truth
  - server-managed properties such as created_at are owned by Persist

GET /{token}
  public resolver
        |
        v
ResolveFn
  - validate token format
  - POST /persist/gremlin lookup by short_url_token
  - 404 if not found
  - build GraphFactProduced short_url.visited detail
  - EventBridge PutEvents
  - on PutEvents failure, enqueue to SQS click DLQ
  - 302 to target_url

EventBridge shared engagement bus
  source: shorturl
  detail-type: GraphFactProduced
        |
        v
Persist/Event consumers
  - ingest graph facts
  - downstream products subscribe with their own rules
```

## API Contract

### `POST /shorten`

Private, IAM-signed, internal caller API.

Request:

```json
{
  "target_url": "https://example.com/landing?message_id=msg_123"
}
```

Response:

```json
{
  "token": "7BTadEDkJ8",
  "short_url": "https://short.example.com/7BTadEDkJ8"
}
```

Rules:

- `target_url` must be a valid URL, max 2048 chars.
- No producer identity is stored on the vertex. Do not derive or persist `created_by`; the graph persistence layer hashes all vertex properties into the vertex identity, so producer-specific properties split the same logical short URL into duplicate vertices.
- The service returns both the token and the full short URL.
- If a custom domain is not routable in an environment, return the real resolver API endpoint instead of a placeholder domain.

### `GET /{token}`

Public resolver API.

Rules:

- Token is exactly 10 base62 characters.
- Missing or invalid tokens return `404`.
- Found tokens redirect with `302` to `target_url`.
- Click recording must not prevent redirect. If EventBridge publish fails, write the graph fact to SQS DLQ and redirect.

## Persist Storage Contract

Persist is the source of truth. Do not build a DynamoDB token table and do not mirror the token store into a warehouse.

### `short_url` vertex

Required properties:

| Property | Purpose |
| --- | --- |
| `short_url_token` | Resolver path token |
| `short_url_path` | Full public short URL returned to producers |
| `target_url` | Destination URL for redirect |

These three properties are the complete identity of the vertex. Do not add producer identity (`created_by`) or other operational metadata: identity-hashed persistence turns every property variant into a separate duplicate vertex for the same logical short URL.

Server-managed properties:

- `created_at`
- any graph-internal identifiers

Producer rule: **do not send `created_at`**. Persist fills server-managed graph properties.

### Optional schema-backed relationships

Some deployments may attach the `short_url` vertex to another graph entity if that entity can be derived from the target URL and is already part of the graph schema.

Rules:

- The relationship must be explicit in the graph schema.
- The relationship must be tested.
- The service must not invent labels or properties locally.
- Do not add arbitrary `metadata`.
- If the relationship is product-specific, keep it behind an explicit adapter/configuration boundary and document it.

## Issuance Flow

1. Parse and validate request body.
2. Generate a random 10-character base62 token.
3. Query Persist by `short_url_token` to avoid token collision.
4. Build `short_url_path = <resolver-base-url>/<token>`.
5. Build GraphSON v3:
   - `short_url` vertex (`short_url_token`, `short_url_path`, `target_url` only)
   - optional schema-backed relationship edges
6. Call Persist `/persist/ingest` synchronously.
7. Return `{ token, short_url }`.

## Resolution Flow

Strict order:

1. Validate token format. Invalid -> `404`.
2. Query Persist `/persist/gremlin`:
   - `g.V().hasLabel('short_url').has('short_url_token', token).limit(1)`
   - project `short_url_token`, `short_url_path`, `target_url`
3. Missing vertex -> `404`.
4. Build click graph fact.
5. Synchronously publish EventBridge `GraphFactProduced`.
6. If publish fails or `FailedEntryCount > 0`, enqueue graph fact to SQS click DLQ.
7. Return `302` to `target_url`.

No expiry checks are part of the current Persist-backed core unless a future graph schema explicitly models expiration.

## EventBridge Contract

The resolver publishes click telemetry as graph facts.

Envelope:

| Field | Value |
| --- | --- |
| `Source` | `shorturl` |
| `DetailType` | `GraphFactProduced` |
| `EventBusName` | configured shared engagement bus |
| `Detail` | JSON string matching the graph fact detail below |

Detail:

```json
{
  "schema_version": "1.0",
  "graphson_format": "graphson-v3",
  "fact_type": "short_url.visited",
  "entity_types": ["short_url"],
  "idempotency_key": "shorturl:ev_01K...",
  "graphson": {
    "vertices": [],
    "edges": []
  }
}
```

The EventBridge event itself is the transport. Persist or other graph consumers ingest the `graphson` body.

## Click Graph Fact

For each successful resolver invocation, build:

- one `short_url` vertex projection
- one `short_url_visited` edge

Required `short_url_visited` edge properties:

| Property | Purpose |
| --- | --- |
| `event_identifier` | Per-click ULID prefixed with `ev_` |
| `visitor_ip_address` | Source IP from API Gateway request context |
| `user_agent` | User-Agent header |
| `effective_at` | Click timestamp |

Optional query-derived properties are allowed only when they are explicit, schema-backed, and tested. Never use a free-form `metadata` object.

Do not send `created_at` in the graph fact. Persist owns server-managed timestamps.

## EventBridge Failure Handling

`PutEvents` success requires both:

- the AWS SDK call succeeds
- `FailedEntryCount === 0`

If either condition fails:

1. Build a DLQ payload:
   - `graph_fact`
   - `failed_at`
   - `attempts`
   - `reason`
2. Send it to the click DLQ.
3. Still return the redirect response.

A replay Lambda reads the DLQ and republishes the same `GraphFactProduced` event. Consumers dedupe with `idempotency_key` and/or `event_identifier`.

## Producer Identity

Producer identity is **not** stored on the `short_url` vertex.

Earlier revisions of this service derived a `created_by` producer slug from the IAM principal and persisted it on the vertex. Because identity-hashed persistence (Persist) computes the vertex id from all properties, every producer variant of the same logical short URL became a separate duplicate vertex with disjoint edges. The property has been removed from the contract.

Rules:

- Do not derive, accept, or persist `created_by` (or any producer/operational metadata) on `short_url` vertices.
- If producer attribution is ever needed, capture it in logs or on schema-backed edges — never as a vertex identity property.
- Keep producer identity generic; do not embed channel-specific behavior in the resolver.

## Infrastructure Requirements

Minimum CDK resources:

- public resolver HTTP API: `GET /{token}`
- private management HTTP API: `POST /shorten` with IAM auth
- Issue Lambda
- Resolve Lambda
- Replay Lambda
- SQS click DLQ and DLQ deadletter queue
- shared EventBridge bus or imported existing bus
- IAM policy allowing Lambdas to invoke Persist API
- IAM policy allowing resolver/replay to publish EventBridge events
- log groups, metrics, and alarms
- SSM or environment config for Persist API URL and resolver base URL

Run `rules/infrastructure-discovery.md` before custom-domain or bus decisions.

## Custom Domain Rules

- Use a custom domain only when DNS really routes to the resolver.
- If a domain already points at CloudFront, prefer adding a behavior/origin for the short-link path instead of replacing the whole distribution.
- If DNS is managed outside the cloud account, surface the exact record/rule needed and stop for user/team action.
- If routing is not ready, return the real API Gateway resolver URL.

## Forbidden Patterns

- DynamoDB token table as source of truth
- Snowflake or warehouse dependency for token creation/resolution
- server-managed `created_at` sent by the producer
- webhook URL stored per token
- per-channel resolver paths unless the configured domain/router requires a prefix
- arbitrary `metadata` blobs
- any `created_by` / producer-identity property on `short_url` vertices (it joins the identity hash and creates duplicate vertices)
- business logic in the resolver
- downstream lifecycle updates in the resolver
- direct downstream-system calls in the resolver
- per-service EventBridge bus when a shared engagement bus is required
- keeping a legacy click pipeline beside EventBridge + graph facts

## Rebuild Checklist

Before calling a short-URL service ready:

- `POST /shorten` accepts only `{ target_url }`.
- Tokens are 10-character base62.
- `short_url` vertices carry only `short_url_token`, `short_url_path`, and `target_url` — no `created_by`.
- Persist `/persist/ingest` writes the `short_url` graph artifact synchronously.
- Persist `/persist/gremlin` resolves tokens.
- `short_url_path` is the full public short URL.
- `created_at` is not sent by the producer.
- Resolver publishes `GraphFactProduced` with `fact_type = short_url.visited`.
- Resolver DLQs failed EventBridge publishes and still redirects.
- Replay Lambda republishes graph facts from DLQ.
- No DynamoDB, Snowflake, webhooks, or business-specific resolver logic.
- Infrastructure discovery is documented.
- Custom domain is either proven routable or the service returns the real API Gateway resolver endpoint.
