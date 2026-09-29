# Invocation contract — sale-availability

`POST /products/sale-availability/invocations`

| Field | Value |
| --- | --- |
| `invocation_mode` | `single` |
| `product_flow_name` | `default` (optional; the default product flow is selected otherwise) |
| `data` | Exactly one of `address` or `parcelId`, validated against the Product request schema |
| `callback_url` | Optional |

## Status gates

| Case | Expected result | Success criterion |
| --- | --- | --- |
| Known `parcelId` or `address` | Invocation `COMPLETED`; output matches the response schema with at least one evidence entry | `invocation-known-key` |
| Unknown identifier | Invocation `FAILED` with error `UNKNOWN_IDENTIFIER`; no partial output | `unknown-id-closed` |
| Both or neither identifier | `400` from request-schema validation before any flow starts | `manifest-valid` |

The request path reads curated artifacts only. It never calls Connect or a
public website during an invocation (`no-scrape`).

Both invocation criteria stay `deferred` until a Product deployment accepts the
definition, template and flow, and Connect/Transform have produced curated
artifacts.
