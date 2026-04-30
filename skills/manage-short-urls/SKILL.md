---
name: manage-short-urls
description: "Design and operate a generic, channel-agnostic short-URL service that turns any long URL into a short one, redirects clicks to the destination, and publishes click events to a shared engagement EventBridge bus. The service deliberately knows nothing about accounts, messages, templates, customers, or channels — it stores opaque URLs and emits opaque click events that consuming products correlate using their own internal records. Use when building or refactoring any short-link / link-shortener / click-telemetry service for notifications, email, letters, marketing, partners, or any other product; replacing legacy click pipelines; designing the token issuance + resolver flow; or wiring resolver Lambdas behind a custom domain."
---

# Manage Short URLs

Use this skill for any first-party short-URL / link-shortener / click-telemetry service. Do not use it for upstream audience selection, template authoring, scheduling, or provider-side delivery; those belong to `xatu`, `jigglypuff`, `oranguru`, and `chatot`.

## Core Responsibilities

`Linoone` owns:

- a generic `POST /shorten` API that accepts any URL and returns a short token
- a public `GET /<token>` resolver behind a custom domain
- the DynamoDB token store (minimal, generic, no business concepts)
- publishing `ShortUrlVisited` events to the shared engagement EventBridge bus on every click
- token expiration semantics (soft 410, hard 404 via DDB TTL)
- reuse-vs-provision discipline for shared cloud infrastructure (Route 53, CloudFront, ACM, the engagement bus)

`Linoone` does not own:

- which template body the URL is embedded in (`jigglypuff`)
- which person/account receives a communication (`xatu`)
- when a communication is sent (`oranguru`)
- provider-side send and delivery feedback (`chatot`)
- portal rendering once the resolver 302s (the consumer portal app)
- **any business interpretation of clicks** — graph writes, downstream-system calls, lifecycle state changes, suppression checks beyond expiry, or performance correlation. Those are responsibilities of the **consumer** subscribed to the engagement bus, not Linoone.

## The One-Sentence Identity

**Linoone is a generic URL-wrapping product. Input is a URL; output is a short URL. Click happens, event published.** Anything that requires Linoone to understand a business concept is mis-placed responsibility.

## Default Architecture

A short-URL service produced by Linoone has this shape:

```
                     ┌──────────────────────────────────────┐
   POST /shorten ──→ │ IssueFn (Lambda)                     │
   (IAM-signed,      │ - mint token = base62(...)           │
   internal only)    │ - PutItem to ShortUrlsTable          │
                     │ - return { token, short_url }        │
                     └──────────────────────────────────────┘
                                       │
                                       ▼
                     ┌──────────────────────────────────────┐
                     │ DynamoDB ShortUrlsTable              │
                     │ PK: token                            │
                     │ Attrs: target_url, created_by,       │
                     │   created_at, soft/hard expires,     │
                     │   visit_count, last_visited_at       │
                     │ TTL: hard_expires_at                 │
                     └──────────────────────────────────────┘
                                       │
                                       ▼
   GET /<token>  ──→ ┌──────────────────────────────────────┐
   (public, behind   │ ResolveFn (Lambda)                   │
   CloudFront)       │ 1. GetItem(token)                    │
                     │ 2. Check expirations                 │
                     │ 3. PutEvents to engagement bus       │
                     │ 4. UpdateItem visit_count++          │
                     │ 5. 302 → target_url                  │
                     └──────────────────────────────────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────────────┐
                    │ EventBridge: <shared-engagement-bus> │
                    │ source: shorturl                     │
                    │ detail-type: ShortUrlVisited         │
                    └────────────────┬─────────────────────┘
                                      │
                ┌─────────────────────┼─────────────────────┬───────────────────┐
                ▼                     ▼                     ▼                   ▼
       Product A Handler    Product B Handler      Persist Graph     Analytics
       (producer-a)         (producer-b)           (wildcard)        (any short URL click)
       Updates own records  Updates own records    Records full      Increments product
       and graph labels     and graph labels       history           counters
```

## Storage Discipline

### DynamoDB token store (generic, minimal)

**Eight attributes. No business concepts.**

