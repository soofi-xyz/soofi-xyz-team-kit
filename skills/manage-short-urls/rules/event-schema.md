# `ShortUrlVisited` Event Schema (v1.0.0 — LOCKED)

This rule defines the authoritative event schema published by the Linoone resolver to the shared engagement EventBridge bus on every short-URL click. It is locked — any change requires a coordinated schema-version bump, dual-publish window, and consumer migration.

## 1. The Event On The Wire

What every consumer's Lambda receives:

```json
{
  "version": "0",
  "id": "9e6f1d2a-3b8c-4d2e-9f1a-1234567890ab",
  "account": "014948052063",
  "time": "2026-04-29T19:28:00Z",
  "region": "us-east-2",
  "source": "shorturl",
  "detail-type": "ShortUrlVisited",
  "resources": [],
  "detail": {
    "schema_version": "1.0.0",
    "event_id": "ev_01HVABCDEFGHJKMNPQRSTUVWXY",
    "token": "abc123",
    "target_url": "https://example.com/landing?campaign=renewal",
    "created_by": "producer-a",
    "ip": "203.0.113.42",
    "user_agent": "Mozilla/5.0 (iPhone)"
  }
}
```

The fields above the dashed line in the table below are AWS-assigned envelope fields. The fields inside `detail` are written by the resolver.

## 2. Field Reference

### Envelope (AWS-assigned, except `source` and `detail-type`)

| Field | Type | Set by | Purpose |
| --- | --- | --- | --- |
| `version` | string | AWS | EventBridge envelope version (always `"0"` today) |
| `id` | string | AWS | Per-delivery UUID assigned by EventBridge |
| `account` | string | AWS | AWS account ID where the event was published |
| `time` | string (ISO 8601) | AWS | Wall-clock time the event was accepted by `PutEvents` |
| `region` | string | AWS | AWS region where the event was published |
| `source` | string | resolver | Always `shorturl`. Primary EventBridge filter key. Identifies the short URL product, not any consuming product. |
| `detail-type` | string | resolver | Always `ShortUrlVisited` (for click events). |
| `resources` | array | resolver | Always `[]` — Linoone does not associate events with specific AWS resource ARNs. |

`source` is mandatory for EventBridge custom events. `PutEvents` requires `Source`, and the delivered event envelope will include it even though it is not part of the service-owned `detail` schema.

### `detail` (Linoone-controlled)

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `schema_version` | string (semver) | yes | Always `"1.0.0"` for this schema. Lets consumers branch on schema versions during evolution. |
| `event_id` | string (`ev_` + 26-char ULID) | yes | Per-click unique ID for consumer-side idempotency. EventBridge can deliver the same event twice on retry; consumers MUST dedupe by this field. |
| `token` | string (10 chars, base62) | yes | The short-URL token. Consumers' lookup key into their own correlation tables. |
| `target_url` | string (URL, ≤2048 chars) | yes | Full destination URL. Treated as opaque by the service. Consumers parse query string for custom context if they need it. |
| `created_by` | string (producer slug) | yes | Producer identity, derived from the IAM principal that called `POST /shorten`. Primary filter for per-producer EventBridge fan-out. Examples: `producer-a`, `email-sender`, `campaign-bot`. |
| `ip` | string (IPv4/IPv6) | yes | Source IP of the click request. Subject to retention policy (default 90 days in event archive, then redacted). |
| `user_agent` | string (≤1024 chars) | yes | User-Agent header from the click request. Subject to retention policy. |

**Seven detail fields. Every one passes the "is this knowable from somewhere else, more cheaply?" test.** Consumers use the EventBridge envelope `time` as the click timestamp.

## 3. Forbidden Event Fields

These have all been considered and **explicitly rejected**. Re-introducing any of them is the wrong instinct.

