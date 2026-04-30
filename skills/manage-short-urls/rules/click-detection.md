# Click Detection Contract

A Linoone-built short-URL service must answer the question "how do we know a specific short URL was clicked?" explicitly and the same way every time. This rule encodes that contract.

## 1. What Is A Click

The click event IS the Resolver Lambda invocation. Every `GET /<token>` against the resolver's API Gateway endpoint equals exactly one click. There is no separate detector, no log scraper, no analytics SDK, no client-side beacon.

By the time `resolve.ts` line 1 executes, a click has happened. The handler's only job is to record it durably (via EventBridge) and 302.

## 2. How A Click Is Recorded (Never Lost)

Strict order, before the 302 returns:

1. **Synchronous EventBridge `PutEvents`** of `ShortUrlVisited` to the shared engagement bus. Schema is locked in `rules/event-schema.md` (v1.0.0). Latency budget p95 < 50 ms. Retry budget 2 attempts within 200 ms total via the AWS SDK's built-in retry. Treat the call as successful only when `FailedEntryCount === 0`; an HTTP 200 with failed entries is still a failed publish and must go to the click DLQ.

2. **DLQ on `PutEvents` failure.** If the synchronous publish fails after the retry budget, the resolver enqueues the raw click context to the click DLQ (SQS) and **still 302s**. A small replay Lambda drains the DLQ with exponential backoff and retries `PutEvents`. **A click is never dropped** — it is on the engagement bus, or in the DLQ on its way to the bus.

3. **Asynchronous DDB `UpdateItem`** on the row: `ADD visit_count :one, SET last_visited_at = :now`. This is operational state for Linoone's own dashboards and ops queries. **It is not part of the published event.** Failures logged but do not block the redirect.

4. **302** to `target_url`.

The resolver does **not** write to a graph, does **not** call downstream business systems, does **not** update lifecycle tables, and does **not** check suppression beyond the soft/hard expiry attributes on the DDB row. All of those are consumer responsibilities.

## 3. How Consumers Process A Click

Each consuming product subscribes to the engagement bus with its own EventBridge rule and its own Lambda. The consumer's Lambda is where business logic lives.

### Standard consumer flow

```
1. Lambda receives ShortUrlVisited event from EventBridge
2. Dedupe: check if event_id has been processed; if yes, return
3. Look up token in consumer's own correlation table
   (e.g. a product maintains token → internal_id mapping)
4. Update graph using the consumer's lexicon only
   (e.g. set a product-owned clicked_at field = event.time)
5. Update consumer's lifecycle table
   (e.g. LifecycleTable[message_id].state = CLICKED)
6. Optional: call downstream business systems
7. Optional: apply post-click suppression policy
8. Mark event_id as processed
```

### Consumer's correlation table

Every producer that needs to correlate clicks back to its own business records maintains a small DDB table:

```
ProductTokenIndex:
  PK: token
  Attrs: internal_id, campaign_id, created_at
```

The producer writes to this table at issuance time (right after calling `POST /shorten`). The consumer's click handler reads from it on each event. Linoone has no awareness of this table.

## 4. How A Consumer Answers "Was Item X Clicked?"

Three equally valid query paths depending on the consumer:

| Consumer | Query | Consistency |
| --- | --- | --- |
| Operational ("is this specific internal item clicked, right now?") | Product-owned state table lookup → `state == 'CLICKED'` | Eventual |
| Authoritative ("which items in this campaign were clicked?") | Product-owned graph / historical store query → check `clicked_at` property | Strong if the graph / historical store is the consumer's source of truth |
| Real-time stream ("what just got clicked across all channels?") | Subscribe to `ShortUrlVisited` on the engagement bus | Real-time (sub-second from click) |

Pre-runtime enrichment and aggregate performance checks should use the consumer's historical store. Operational lifecycle tables are usually optimized for point lookups and should not be treated as analytics stores unless the consumer intentionally designs them that way.

