---
title: Marketplace API contract summary
impact: HIGH
tags: marketplace, http, openapi
---

# Marketplace API contract summary

Use `CONFIGURATION` for configuration components in the target contract below.
The previous contract used `DATA`; verify catalog/publication migration in the
target revision before configuration-bundle writes. Hand missing support to
Regigigas instead of falling back to the legacy type. This requirement does not
prove deployed support; follow [the shared migration requirements](../../build-product-deployer/reference/configuration-bundles.md).

Authoritative source: [`prismteam-ai/marketplace`](https://github.com/prismteam-ai/marketplace)
→ `requirements/openapi.yaml`. Base path is the stack `ApiUrl` output, which
already ends with `/marketplace`. Auth: shared `x-api-key` on every route.

## Settings

| Method | Path | Notes |
| --- | --- | --- |
| `PUT` | `/settings` | `{ review_api_key, review_environment_hosts[] }` |
| `GET` | `/settings/status` | `component_publication.is_operational`, `conflicts[]` |

## Ontology

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/ontology` | Nested `{ families: [...] }` |
| `POST` | `/ontology/families` | `{ family_name }` → `{ family_id }` |
| `GET` | `/ontology/families` | List families |
| `DELETE` | `/ontology/families/{family_id}` | `409` if categories remain |
| `POST` | `/ontology/families/{family_name}/categories` | `{ category_name }` → `{ category_id }` |
| `GET` | `/ontology/families/{family_name}/categories` | List categories |
| `DELETE` | `/ontology/categories/{category_id}` | `409` if products remain |
| `POST` | `/ontology/categories/{category_id}/products` | `{ product_name }` → `{ product_id }` |
| `GET` | `/ontology/categories/{category_id}/products` | List products |
| `GET` | `/ontology/products/by-name?name=` | Lookup by global product name |
| `PATCH` | `/ontology/products/{product_id}/name` | `{ product_name }` |
| `DELETE` | `/ontology/products/{product_id}` | `409` if configs/components/refs |
| `GET`/`PATCH` | `/ontology/{families\|categories\|products}/{id}/metadata` | description, homepage, logotype_url, documentation, codex, asana_board_id |
| `POST`/`GET` | `/ontology/products/{product_id}/configurations` | `{ configuration_description, configured_product_id }` |
| `GET`/`PATCH`/`DELETE` | `/ontology/products/{product_id}/configurations/{configuration_id}` | |
| `POST`/`GET` | `/ontology/products/{product_id}/components` | `{ components: [{ component_id, type: SERVICE\|CONFIGURATION, description? }] }` |
| `GET`/`DELETE` | `/ontology/products/{product_id}/components/{component_id}` | |
| `GET` | `/ontology/components/search/{search_by}` | Search components |

## Bundles and reviews

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/ontology/products/{product_id}/components/{component_id}/bundle-uploads` | No body → `200` `{ upload: { url, fields }, bundle_url, expires_at }`; presigned S3 POST (15 min, ≤256 MiB zip, needs both metadata fields) and a 1-hour `bundle_url` for `PUT .../bundles` |
| `PUT` | `/ontology/products/{product_id}/components/{component_id}/bundles` | `{ bundle_url, skip_review? }` → `202` `{ review_id, bundle_status, ... }` |
| `GET` | `.../components/{component_id}/bundles` | `UPLOADING_IN_PROGRESS` \| `VALID` \| `FAILED`; hosted `bundle_url` when VALID |
| `POST` | `.../components/{component_id}/rollback` | Previous VALID; needs ≥2 VALID |
| `GET` | `/reviews/{review_id}` | `RUNNING` \| `SUCCEEDED` \| `FAILED` |

## Error tags

| Status | Tag |
| --- | --- |
| 400 | `ValidationError` |
| 404 | `OntologyEntityNotFound`, `RouteNotFound` |
| 409 | `CatalogConflict` |
| 422 | `BuildArtifactInvalid`, `ReviewEnvironmentInvalid` |
| 500 | `InternalError`, `ConfigurationError` |

## Out of scope on this API

Subscriptions, prices, site publication, customers, tenant environments, API key
minting, `POST /deploys`, Cognito login. Bundle install is Deploy/Puller, not a
Marketplace route. Do not invent those endpoints.
