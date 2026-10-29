---
title: Marketplace targets
impact: HIGH
tags: marketplace, targets, prism, custom-marketplace, api-key
---

# Marketplace targets

Registeel operates one target per request: Prism Marketplace (the default) or a
custom marketplace the user names. Every target runs the same
`prismteam-ai/marketplace` service; only the values below differ.

| | Prism Marketplace (default) | Custom marketplace |
| --- | --- | --- |
| Base URL | `https://prism-marketplace.account.prismteam.ai/marketplace` | `https://<host>/marketplace`, given by the user |
| Build | `https://prism-marketplace.account.prismteam.ai/build` | `https://<host>/build` (its own Build, same host and key) unless the user gives another |
| `MARKETPLACE_API_KEY` | `shared-environment` key on the shared usage plan (skill Prerequisites step 2) | That marketplace's Account key, from its owner |
| Catalog | Prism products and their service bundles | That organization's configurations and its own products |

Never store, list or guess custom marketplace hosts, accounts or catalog ids
in this kit or in output beyond the user's own request.

## Resolve the target

Use Prism Marketplace unless the user asks for another marketplace or
`MARKETPLACE_BASE_URL` is set to a base other than Prism's. For a custom
marketplace, ask for its base URL when the user has not given it; accept only
`https://<host>/marketplace` on a custom domain, never a raw `execute-api` host.
Ask when the user's wording and `MARKETPLACE_BASE_URL` disagree. Confirm the
target's base URL and Build URL before any write.

## Check a custom marketplace before writes

Before any write, run the skill's key check (`GET /settings/status`) against
its base URL. Stop and report when it does not return `200` with
`component_publication.is_operational: true`: a connection or DNS failure
means the domain is not live; `401` or `403` means the key is wrong; listed
conflicts mean its review settings are missing. Do not fall back to Prism
Marketplace or an `execute-api` host.

## Custom marketplace catalog

A custom marketplace takes products such as Connect from Prism Marketplace. It
holds a bare product entry for each (no service bundle) only so its
configurations can attach: Marketplace validates `configured_product_id`
locally. Never publish a Prism product's service bundle to a custom
marketplace, and never register its configurations in Prism Marketplace.
Build and review its bundles with its own Build and review Deploy, never
Prism Marketplace's.

Each marketplace mints its own UUIDs, so one product has different ids in
each. A configuration attaches to the custom marketplace's entry
(`configured_product_id`, read from its `GET /ontology`) and declares the Prism
service it needs in its `marketplace.product.json` with the Prism Marketplace
id, for example
`"dependencies": [{ "product_id": "<Prism Marketplace product_id>", "component_id": "connect" }]`.
Deploy then installs that service from Prism Marketplace. Add a missing bare
entry only when a configuration needs it, and confirm it with the user first.
