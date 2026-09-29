---
name: operate-marketplace
description: "Operate the deployed Marketplace catalog API from prismteam-ai/marketplace: configure review settings, register ontology (families, categories, products, configurations, components), publish Build zips and poll reviews, and roll back VALID bundles. Use when registering or publishing products to Marketplace or checking review status."
---

# Operate Marketplace

Use `registeel`. Marketplace is deployed; this skill drives its live HTTP API.
Authoritative product: [`prismteam-ai/marketplace`](https://github.com/prismteam-ai/marketplace).
Treat that repo's `requirements/openapi.yaml`, `README.md`, and `AGENTS.md` as the
contract. Endpoint shapes and error tags are summarized in
[api-contract.md](reference/api-contract.md).

Do not use this skill to redesign multi-tenant Organizations, StackSets, or
Account Manager — that is `regigigas` + `build-saas-marketplace`. This product's
v1 surface is **catalog register + publish + review + rollback**. It does not
deploy into subscriber accounts. Do not invent subscriptions, prices, or site
publication APIs — `AGENTS.md` forbids them.

## Prerequisites

1. Resolve the base URL. Default DEV:
   `https://zj4wz2hu85.execute-api.us-east-2.amazonaws.com/dev/marketplace`
   Override with `MARKETPLACE_BASE_URL` only when the user names another host.
   The path must end with `/marketplace` (no trailing slash when concatenating).
2. Require `MARKETPLACE_API_KEY` (shared usage-plan `x-api-key`). Marketplace
   does not mint keys. Never echo or commit the value.
3. Prefer the repo scripts for DEV when they fit:
   - `./scripts/demo.sh` — register Prism / Platform / products (refuses
     non-`/dev/marketplace`)
   - `./scripts/publish-product.sh` — ensure component, PUT bundle, poll review
4. For manual calls, send `x-api-key` and `content-type: application/json` on
   every request.

## Workflow — pick the lane

Classify the request, then run exactly one primary lane (plus inspect as needed).

| Lane | When | Start at |
| --- | --- | --- |
| Settings | First non-skip publish, or review readiness unknown | §1 |
| Register | New family / category / product / configuration / component | §2 |
| Publish | New Build zip, review poll, rollback | §3 |
| Inspect | Read-only ontology, bundles, reviews, settings status | §4 |

Hand off and stop when:

| Finding | Owner |
| --- | --- |
| Marketplace Lambda/CDK/OpenAPI defect | `regigigas` with evidence; Marketplace repo PR |
| Integrate-vs-provision on the Marketplace deployment | `conkeldurr` |
| Need customers, environments, or API key minting | Tenant Account Manager product — not this API |
| Need to install a bundle into an account | Deploy / Puller — not Marketplace |
| Need Organizations / StackSets control-plane design | `regigigas` + `build-saas-marketplace` |
| Need subscriptions / prices / site publication | Out of scope for this product; do not invent routes |

## 1. Review settings (once per stage before non-skip publish)

1. `PUT /settings` with `{ "review_api_key": "...", "review_environment_hosts": ["https://<deploy-api>/dev"] }`.
2. `GET /settings/status` — require `status.component_publication.is_operational: true` before publishing with `skip_review: false`.
3. Do not print `review_api_key`. SSM paths on the Marketplace side are
   `/marketplace/{stage}/review-api-key` and
   `/marketplace/{stage}/review-environment-hosts`.

## 2. Register ontology

Canonical names are PascalCase ASCII `^[A-Z][A-Za-z]*$`, max 30. Uniqueness:
family name; category within family; product name globally; configuration pair;
`component_id` under a product. IDs are server-minted UUIDv4.

Typical sequence:

1. `POST /ontology/families` `{ "family_name": "Prism" }`
2. `POST /ontology/families/{family_name}/categories` `{ "category_name": "Platform" }` → `category_id`
3. `POST /ontology/categories/{category_id}/products` `{ "product_name": "Deploy" }` → `product_id`
4. Optional configurations:
   `POST /ontology/products/{product_id}/configurations`
   `{ "configuration_description", "configured_product_id" }`
5. Optional metadata:
   `GET` / `PATCH /ontology/{families|categories|products}/{id}/metadata`
6. Components:
   `POST /ontology/products/{product_id}/components`
   `{ "components": [{ "component_id": "deploy", "type": "SERVICE" }] }`
   (`SERVICE` or `DATA`)

Idempotency: treat `409 CatalogConflict` as success when the entity already
exists; resolve ids via `GET /ontology`, `GET /ontology/products/by-name?name=`,
or list routes. Deletes return `409` while children or references remain —
delete bottom-up.

System is a **product** name, not a catalog type. Do not invent Agent or
certification types.

## 3. Publish, review, rollback

1. Resolve `product_id`: `GET /ontology/products/by-name?name={Product}`.
2. Ensure the component exists (create with §2 step 6 if missing).
3. `PUT /ontology/products/{product_id}/components/{component_id}/bundles`
   `{ "bundle_url": "https://...", "skip_review": false }` → `202` with
   `review_id` and `bundle_status`.
4. Poll `GET /reviews/{review_id}` until `SUCCEEDED` or `FAILED` (scripts default
   timeout ~1200s). On failure, return `review_details` without inventing fixes.
5. `GET .../components/{component_id}/bundles` — for `VALID` rows, use the
   Marketplace-hosted `bundle_url` (short-lived presign). Statuses:
   `UPLOADING_IN_PROGRESS` | `VALID` | `FAILED`.
6. Rollback: `POST .../components/{component_id}/rollback` when at least two
   VALID bundles exist → `202`. `400` otherwise.

`skip_review: true` only before the first VALID bundle, and only with explicit
user acceptance of a draft. Production uploads expect a Build-produced CDK cloud
assembly zip; invalid artifacts return `422 BuildArtifactInvalid`.

Env vars for `publish-product.sh`: `MARKETPLACE_API_KEY`,
`MARKETPLACE_BUNDLE_URL`, `MARKETPLACE_PRODUCT_NAME`, `MARKETPLACE_COMPONENT_ID`,
optional `MARKETPLACE_COMPONENT_TYPE`, `MARKETPLACE_SKIP_REVIEW`,
`MARKETPLACE_REVIEW_TIMEOUT_SECONDS`, `MARKETPLACE_BASE_URL`.

## 4. Inspect (read-only)

Useful reads before or after writes:

- `GET /settings/status`
- `GET /ontology` — nested catalog dump
- `GET /ontology/families`, category/product/component list and search routes
- `GET /ontology/components/search/{search_by}`
- `GET /reviews/{review_id}`
- `GET .../bundles`

Prefer inspect over destructive deletes. Never delete a product that still owns
components or is referenced as `configured_product_id`.

## Safety

- Prefer `/dev/marketplace`. Require explicit user confirmation and a matching
  base URL for any production write.
- Never print secrets (`MARKETPLACE_API_KEY`, `review_api_key`).
- Do not claim Marketplace deployed a stack into a tenant — it only stores
  reviewed bundles.
- Record HTTP method, path, status, and error `tag` for every failed call.

## Return

Report: lane chosen; base URL stage; entities touched (names + ids); publish
`review_id` / final `bundle_status` / hosted `bundle_url` when relevant;
Persist confirmation only if `demo.sh` or an equivalent check was run; and any
handoff outside Marketplace.