## 5. Provider Reconciliation

Different products arrive at click detection with different signal counts. Treat the asymmetry explicitly in the **consumer Lambda**, not in Linoone. Linoone publishes one `ShortUrlVisited` event per resolver invocation regardless of channel or product.

### Provider-rewritten links (`created_by = email-sender`)

Some providers rewrite outbound URLs to flow through their own click-tracker first, then 302 to the original short URL. Result: **two click signals arrive**.

- **Provider CLICK webhook** → consumer product's provider webhook endpoint → published as a separate event (e.g. `<Product>ClickedByProvider`) on the engagement bus by that product.
- **Resolver `ShortUrlVisited` event** → published by Linoone when the provider's redirect lands on the resolver.

These are corroborating signals, not double-counts. The consumer de-dupes by its own business key and treats the resolver event as the canonical proof that the redirect reached the first-party resolver. If only the provider webhook arrives but not the resolver event, the redirect chain is broken — alarm-worthy.

### Direct-link products (`created_by = notification-sender`)

Some products deliver the resolver URL directly to the user. Clicks land directly on the resolver. **The resolver event is the only click signal** for these products, by design. There is no provider CLICK webhook to reconcile against. Do not add one; do not synthesize one from delivery webhooks.

### Future Channels

When introducing a new channel, declare its click-signal model explicitly:

- Does the provider rewrite URLs and emit CLICK webhooks? If yes, follow the email reconciliation pattern in the consumer Lambda.
- Does the provider deliver the URL untouched? If yes, follow the direct-link pattern (resolver event is the only signal).

In both cases, **Linoone does not change**. Only the consumer Lambda knows about the channel's reconciliation needs.

## 6. Failure Modes

| Failure | Outcome | Mitigation |
| --- | --- | --- |
| EventBridge `PutEvents` fails | Click → DLQ; resolver still 302s; replay Lambda lands it later | Alarm on DLQ depth and replay Lambda errors |
| Resolver Lambda errors before `PutEvents` (5xx) | Browser sees 5xx; no event published; click is lost | API Gateway retry policy; CloudWatch alarm on resolver 5xx rate |
| Consumer Lambda fails to process event | EventBridge retries automatically; eventually parks in consumer-owned DLQ | Consumer team owns alarming on its own DLQ |
| Consumer doesn't dedupe by `event_id` | Same click recorded multiple times in graph / lifecycle | Code review; integration test that verifies idempotent processing |
| Provider webhook missed | Resolver event still arrives; lifecycle still flips to CLICKED if the consumer uses resolver clicks as canonical | Acceptable when the resolver event is canonical |
| Both provider webhook AND resolver missed | Click is genuinely unobserved | Alarm: provider CLICK rate >> resolver invocation rate would surface it |

## Forbidden Click-Path Patterns

- **Logging clicks to S3 instead of EventBridge when the bus is unavailable.** The DLQ + replay path is the only acceptable degraded mode.
- **Ignoring `PutEvents.FailedEntryCount`.** EventBridge can return HTTP success while individual entries fail. Any failed entry must be treated as publish failure and DLQed.
- **Treating a provider CLICK webhook as a substitute for the resolver event.** They are independent corroborating events on the engagement bus, de-duped at the consumer.
- **Counting both the provider webhook event AND the resolver event as separate clicks for the same business item.** Consumer must de-dupe.
- **Inferring a click from a delivery webhook when the provider has no native click webhook.** Direct-link clicks come from the resolver. Period.
- **Building a separate SQS bus to fan click events into analytics consumers.** Analytics subscribes to the engagement bus.
- **Putting business logic in the resolver.** The resolver publishes events. Period. Graph writes, downstream-system calls, lifecycle updates, suppression checks — all consumer responsibilities.
- **Subscribing to clicks via webhook URLs stored per token.** EventBridge subscriptions are configured once in CDK, not stored per token in DDB.