| Forbidden field | Why it's not in the schema |
| --- | --- |
| `channel` | Recovered from `target_url` query params or `created_by`. Putting it in the event re-introduces business coupling Linoone is designed to avoid. |
| `account_id`, `message_id`, `template_family`, `person_id` | Producer-specific business concepts. Consumers maintain their own correlation tables keyed by `token`. |
| `metadata` (opaque blob) | Anti-pattern: encourages producers to stuff arbitrary context, which then gets parsed differently by every consumer. Use `target_url` query params for what the destination needs to see; use the producer's own correlation table for what consumers need to see. |
| `webhook_url` | EventBridge replaces webhooks. Per-token consumer URL storage is forbidden. |
| `correlation_id` (free-form) | Re-introduces metadata blob through a side door. Producers maintain their own correlation tables. |
| `visit_count` / `is_first_visit` | Derivable by counting graph events. DDB has it as operational state for Linoone's dashboards; the event payload does not. |
| `target_host` / `target_path` (pre-parsed from `target_url`) | Trivially derivable by consumers (`new URL(target_url).host`). No need to pre-parse. |
| `template_identifier`, `contact_point_id`, `email_address` | Producer-specific. Producer's own table. |
| `session_id` | A destination-app concept, not a click concept. The destination app generates session IDs at landing; session events can be joined with click events by the consuming product using its own identifiers and timing. |

## 4. Producer Code (Resolver `PutEvents` Call)

The exact shape the resolver Lambda emits:

```typescript
import { EventBridgeClient, PutEventsCommand } from "@aws-sdk/client-eventbridge";
import { ulid } from "ulid";

const eventBridge = new EventBridgeClient({});

await eventBridge.send(new PutEventsCommand({
  Entries: [{
    EventBusName: "<shared-engagement-bus>",
    Source: "shorturl",
    DetailType: "ShortUrlVisited",
    Detail: JSON.stringify({
      schema_version: "1.0.0",
      event_id: `ev_${ulid()}`,
      token: row.token,
      target_url: row.target_url,
      created_by: row.created_by,
      ip: event.requestContext.http.sourceIp,
      user_agent: event.headers["user-agent"] ?? "",
    }),
  }],
}));
```

Notes:

- `EventBusName` is always the shared engagement bus, never a per-service bus.
- `event_id` is generated fresh per click using ULID (lexicographically sortable, time-ordered).
- Consumers use the EventBridge envelope `time` as the click timestamp; do not duplicate it in `detail.created_at`.
- `created_by` is read from the DDB row (which got it from the IAM principal at issuance) — the resolver does not derive it from the request.
- The resolver MUST inspect `PutEvents` output and treat any `FailedEntryCount > 0` as publish failure even if the AWS SDK call itself returned successfully.

## 5. Consumer Subscription Examples

### Product click handler — filter to its own producer's tokens

```typescript
new events.Rule(this, "ProductClickRule", {
  eventBus: engagementBus,
  eventPattern: {
    source: ["shorturl"],
    detailType: ["ShortUrlVisited"],
    detail: { created_by: ["producer-a"] },
  },
  targets: [new targets.LambdaFunction(productClickHandler)],
});
```

### Graph consumer — subscribe to short-url click events

```typescript
new events.Rule(this, "GraphShortUrlClickRule", {
  eventBus: engagementBus,
  eventPattern: {
    source: ["shorturl"],
    detailType: ["ShortUrlVisited"],
  },
  targets: [new targets.LambdaFunction(graphIngestHandler)],
});
```

### Marketing analytics — every short-URL click regardless of producer

```typescript
new events.Rule(this, "MarketingShortUrlRule", {
  eventBus: engagementBus,
  eventPattern: {
    source: ["shorturl"],
    detailType: ["ShortUrlVisited"],
  },
  targets: [new targets.LambdaFunction(analyticsHandler)],
});
```

## 6. Consumer Idempotency Contract (Required)

EventBridge guarantees **at-least-once** delivery, not exactly-once. The same event payload (with the same `event_id`) may be delivered to the same consumer Lambda more than once during retries.

Every consumer MUST implement idempotency keyed on `detail.event_id`. Patterns:

- **DDB conditional write**: `PutItem(EventLog) ConditionExpression="attribute_not_exists(event_id)"`. If the condition fails, the event was already processed; return successfully.
- **DynamoDB optimistic lock on the target row**: `UpdateItem ConditionExpression="last_event_id <> :event_id"` and set `last_event_id = :event_id` on success.
- **Idempotent operations**: if the consumer's only effect is "set `clicked_at` to a fixed value derived from the event," the operation is naturally idempotent and an explicit dedupe step is optional.

Failure to dedupe results in double-recorded clicks, inflated analytics, and duplicate downstream side effects. Consumers that do not implement idempotency should not subscribe to this event.

## 7. JSON Schema (For EventBridge Schema Registry)

