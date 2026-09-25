# Product runtime mapping

Map System composition fields onto the Product service model used by
[StaircaseAPI/product](https://github.com/StaircaseAPI/product) and specified
for rebuilds in [`build-product-service`](../../build-product-service/reference/PRD.md).

## Mental model

```text
System outcome (systemId)
  = Product (name ≈ systemId or explicit productName)
      + request/response JSON Schemas (+ OpenAPI view)
      + Product Flow Template(s)  → compile → Step Functions
      + Product Flow(s)           → require flow_template_name
      + optional Waterfall        → ordered flow failover
      + Invocations               → single_flow | waterfall
```

Leaf Products are **callees** inside the template (Connect jobs, Translate/
Language, Persist collections, reports/SMS/email Product routes), not a
replacement for Product.

## Manifest → Product artifacts

| Manifest / emit | Product surface |
| --- | --- |
| `systemId` / `title` | Product `name` (and metadata description) |
| Outcome request/response | `request_schema` / `response_schema` or `product_schema` |
| `configRefs` openapi | Product OpenAPI / custom endpoints |
| Flow template emit | `PUT .../flow-templates/{template_name}` DSL body |
| Product flow emit | `POST .../product_flows` with `flow_template_name` |
| Waterfall emit | `PUT .../waterfall` `{ waterfall: [{ priority, flow_name }] }` |
| Invocation success criteria | `POST .../invocations` contract + status checks |
| Leaf Connect/Transform/Lexicon | `StaircaseService` URLs + flow metadata — engines stay with Lapras/Kecleon/Conkeldurr |

## Flow Template DSL (composition primitive)

Authors use Product DSL states. The critical composition step is
`StaircaseService`:

- Calls `https://{tenant DomAIN}/{relative URL}` with `x-api-key`
- Injects JSONPaths from `$.flow_input`, `$.product`, `$.product_flow`,
  `$.states.<Step>.output...`
- Optional `CallbackSettings` → wait-for-task-token webhook completion

Other DSL types: `Choice`, `Map`, `Parallel`, `Wait`, `Fail`, `Succeed`,
`SendCallback`, `PatchEvent`, `DownloadPublicContent`.

**Target platform rule (Soofi PRD):** every executable Product Flow must set
`flow_template_name`. Do not design Systems that depend on the legacy shared
default connector state machine.

## Waterfall vs template steps

| Concern | Where it lives |
| --- | --- |
| Ordered failover across alternate flows/vendors | Product **waterfall** |
| Branching / map / parallel / retries inside one flow | Flow **template** DSL |
| Batch Distributed Map / cost gates outside Product | Machamp + batch skill |

## When a thin System package is allowed

Use a fixture-backed TypeScript package only if:

1. No Product deployment can be integrated or provisioned in-session, and
2. The manifest marks Product orchestration as `deferred` with an owner, and
3. Success criteria say Product cutover is follow-on.

Otherwise serve through Product invocations.

## Agent split

| Work | Agent / skill |
| --- | --- |
| Outcome composition + emits | Zygarde / this skill |
| Product platform integrate vs provision | Conkeldurr / `build-product-service` |
| Template compile, SFN, waterfall verify | Machamp (with Product PRD) |
| Connect leaf | Lapras |
| Transform leaf | Kecleon |
| Lexicon leaf | Conkeldurr + `build-lexicon-product` |
