---
title: Marketplace targets
impact: HIGH
tags: marketplace, targets, prism, soc, api-key
---

# Marketplace targets

Registeel operates one named target per request. Both run the same
`prismteam-ai/marketplace` service; only the values below differ.

| | Prism Marketplace (default) | SOC Marketplace |
| --- | --- | --- |
| Base URL | `https://prism-marketplace.account.prismteam.ai/marketplace` | `https://soc-marketplace.springoakscapital.com/marketplace` |
| Marketplace account | `848665034107`, `us-east-2` | `649445653420`, `us-east-2` |
| Build | `https://prism-marketplace.account.prismteam.ai/build` (same account) | `https://soc-marketplace.springoakscapital.com/build` (SOC's Build in `649445653420`, same account and key) |
| Review Deploy | `257779860257`, host `https://review-sandbox.account.prismteam.ai` | `919643791264`, `https://soc-marketplace-review.springoakscapital.com/deploy` (host `https://soc-marketplace-review.springoakscapital.com`) |
| `MARKETPLACE_API_KEY` | `shared-environment` key on the shared usage plan (skill Prerequisites step 2) | The SOC-MARKETPLACE Account key (Account `a0064d81-c26d-48c5-880d-1cedeab56a11`) |
| Catalog | Prism products and their service bundles | SOC-specific configurations (for example SMS opt-out/opt-in, email, voicemail) and SOC-only products |

## SOC Marketplace catalog

SOC Marketplace takes products such as Connect from Prism Marketplace. It holds
a bare product entry for each (no service bundle) only so SOC configurations can
attach: Marketplace validates `configured_product_id` locally. Never publish a
Prism product's service bundle to SOC Marketplace, and never register SOC
configurations in Prism Marketplace.

SOC configuration bundles are built by SOC's Build in `649445653420` and
reviewed by SOC's review Deploy in `919643791264`. Never build a SOC bundle
with Prism Marketplace's Build.

Registered bare entries (family `Prism`, category `Platform`, no components).
Each Marketplace mints its own UUIDs, so the two ids differ:

| Product | SOC Marketplace `product_id` (use as `configured_product_id`) | Prism Marketplace `product_id` (use in `dependencies`) | `component_id` |
| --- | --- | --- | --- |
| System | `eabe1e56-93b9-4961-978f-0ecacada36f5` | `f0d72585-e739-45dc-831d-1e579fdbee07` | `system` |
| Connect | `4cdec29f-9a9d-4622-940e-b135eabc3ca7` | `562afa37-5bff-4cd5-9b25-9f04140aae27` | `connect` |
| Transform | `b2266fdd-23e5-4e62-9f3d-3f5cc478d683` | `1d50ab1f-2e78-4b11-8444-59094eb3b4d3` | `transform` |

A SOC configuration attaches to the SOC entry (`configured_product_id`) and
declares the Prism service it needs in its `marketplace.product.json`, for
example `"dependencies": [{ "product_id": "562afa37-5bff-4cd5-9b25-9f04140aae27", "component_id": "connect" }]`.
Deploy then installs Connect from Prism Marketplace. Read the current ids with
`GET /ontology` before registering; add a missing bare entry only when a SOC
configuration needs it, and confirm it with the user first.

## Check SOC Marketplace before writes

Before any SOC write, run the skill's key check (`GET /settings/status`)
against the SOC base URL. Stop and report when it does not return `200` with
`component_publication.is_operational: true`: a connection or DNS failure
means the SOC domain is down; `401` or `403` means the key is wrong; listed
conflicts mean review settings are missing. Do not fall back to Prism
Marketplace or an `execute-api` host.

## SOC Marketplace key

Use the SOC-MARKETPLACE Account key (Account
`a0064d81-c26d-48c5-880d-1cedeab56a11`). Never ask the user to paste it into
chat and never ask for AWS access. The user gets it from its owner, or exports
it from their local Account key file in their own terminal:

```bash
export MARKETPLACE_API_KEY="$(tr -d '\n' < ~/.prism/keys/soc-marketplace.account-key)"
```

Then set, restart and check exactly as the skill's Prerequisites step 2
describes.