Register this in EventBridge Schemas so consumers get auto-generated typed clients:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.example.com/shorturl/ShortUrlVisited/1.0.0",
  "title": "ShortUrlVisited",
  "description": "Emitted by the Linoone short-URL service every time a short URL is clicked. At-least-once delivery; consumers MUST dedupe on event_id.",
  "type": "object",
  "required": [
    "schema_version",
    "event_id",
    "token",
    "target_url",
    "created_by",
    "ip",
    "user_agent"
  ],
  "additionalProperties": false,
  "properties": {
    "schema_version": {
      "type": "string",
      "const": "1.0.0",
      "description": "Semver of this event schema."
    },
    "event_id": {
      "type": "string",
      "pattern": "^ev_[0-9A-HJKMNP-TV-Z]{26}$",
      "description": "ULID prefixed with 'ev_'. Unique per click. Consumers MUST dedupe on this field."
    },
    "token": {
      "type": "string",
      "pattern": "^[0-9A-Za-z]{10}$",
      "description": "10-character base62 short-URL token."
    },
    "target_url": {
      "type": "string",
      "format": "uri",
      "maxLength": 2048,
      "description": "Full destination URL. Opaque to the service. Consumers parse query string for custom context."
    },
    "created_by": {
      "type": "string",
      "pattern": "^[a-z0-9]+(-[a-z0-9]+)*$",
      "minLength": 3,
      "maxLength": 64,
      "description": "Producer identity slug. Derived from IAM principal at issuance."
    },
    "ip": {
      "type": "string",
      "oneOf": [
        { "format": "ipv4" },
        { "format": "ipv6" }
      ],
      "description": "Source IP of the click request. Retention policy: 90 days in event archive, then redacted."
    },
    "user_agent": {
      "type": "string",
      "maxLength": 1024,
      "description": "User-Agent header from the click request. Retention policy: 90 days in event archive, then redacted."
    }
  }
}
```

`additionalProperties: false` ensures unknown fields are rejected. Adding fields requires a minor-version bump (`1.1.0`), a new schema document, and a coordinated migration window — old consumers ignore unknown fields if they update past the minor bump.

## 8. Schema Evolution Rules

| Change type | Version bump | Process |
| --- | --- | --- |
| Add a new optional field | minor (1.1.0) | New schema doc registered. Producer starts emitting the field. Consumers with old schema ignore it. |
| Add a new required field | major (2.0.0) | New schema doc. Dual-publish window: producer emits both 1.x and 2.0 events. Consumers migrate one by one. Retire 1.x after all consumers confirm migration. |
| Rename or remove a field | major (2.0.0) | Same as adding required field. |
| Tighten a constraint (e.g. shorten max length) | major (2.0.0) | Same as removing. |
| Loosen a constraint (e.g. lengthen max length) | minor (1.1.0) | Backward-compatible. |
| Change a field's semantic meaning without changing the name | major (2.0.0) | Treat as a remove + add, even though the field name persists. |

Never modify a published schema in place. Every change is a new registered version.

## 9. Sibling Event Types (Future)

The same Linoone service may publish additional event types as needs emerge. Each gets its own locked schema document in this rules directory:

| `detail-type` | When emitted | Schema |
| --- | --- | --- |
| `ShortUrlVisited` | On every successful click (302) | This document |
| `ShortUrlIssued` (future) | On `POST /shorten` success | TBD |
| `ShortUrlResolveFailed` (future) | On 404/410/5xx responses | TBD |
| `ShortUrlExpired` (future) | When a soft-expiration triggers | TBD |

These are not implemented in v1. Add them only when a consumer has a documented need. Each will follow the same envelope conventions: `source = shorturl`, `detail-type = <verb>`, `detail` carries `schema_version`, `event_id`, `created_by`, plus event-specific fields. Event time belongs in the EventBridge envelope `time` unless a future event type has a separate domain timestamp that differs from publish time.

## 10. Checklist For Locking A New Schema Version

When evolving this schema in the future, confirm:

- new schema document registered in EventBridge Schema Registry under a fresh `$id`
- producer code updated to emit the new shape
- all consumers identified and notified at least one sprint before the cutover
- if breaking, dual-publish window scheduled with explicit start and end dates
- old version retired only after every consumer confirms migration in writing
- this rule document updated to reflect the new version as the locked default
- the previous version's document moved to an archive section, not deleted
