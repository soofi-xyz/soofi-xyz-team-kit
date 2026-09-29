---
name: operate-marketplace
description: "Operate the deployed Prism Marketplace catalog API from prismteam-ai/marketplace: configure review settings, register ontology (families, categories, products, configurations, components), check and fix product publish readiness, publish CDK cloud-assembly zips and poll reviews, and roll back VALID bundles. Use when registering or publishing products to Prism Marketplace or checking review status."
---

# Operate Prism Marketplace

Use `registeel`. Prism Marketplace is deployed; this skill drives its live HTTP API.
Call the target "Prism Marketplace" in all output; do not label it by stage.
Authoritative product: [`prismteam-ai/marketplace`](https://github.com/prismteam-ai/marketplace).
Treat that repo's `requirements/openapi.yaml`, `README.md`, and `AGENTS.md` as the
contract. Endpoint shapes and error tags are summarized in
[api-contract.md](reference/api-contract.md).

This product's v1 surface is **catalog register + publish + review + rollback**.
It does not deploy into subscriber accounts. Do not invent subscriptions, prices,
or site publication APIs — the product `AGENTS.md` forbids them. Do not redesign
Organizations tenancy, StackSets, or Account Manager from this skill.

## Prerequisites

1. Use this Prism Marketplace base URL:
   `https://706p38drc8.execute-api.us-east-2.amazonaws.com/dev/marketplace`.
   The path must end with `/marketplace` (no trailing slash when concatenating).
   Honor `MARKETPLACE_BASE_URL` only when the user sets a different one.
   Repo scripts default to an older host and refuse bases outside their allowed
   path — pass this URL as `MARKETPLACE_BASE_URL` when running them.
2. Require `MARKETPLACE_API_KEY` (shared usage-plan `x-api-key`). Prism
   Marketplace does not mint keys. It uses the key named `shared-environment`
   on the usage plan stored at SSM `/account/shared-usage-plan-id` in
   `us-east-2`. If the variable is unset, stop and give these steps, then wait.
   Do not run the lookup yourself, do not print the value, and do not ask the
   user to paste it into chat.

   Get it in their own terminal (prints only there). Use the AWS profile already
   selected for this account (`AWS_PROFILE=<selected-profile>`), region
   `us-east-2`:

   ```bash
   export AWS_REGION=us-east-2
   aws apigateway get-usage-plan-keys \
     --usage-plan-id "$(aws ssm get-parameter --name /account/shared-usage-plan-id --query Parameter.Value --output text)" \
     --query "items[?name=='shared-environment'].value | [0]" \
     --output text
   ```

   Set it for the process that launches Cursor, then fully quit and reopen Cursor
   so the agent can see it. An export in a terminal started after Cursor will
   not reach the agent.

   ```bash
   export MARKETPLACE_API_KEY='<value from the command above>'
   ```

   Ask them to reply once it is set. Confirm only that the variable is present
   (set or unset, and length if useful). Never echo the value.
3. Prefer the repo scripts when they fit:
   - `./scripts/demo.sh` — register Prism / Platform / products
   - `./scripts/publish-product.sh` — ensure component, PUT bundle, poll review
4. For manual calls, send `x-api-key` and `content-type: application/json` on
   every request.

## Workflow — pick the lane

Classify the request, then run exactly one primary lane (plus inspect as needed).

| Lane | When | Start at |
| --- | --- | --- |
| Settings | First non-skip publish, or review readiness unknown | §1 |
| Register | New family / category / product / configuration / component | §2 |
| Readiness | User wants to publish but has no `bundle_url`, or asks to make a product publishable | §3a |
| Publish | New cloud-assembly `bundle_url`, review poll, rollback | §3 |
| Inspect | Read-only ontology, bundles, reviews, settings status | §4 |

Hand off and stop when:

| Finding | Owner |
| --- | --- |
| Marketplace Lambda/CDK/OpenAPI defect | Stop; report evidence for a Marketplace repo change |
| Need customers, environments, or API key minting | Not this API |
| Need to install a bundle into an account | Deploy / Puller — not Marketplace |
| Need Organizations / StackSets control-plane design | Out of scope for this skill |
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

## 3a. Publish readiness (product not yet publishable)

Run this before §3 when the user has no `bundle_url`, or asks what their
product needs to publish. The product's own pack and publish steps produce the
bundle; do not route it through the Build or Comply services.

1. Ask for the product repository if it is not obvious, and check it out at
   its default branch.
2. Walk [publish-readiness.md](reference/publish-readiness.md): repository
   requirements (manifest, stage-neutral stacks, Lambda bundling and
   obfuscation, pack step, security scan, publish step, tests) and the S3 metadata Marketplace reads.
3. Report each item as ready, missing, or cannot verify, with evidence, and
   the concrete change for each missing item. Cite
   [Spring-Oaks-Capital-LLC/deploy#3](https://github.com/Spring-Oaks-Capital-LLC/deploy/pull/3)
   as the worked example.
4. When the user asks, make the changes: follow section D of that file on a
   new branch and open a pull request. Never push to the default branch,
   merge, deploy, or publish in this lane.
5. If the zip is ready but there is no `bundle_url`, give the upload and
   presign steps from section B2 of that file.
6. Add the real security scan and Lambda obfuscation from that file; the
   publish step writes `service-comply` and `obfuscated: true` only from
   their results. Never write a verdict by hand, and never name the Build
   service as issuer of metadata it did not produce.
7. Pack for review under a stage no live install uses in the Marketplace
   account (for example `review`).

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
user acceptance of a draft. Uploads must be a CDK cloud assembly zip with the
metadata in [publish-readiness.md](reference/publish-readiness.md) section B;
invalid artifacts return `422 BuildArtifactInvalid`.

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

- Use `https://706p38drc8.execute-api.us-east-2.amazonaws.com/dev/marketplace`.
  If the user names a different base URL, confirm it before any write.
- Never print secrets (`MARKETPLACE_API_KEY`, `review_api_key`).
- Do not claim Marketplace deployed a stack into a tenant — it only stores
  reviewed bundles.
- Record HTTP method, path, status, and error `tag` for every failed call.

## Return

Report: lane chosen; Prism Marketplace as the target; entities touched (names + ids); publish
`review_id` / final `bundle_status` / hosted `bundle_url` when relevant;
Persist confirmation only if `demo.sh` or an equivalent check was run; and any
handoff outside Marketplace.
