# `GraphFactProduced` Click Event Schema

This rule defines the EventBridge event emitted by the resolver on every observed short URL click.

The resolver does not emit a bespoke short-url click detail payload. It emits a generic graph-fact event so Persist or any graph consumer can ingest the click fact without a service-specific adapter.

## EventBridge Envelope

```json
{
  "version": "0",
  "id": "aws-assigned-event-id",
  "account": "123456789012",
  "time": "2026-05-24T13:00:00Z",
  "region": "us-east-2",
  "source": "shorturl",
  "detail-type": "GraphFactProduced",
  "resources": [],
  "detail": {
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
}
```

Envelope rules:

| Field | Value |
| --- | --- |
| `source` | `shorturl` |
| `detail-type` | `GraphFactProduced` |
| `time` | EventBridge accept time; consumers may use it as transport time |
| `detail` | Graph fact detail defined below |

## Detail Contract

| Field | Type | Required | Purpose |
| --- | --- | --- | --- |
| `schema_version` | string | yes | Graph fact envelope version. Current value: `1.0`. |
| `graphson_format` | string | yes | Current value: `graphson-v3`. |
| `fact_type` | string | yes | Current value for clicks: `short_url.visited`. |
| `entity_types` | string array | yes | Includes `short_url`. |
| `idempotency_key` | string | yes | Stable consumer dedupe key, normally `shorturl:{event_id}`. |
| `graphson` | object | yes | GraphSON v3 body with vertices and edges. |

## Click GraphSON

The click fact contains:

- one `short_url` vertex projection
- one `short_url_visited` edge

### `short_url` Vertex Projection

Required properties:

| Property | Purpose |
| --- | --- |
| `short_url_token` | 10-character base62 resolver token |
| `short_url_path` | Full public short URL |
| `target_url` | Destination URL |
| `created_by` | Producer slug derived at issuance |

Do not include `created_at`. Persist owns server-managed timestamps.

### `short_url_visited` Edge

Required properties:

| Property | Purpose |
| --- | --- |
| `event_identifier` | Per-click unique ID, normally `ev_` + ULID |
| `visitor_ip_address` | Source IP from API Gateway request context |
| `user_agent` | User-Agent header |
| `effective_at` | Click timestamp |

Optional query-derived properties are allowed only when:

- the graph schema defines the property
- the extraction is explicit and deterministic
- tests cover the extraction
- the field is not a free-form metadata escape hatch

## Producer Code Shape

```typescript
await eventBridge.send(
  new PutEventsCommand({
    Entries: [
      {
        EventBusName: "<shared-engagement-bus>",
        Source: "shorturl",
        DetailType: "GraphFactProduced",
        Detail: JSON.stringify({
          schema_version: "1.0",
          graphson_format: "graphson-v3",
          fact_type: "short_url.visited",
          entity_types: ["short_url"],
          idempotency_key: `shorturl:${eventId}`,
          graphson: {
            vertices: [shortUrlVertex],
            edges: [shortUrlVisitedEdge],
          },
        }),
      },
    ],
  }),
);
```

The resolver must inspect `FailedEntryCount`; HTTP success from EventBridge is not enough.

## EventBridge Filters

Graph consumer:

```typescript
new events.Rule(this, "ShortUrlGraphFactRule", {
  eventBus,
  eventPattern: {
    source: ["shorturl"],
    detailType: ["GraphFactProduced"],
    detail: {
      fact_type: ["short_url.visited"],
    },
  },
  targets: [new targets.LambdaFunction(graphFactConsumer)],
});
```

Producer-specific consumer:

```typescript
new events.Rule(this, "ProducerShortUrlClicksRule", {
  eventBus,
  eventPattern: {
    source: ["shorturl"],
    detailType: ["GraphFactProduced"],
    detail: {
      fact_type: ["short_url.visited"],
      graphson_format: ["graphson-v3"],
    },
  },
  targets: [new targets.LambdaFunction(consumerHandler)],
});
```

If a consumer needs `created_by` filtering, it can either:

- subscribe to all `short_url.visited` facts and filter after parsing GraphSON, or
- use a separate normalized projection event only if the event architecture explicitly introduces one.

Do not invent a second click event casually. The default transport is `GraphFactProduced`.

## Idempotency

Consumers dedupe using:

- `detail.idempotency_key`, and/or
- `event_identifier` inside the `short_url_visited` edge.

EventBridge is at-least-once. Every consumer must be idempotent.

## Forbidden Event Fields

Do not add these as top-level detail fields:

- `channel`
- `campaign`
- `account_id`
- `message_id`
- `template_family`
- `metadata`
- `webhook_url`
- `visit_count`
- `is_first_visit`
- `created_at`

If a deployment needs an additional graph property, add it to the graph schema and GraphSON, not as an arbitrary event detail blob.

## Future Events

The current service emits only click graph facts:

| EventBridge `detail-type` | `detail.fact_type` | When |
| --- | --- | --- |
| `GraphFactProduced` | `short_url.visited` | On resolver click before redirect |

Potential future facts such as issued or failed-resolution facts require an explicit schema update and tests.