| Attribute | Type | Required | Purpose |
| --- | --- | --- | --- |
| `token` | String (PK) | yes | 10-char base62; the path in `<short-domain>/<token>` |
| `target_url` | String | yes | Full URL to 302-redirect to. Opaque to the service. |
| `created_at` | String (ISO 8601) | yes | When the token was minted |
| `created_by` | String | yes | Producer identity, derived from IAM principal (`producer-a`, `email-sender`, `campaign-bot`) |
| `soft_expires_at` | String (ISO 8601) | no | After this → 410 Gone |
| `hard_expires_at` | Number (epoch sec) | no | DDB native TTL. Row auto-deleted; resolver returns 404 |
| `visit_count` | Number | yes (default 0) | Incremented per click |
| `last_visited_at` | String (ISO 8601) | no | Updated per click |

**Forbidden DDB attributes** (re-introducing any of these is the wrong instinct):

- `channel` — encoded in `target_url` query params if the producer wants the destination to know it
- `webhook_url` — we use EventBridge, not webhooks
- `metadata` — opaque blob anti-pattern; producers maintain their own correlation tables
- `account_id`, `message_id`, `template_family`, `person_id` — business concepts, never in this service
- GSIs on `message_id`, `account_id`, etc. — **none**. The only PK lookup is `token`. Reverse lookups are the producer's responsibility, in the producer's own table.

### No graph writes from Linoone

Linoone does not write to a graph. Ever. Any graph or analytics store is updated by **consumers** subscribed to the engagement bus. When advising a consumer team, instruct them to update existing labels in that product's lexicon on receiving a `ShortUrlVisited` event. Linoone itself has zero graph dependency.

## Channel Attribution Without A Channel Field

The service does not store, parse, or care about channel. **Channel attribution travels with the destination URL** and is recovered three independent ways:

1. **In the destination URL** — producers bake whatever the destination needs into `target_url` at issuance (for example, `?source=partner-a` or `?campaign=renewal`). The customer's browser arrives at the destination with those query params visible in `window.location.search`.
2. **In the `created_by` field** — a producing service such as `producer-a`, `email-sender`, or `campaign-bot` mints tokens. Consumers fan-out via EventBridge filters on `detail.created_by`. Each producer has a unique IAM identity that maps to a unique `created_by`.
3. **In the consuming product's own records** — when a producer mints a token, it writes `(token → internal_id)` to **its own** correlation table. When a click event arrives, the consumer's Lambda looks up the token in its own table to recover whatever business concepts it cares about.

If a future case needs channel-specific resolver behavior, the design is wrong — push that responsibility back into the consumer.

## Single Resolver Path

There is **one** public resolver path: `https://<short-domain>/<token>`. There is no `/s/`, no `/e/`, no `/<ref>/`. There is no per-channel resolver. The same path serves every product and every future channel.

Rationale: legacy systems split URLs by channel because the URL was the only channel signal a stateless splash page had. With first-party token storage and EventBridge as the notification mechanism, the URL no longer needs to encode channel — `created_by` and `?channel=` cover it.

## Resolver Order Of Operations

Strict, not optional. Implementations MUST follow this order:

