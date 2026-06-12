# Click Detection Contract

A click is the resolver Lambda invocation for `GET /{token}`. There is no log scraper, browser beacon, analytics SDK, warehouse query, or provider webhook required to detect the first-party click.

## What Counts As A Click

Every valid resolver request that finds a `short_url` vertex in Persist is a click attempt and must produce a click graph fact before redirecting.

Invalid token format or missing token returns `404` and does not produce `short_url.visited`.

## Resolver Order

Strict order:

1. Validate token format.
2. Query Persist by `short_url_token`.
3. If no record is found, return `404`.
4. Build `GraphFactProduced` detail with `fact_type = short_url.visited`.
5. Publish to EventBridge with:
   - `Source = shorturl`
   - `DetailType = GraphFactProduced`
6. If EventBridge publish fails or has failed entries, send the graph fact to SQS click DLQ.
7. Return `302` to `target_url`.

The redirect should still happen if EventBridge fails and the DLQ write succeeds.

## Durable Recording

The durable click path is:

```text
Resolver invocation
  -> EventBridge GraphFactProduced
  -> graph consumer / Persist ingestion
```

Degraded path:

```text
Resolver invocation
  -> EventBridge publish failed
  -> SQS click DLQ
  -> Replay Lambda
  -> EventBridge GraphFactProduced
```

No separate DynamoDB visit counter is required for the core service. Click history is represented by `short_url.visited` graph facts.

## Required Click Evidence

The graph fact must include:

- event identifier
- short URL token
- full short URL path
- target URL
- source IP
- user agent
- effective click timestamp

Server-managed `created_at` is not sent by the resolver. Producer identity (`created_by`) is not part of the contract and must not appear on `short_url` vertices.

## Consumer Processing

Consumers subscribe to `GraphFactProduced` events and are responsible for their own business logic.

Standard consumer flow:

```text
1. Receive GraphFactProduced from EventBridge.
2. Dedupe by idempotency_key or event_identifier.
3. Ingest GraphSON or parse the graph fact.
4. Join to the consumer's own records if needed.
5. Update consumer-owned state or analytics.
```

The resolver does not:

- update lifecycle tables
- call downstream business systems
- run suppression logic
- classify campaign/channel/account/message semantics
- write to a warehouse

## Provider Reconciliation

Some providers rewrite links and may emit their own click webhooks. Treat those as separate provider-owned events. The resolver click fact remains canonical evidence that the browser reached the first-party resolver.

Consumers decide how to reconcile provider click events with resolver `short_url.visited` graph facts. Linoone does not change per channel or provider.

## Failure Modes

| Failure | Outcome | Mitigation |
| --- | --- | --- |
| Persist lookup fails | Resolver returns 500; no redirect because target is unknown | Alarm on resolver lookup errors |
| EventBridge publish fails | Graph fact goes to click DLQ; resolver still redirects | Alarm on DLQ depth and replay failures |
| DLQ write fails after EventBridge failure | Click may be lost; resolver should log loudly | Alarm on `click_lost` metric |
| Consumer fails | EventBridge retries and consumer-owned DLQ handles terminal failures | Consumer owns retry/DLQ alarms |
| Duplicate delivery | Consumer may see the same click more than once | Dedupe by idempotency key |

## Forbidden Click-Path Patterns

- Using DynamoDB as the click counter/source of truth.
- Requiring Snowflake or a warehouse to know whether a token was clicked.
- Publishing bespoke short-url click events instead of `GraphFactProduced` graph facts.
- Ignoring `PutEvents.FailedEntryCount`.
- Dropping a click when EventBridge fails instead of using SQS DLQ.
- Blocking redirect on downstream business consumers.
- Adding webhook URLs per token.
- Adding channel-specific resolver code.
- Adding arbitrary metadata blobs to click facts.
