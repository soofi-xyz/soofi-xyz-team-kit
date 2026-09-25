# System composition — product contract

Build a **System** as a versioned business outcome delivered by configuring
the platform **Product** orchestration service so it composes leaf Products
(Lexicon, Connect, Transform, Persist, Deploy, and related capabilities).

This matches how [StaircaseAPI/product](https://github.com/StaircaseAPI/product)
works in production: a named Product with schemas/OpenAPI, Product Flow
Templates that compile to Step Functions, template-backed Product Flows,
optional waterfalls, and invocations. Presence of Zygarde /
`build-system-product` does **not** mean a deployable Product or System
package already exists in the caller's account.

Platform rebuild/integrate decisions for the Product *service* itself belong
to Conkeldurr + [`build-product-service`](../../build-product-service/SKILL.md).
Zygarde configures **outcomes on top of** that service.

## 1. Ownership and boundaries

```text
Business outcome
  → Zygarde composition.manifest
  → Product emits (definition, schemas, flow template DSL, flows, waterfall, invocation)
  → leaf emits (Lexicon / Connect / Transform / Persist / Deploy)
  → Conkeldurr applies Product configs (or provisions Product once)
  → Lapras / Kecleon / Persist implement leaf wiring
  → POST /products/{name}/invocations satisfies success criteria
```

| Owns | Does not own |
| --- | --- |
| Outcome statement and success criteria | Product template compiler / Dynamo topology |
| Composition manifest and emit stubs | JDBC/Spark Connect adapters |
| Product-shaped config (schemas, template DSL, waterfall) | Transform Glue engines |
| Mapping outcome → Product name + flows | Lexicon store / IPFS internals |
| Failure taxonomy for unknown inputs / failed waterfall | Marketplace catalog ownership |
| Optional thin package when Product is unavailable | Live website scraping unless an adapter exists |

## 2. Prism placement

| Layer | Role | Kit mapping |
| --- | --- | --- |
| Leaf Products | Acquire, translate, persist, deploy | Lapras, Kecleon, Lexicon, Persist, Deploy |
| **Product service** | Configurable orchestration of leaf Products | `build-product-service` / StaircaseAPI/product |
| **System (this skill)** | One business outcome as Product configuration + leaf emits | Zygarde |

Do not invent a fourth Spark pipeline under System. Do not collapse System
work into Connect or Transform skills alone. Do not rebuild Product under a
new name when an existing Product deployment can host the outcome.

## 3. Canonical runtime (from Staircase Product)

1. **Product definition** — `name`, request/response (or `product_schema`),
   examples, optional status mapping, OpenAPI settings.
2. **Product Flow Template** — DSL with `StaircaseService` (and Choice / Map /
   Parallel / Wait / Fail / Succeed / SendCallback / PatchEvent /
   DownloadPublicContent) compiled to a Step Functions state machine.
3. **Product Flow** — binds `flow_template_name` (required for execution) plus
   selection metadata (tags, active, marketplace ids).
4. **Waterfall** (optional) — ordered `{priority, flow_name}` failover across
   Product Flows — not steps inside a single template.
5. **Invocation** — `single_flow` or `waterfall`; correlates via
   `transaction_id` / collection ids; callbacks and status are first-class.

Cross-service composition uses relative platform URLs (for example Connect
`connector-jobs/...`, Language/Translate, Persist collections, nested Product
routes), not embedded secrets.

See [product-runtime.md](product-runtime.md) and
[implementation-evidence.md](implementation-evidence.md).

## 4. Non-goals

- Reimplementing Product, Connect, or Transform engines in this skill
- Reviving the legacy mortgage-default connector pipeline without templates
- Live scrape-on-request as the default path
- Claiming AWS pilot or Marketplace readiness from composition alone
- Duplicating a Product deployment when integrate-via-API is possible

## 5. Success definition

Composition is done when:

1. Manifest validates against `composition.manifest.schema.json`.
2. Product emits cover definition + at least one flow template + one
   template-backed flow (waterfall optional but documented).
3. Leaf `configRefs` name owners (Lapras / Kecleon / Conkeldurr / Machamp).
4. Success criteria are testable as Product invocations or explicitly deferred.

A separate thin System package is a **fallback**, not the default, and must
name a follow-on cutover to Product when used.