1. **DDB GetItem by `token`.** Miss → 404.
2. **Hard-expiration check.** If `now > hard_expires_at` (rare race; TTL is async) → 404.
3. **Soft-expiration check.** If `now > soft_expires_at` → 410 Gone. Skip steps 4–6.
4. **Synchronous EventBridge `PutEvents`** of `ShortUrlVisited` to the shared engagement bus. Schema in `rules/event-schema.md`. On `PutEvents` failure → enqueue raw click context to the click DLQ (SQS); resolver still 302s. A click is never dropped. A small replay Lambda drains the DLQ into EventBridge with exponential backoff.
5. **DDB `UpdateItem`** on the row: `ADD visit_count :one, SET last_visited_at = :now`. Failures logged but do not block the redirect. (`visit_count` is operational state for Linoone's own dashboards; it is **not** part of the published event — see "Forbidden Event Fields" in `rules/event-schema.md`.)
6. **302** to `target_url`.

Notes:

- Steps 4 and 5 happen **synchronously** before the 302 to guarantee no lost clicks. EventBridge's own retries/DLQ handle delivery to subscribers — Linoone's job ends at `PutEvents` succeeding.
- Linoone does **not** call downstream business systems, does **not** write to the graph, does **not** update any lifecycle table, and does **not** check suppression. Any of those would couple Linoone to a specific business domain. They are consumer responsibilities executed in subscriber Lambdas.

## Producer Identity Convention

`created_by` follows a lowercase producer slug convention:

| Producer | `created_by` value |
| --- | --- |
| Notification sender | `notification-sender` |
| Email sender | `email-sender` |
| Letters service (future) | `letter-sender` |
| Marketing automation | `campaign-bot` |
| Partner integration X | `partner-<name>` |

Each producer has a unique IAM identity (Lambda execution role or principal). The IssueFn derives `created_by` from the IAM principal — **callers do not pass `created_by` themselves**. This prevents impersonation and keeps the source of truth at the IAM layer.

`source` on the published event is always `shorturl` (the short URL product identity), not the producer's identity. Per-producer fan-out happens via `detail.created_by` filtering, not via separate `source` values.

Implementation note: if a human-friendly producer name (`producer-a`) cannot be derived directly from the IAM role name, use a **server-side** IAM-principal-to-producer mapping in the service configuration. Never accept `created_by`, `producer`, or `x-producer-identity` from a request body or header; any IAM principal allowed to call the API could otherwise impersonate another producer.

## Consumer Subscription Pattern

Consumers subscribe to the engagement bus in **their own** CDK stacks. Linoone's CDK does not enumerate consumers.

```typescript
// In a consuming product's CDK — done ONCE, not per-token
new events.Rule(this, "ShortUrlClickRule", {
  eventBus: engagementBus,
  eventPattern: {
    source: ["shorturl"],
    detailType: ["ShortUrlVisited"],
    detail: { created_by: ["producer-a"] },
  },
  targets: [new targets.LambdaFunction(productClickHandler)],
});
```

Consumer responsibilities (handled in the consumer's Lambda, never in Linoone's resolver):

1. Dedupe by `event_id` (EventBridge is at-least-once).
2. Look up the token in the consumer's own correlation table to recover `message_id`, `account_id`, etc.
3. Update existing graph labels from that product's lexicon.
4. Update the consumer's own lifecycle table (`LifecycleTable.state = CLICKED`).
5. Call downstream systems if the consumer has business reason to.
6. Apply post-click suppression policy if any.

## Engagement Bus Topology

Linoone publishes to the **shared engagement bus**, **not** a per-service bus. Rationale:

- The graph (Persist) is a universal consumer; with a shared bus, Persist subscribes once with a wildcard rule and gets every event. With per-service buses, Persist deploys N rules per producing bus and updates them whenever a new producer launches.
- Adding a new producer (letters, push, partner) is a **one-team change** with a shared bus. Cross-cutting consumers need no updates.
- Adding a new consumer is a **one-team change** with a shared bus. They subscribe once and filter by `source` + `detail-type` + `created_by`.
- EventBridge Schema Registry holds all event schemas in one place; consumers discover events without crawling N buses.

Every event on the engagement bus follows a shared envelope contract:

```
detail.schema_version  (string, semver)
detail.event_id        (string, ULID, idempotency key)
detail.created_by      (string, producer identity slug)
detail.<event-specifics>
```

For `ShortUrlVisited`, consumers use the EventBridge envelope `time` as the click timestamp. Do not duplicate it into `detail.created_at`.

`ShortUrlVisited` is one event type among many (`MessageReplied`, `EmailOpened`, `PortalLogin`, `CallReceived`, etc.) that all share this envelope.

## Reuse-vs-Provision Discipline

**Always run a structured discovery pass before designing any CDK.** See `rules/infrastructure-discovery.md` for the full required commands and decision matrix. Discovery is mandatory, not optional; "I assume X exists" is not allowed. Before adding new cloud resources, **inspect the existing account**:

- **Route 53 hosted zones** — search for an existing zone for the chosen short domain. Reuse if present.
- **ACM certificates** — search for an existing certificate covering the short domain. Reuse if present.
- **CloudFront distributions** — if the short domain is already fronted by CloudFront, prefer adding a CacheBehavior on the existing distribution over provisioning a parallel one.
- **Engagement EventBridge bus** — use the deployment's agreed shared engagement bus. **It may not exist yet** in the target account. If absent, Linoone provisions it under the agreed shared name (not a per-service variant) and documents in the architecture artifact whether ownership is temporary (transferable to a future shared-infrastructure repo) or permanent. Linoone publishes to it; never create a `short-url-events`, `linoone-events`, or per-service parallel bus.
- **Custom domain** — see `rules/infrastructure-discovery.md` for the dev domain decision tree. Dev accounts may not have a Route 53 hosted zone for the planned production domain; use the deployment's delegated subdomain pattern or fall back to the API Gateway default URL. Never block v1 on domain registration / DNS delegation work that requires another team.
- **CDK bootstrap qualifier** — verify with `aws ssm get-parameters-by-path --path /cdk-bootstrap/`. The default is `hnb659fds`. Some accounts use a custom qualifier; pass `--context @aws-cdk/core:bootstrapQualifier=<qualifier>` on all cdk commands when not default.
- **Amplify / payment portal** — if the 302 destination is hosted on Amplify, Linoone should not duplicate Amplify infra; it 302s to the existing app.

Document the reuse decision (account ID, resource ID) in the architecture artifact. Justify any new provisioning explicitly.

## Forbidden Patterns

- **No `channel` field in DDB or in the event payload.** Channel travels in `target_url` query params and `created_by`.
- **No `metadata` blob, `webhook_url`, or `correlation_id` in DDB or in the event payload.** Producers keep their own correlation tables.
- **No caller-supplied producer identity.** `created_by` is derived from IAM principal identity or a server-side mapping. Do not accept `x-producer-identity` or any equivalent request-provided field.
- **No business concepts in DDB or in the event payload** (`account_id`, `message_id`, `template_family`, `person_id`). They live in `target_url` query params if the producer wants the destination to see them, and in the producer's own table for backend correlation.
- **No graph writes from Linoone.** Consumers do graph writes from their EventBridge handlers, using their lexicon only.
- **No downstream business-system calls from Linoone.** Consumer responsibility.
- **No `LifecycleTable` updates from Linoone.** Consumer responsibility.
- **No webhooks.** EventBridge is the notification path. Per-token webhook URL storage is forbidden.
- **No per-channel resolver paths** (`/s/`, `/e/`, `/<ref>/`). One path: `/<token>`.
- **No GSIs** on `message_id`, `account_id`, or any business field. The only access pattern is GetItem by `token`.
- **No invented graph labels** in consuming products (`Decision`, `Click`, `ShortUrl` as a vertex, etc.). Consumers must use their lexicon.
- **No legacy click pipelines beside the engagement bus.** The consumer's graph or data store is the canonical historical store. The engagement bus is the real-time stream.
- **No per-service EventBridge buses.** Publish to the shared engagement bus.

## Anti-Pattern: The Coupled-Resolver Mistake

A previous design proposed putting suppression checks, graph writes, and downstream-system calls **inside the resolver**. This couples Linoone to one business domain, makes the resolver impossible to reuse for other products, introduces 200–500ms of latency to every redirect, and makes downstream outages break short-link redirects entirely.

The correct shape: resolver does only GetItem → expiry check → PutEvents → 302. All channel-specific work happens in subscriber Lambdas, asynchronously, with no impact on the customer redirect.

## Anti-Pattern: The Channel-In-DDB Mistake

A previous design stored `channel` as a first-class DDB attribute. This:

- Re-introduces business coupling into a generic service.
- Cannot be extended to YouTube links, marketing tweets, or partner URLs without polluting the schema.
- Duplicates information that already exists in `created_by` and in `target_url` query params.

The correct shape: `channel` is recovered from `created_by` (producer identity) and from `target_url` query params (destination signal). Linoone never knows the word "channel."

## Anti-Pattern: The Webhook-Per-Token Mistake

A previous design proposed storing a per-token `webhook_url` and having the resolver POST to it on each click. This:

- Tightly couples Linoone to each consumer's URL and auth scheme.
- Forces Linoone to build and maintain HTTP signing, retries, and DLQ logic.
- Doesn't generalize to the broader engagement-bus backbone (every product would build its own webhook layer).
- Soofi explicitly rejected this in favor of EventBridge as the company-wide lag-event backbone.

The correct shape: EventBridge is the notification path. Consumers subscribe once with rules. Retries and DLQs are AWS-native. Schema registry holds the contract.

## Anti-Pattern: The Invented-Graph-Label Mistake

A previous short-link build proposed writing new `Decision` and `Click` vertices to a consumer graph without first confirming those labels existed in that consumer's lexicon. **Linoone itself never writes to the graph** — but when advising consuming products on what to do with click events, search the consumer's lexicon first, escalate with a lexicon PR if genuinely missing, never invent locally.

## Anti-Pattern: The Parallel Click Pipeline

Legacy short-link systems often fan clicks into ad hoc queues, object-storage buckets, or warehouse mirrors. Replacing that stack means treating the engagement bus plus the consumer-owned historical store as the canonical real-time and historical path. Any proposal to keep "a parallel click bus for analytics" or "a warehouse mirror for dashboards" reintroduces the same anti-pattern.

## Cross-Channel Considerations

The same Linoone-built service supports any channel with **zero per-channel code**:

- **Notification products** — producer identity such as `notification-sender`. Click handling is owned by the notification product, not by Linoone.
- **Email products** — producer identity such as `email-sender`. Click handling is owned by the email product, not by Linoone. If an email provider emits its own click webhook, it lands as a separate EventBridge event from the email product.
- **Letters (future)** — producer identity `letter-sender`. Letter click handling is owned by the letter product. **Linoone code does not change.**
- **Marketing / partner URLs** — sender identity in their own namespace. Same generic flow. **Linoone code does not change.**

The litmus test for the design: *"can a marketing engineer tomorrow shorten a YouTube link with this service, with no Linoone code change?"* If yes, the design is right. If no, the design has business coupling that needs to be removed.

## V1 Scope — What Ships First

A first deploy ("v1") is intentionally narrow. The scope below is the minimum viable Linoone service. Anything beyond it is deferred to v1.1+ and called out explicitly in the README.

**v1 (must-have for first deploy):**

- `POST /shorten` API, IAM-signed, internal callers only
- `GET /<token>` resolver, public, behind API Gateway (custom domain optional in v1)
- DDB `ShortUrlsTable` with the locked eight-field schema
- EventBridge `PutEvents` of `ShortUrlVisited` v1.0.0 to the shared engagement bus
- SQS click DLQ + replay Lambda
- CDK stacks for at least the dev account
- Vitest unit tests + one end-to-end integration test (mint → click → verify event)
- `INFRASTRUCTURE.md` (or README section) capturing reuse decisions and account/region

**Deferred to v1.1+ (mention in README, do not build):**

- `ShortUrlIssued` event publication on every mint
- `ShortUrlResolveFailed` event publication on 404/410/5xx
- Caller-registered "soft-expired redirect URL" (v1 returns 410 Gone)
- EventBridge Schema Registry registration (define the schema in code in v1; formal registry registration comes when a second consumer needs typed clients)
- Custom production domain (added once DNS/cert delegation is sorted)
- Visit-count operational dashboard

## Checklist

Before considering a Linoone-built short-URL service ready, confirm:

- infrastructure discovery completed for every target account; findings recorded in `INFRASTRUCTURE.md`
- service is generic — no business concepts in DDB or in the event payload
- DDB has exactly the eight fields: `token`, `target_url`, `created_at`, `created_by`, `soft_expires_at`, `hard_expires_at`, `visit_count`, `last_visited_at`
- no GSIs; the only access pattern is GetItem by `token`
- single resolver path `/<token>`
- resolver order of operations matches Section "Resolver Order Of Operations"
- resolver does NOT call downstream business systems, NOT write to the graph, NOT update any lifecycle table
- synchronous `PutEvents` to the shared engagement bus before the 302
- click DLQ + replay Lambda configured; alarms on DLQ depth
- event payload matches `rules/event-schema.md` v1.0.0 exactly
- `source = shorturl`, `detail-type = ShortUrlVisited`
- `created_by` derived from IAM principal, not accepted from caller, follows producer slug convention
- consumers subscribe in their own CDK stacks with EventBridge rules; Linoone's CDK has zero consumer enumeration
- consumers dedupe by `event_id` and use only their lexicon for any graph writes
- no webhooks, no per-service buses, no warehouse mirror, no object-storage click bucket, no cache-backed click pool
- reuse decisions documented for Route 53, ACM, CloudFront, the engagement bus, Amplify
