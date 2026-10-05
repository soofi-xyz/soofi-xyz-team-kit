---
name: operate-marketplace
description: "Operate the deployed Prism Marketplace catalog API from prismteam-ai/marketplace: configure review settings, register ontology (families, categories, products, configurations, components), check product publish readiness, build bundles through the Build service and publish them, poll reviews, and roll back VALID bundles. Use when registering or publishing products to Prism Marketplace or checking review status."
---

Use [the Marketplace capability map](../guide-product-work/reference/iterations/marketplace.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

Follow [guide-product-work](../guide-product-work/SKILL.md). Registeel configures Marketplace; Regigigas owns service implementation changes.

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
   `https://1ubssdfzw2.execute-api.us-east-2.amazonaws.com/dev/marketplace`.
   It runs in the Marketplace account `848665034107`, `us-east-2`.
   The path must end with `/marketplace` (no trailing slash when concatenating).
   Honor `MARKETPLACE_BASE_URL` only when the user sets a different one.
   Repo scripts default to an older host and refuse bases outside their allowed
   path — pass this URL as `MARKETPLACE_BASE_URL` when running them.
2. Require `MARKETPLACE_API_KEY` (shared usage-plan `x-api-key`). Prism
   Marketplace does not mint keys. It uses the key named `shared-environment`
   on the usage plan stored at SSM `/account/shared-usage-plan-id` in the
   Marketplace account `848665034107`, `us-east-2`. If the variable is unset,
   or the key check below returns `401` or `403`, stop and give these steps,
   then wait. A rejected key is usually a leftover from an older Marketplace
   install; tell the user so and include the step to clear it.
   Do not run the lookup yourself, do not print the value, and do not ask the
   user to paste it into chat.

   Offer both ways to get the key; the user picks the one that fits. The key
   is the only credential publishing needs, so neither way requires AWS access
   after this step.

   **a. Someone gave you the key** (for example a teammate, through a secure
   channel). Go straight to setting it below.

   **b. You have AWS access to the Prism Marketplace account `848665034107`.**
   Read it in your own terminal (prints only there), with a profile for that
   account (`AWS_PROFILE=<selected-profile>`), region `us-east-2`:

   ```bash
   export AWS_REGION=us-east-2
   aws apigateway get-usage-plan-keys \
     --usage-plan-id "$(aws ssm get-parameter --name /account/shared-usage-plan-id --query Parameter.Value --output text)" \
     --query "items[?name=='shared-environment'].value | [0]" \
     --output text
   ```

   Without either, ask someone with access to `848665034107` to share the key.

   Set it for the process that launches Cursor, then fully quit and reopen Cursor
   so the agent can see it. An export in a terminal started after Cursor will
   not reach the agent.

   ```bash
   export MARKETPLACE_API_KEY='<the key>'
   ```

   If an old value keeps coming back, remove it where it was set (a shell
   profile such as `~/.zshrc`, or `launchctl unsetenv MARKETPLACE_API_KEY`)
   before setting the new one.

   Ask them to reply once it is set. Confirm only that the variable is present,
   with exactly this command, and never any other expansion of the variable:

   ```bash
   if [ -n "${MARKETPLACE_API_KEY:-}" ]; then echo "MARKETPLACE_API_KEY set (${#MARKETPLACE_API_KEY} chars)"; else echo "MARKETPLACE_API_KEY unset"; fi
   ```

   Then confirm the key is accepted with this read-only call before any other
   request; it prints only the HTTP status:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -H "x-api-key: $MARKETPLACE_API_KEY" "${MARKETPLACE_BASE_URL:-https://1ubssdfzw2.execute-api.us-east-2.amazonaws.com/dev/marketplace}/settings/status"
   ```

   `200` means the key works. `401` or `403` means the key is missing, stale, or
   for a different Marketplace: stop and give the get-and-set steps above.

   Pass the key to `curl` only as `-H "x-api-key: $MARKETPLACE_API_KEY"`, never
   with `-v`, `--trace`, `set -x`, or `env`/`printenv` in the same shell.
3. Publishing builds the bundle with the Build service, which runs in the
   Marketplace account `848665034107` on the same shared usage plan, so
   `MARKETPLACE_API_KEY` is also the Build key. Never ask for a Build key.
   Use this Build API URL (also `DEFAULT_BUILD_BASE_URL` in
   [`scripts/publish_via_build.py`](scripts/publish_via_build.py)):
   `https://5b45a3h1bd.execute-api.us-east-2.amazonaws.com/dev`.
   Honor `BUILD_BASE_URL` only when the user
   sets a different one, and confirm that URL with them before any publish.
   Check that Build accepts the key with this read-only call; it prints only
   the HTTP status:

   ```bash
   BUILD="${BUILD_BASE_URL:-<the Build API URL above>}"
   curl -s -o /dev/null -w '%{http_code}\n' -H "x-api-key: $MARKETPLACE_API_KEY" "${BUILD%/}/builds/bld_00000000000000000000000000"
   ```

   `404` means Build accepts the key. `403` (`ApiKeyDenied`) after
   `GET /settings/status` returned `200` means Build's stage is not on the
   shared usage plan yet: report a Build deployment gap for `tinkaton`, not a
   key problem, and do not ask the user for another key.
4. Prefer the scripts when they fit:
   - [`scripts/publish_via_build.py`](scripts/publish_via_build.py) — build
     through Build, scan, verify, upload, PUT bundle, poll review
     ([publish-readiness.md](reference/publish-readiness.md) section B)
   - Marketplace repo `./scripts/demo.sh` — register Prism / Platform / products
   - Marketplace repo `./scripts/publish-product.sh` — ensure component, PUT an
     existing `bundle_url`, poll review
5. For manual calls, send `x-api-key` and `content-type: application/json` on
   every request.

## Workflow — pick the lane

Classify the request, then run exactly one primary lane (plus inspect as needed).

| Lane | When | Start at |
| --- | --- | --- |
| Settings | First non-skip publish, or review readiness unknown | §1 |
| Register | New family / category / product / configuration / component | §2 |
| Readiness | User asks whether a product can publish, or a publish stopped on a product gap | §3a |
| Publish | Publish a product through Build, review poll, rollback | §3 |
| Inspect | Read-only ontology, bundles, reviews, settings status | §4 |

Hand off and stop when:

| Finding | Owner |
| --- | --- |
| Marketplace Lambda/CDK/OpenAPI defect | Stop; report evidence for a Marketplace repo change |
| Need customers, environments, or API key minting | Not this API |
| Need to install a bundle into an account | Deploy / Puller — not Marketplace |
| Build rejects the key, is unreachable, fails with a Build defect, or cannot set a review-safe stage | `tinkaton`, with the `build_id` and failure tag |
| Product source fails Build readiness or the scan | The product's owners; report the concrete change |
| Need Organizations / StackSets control-plane design | Out of scope for this skill |
| Need subscriptions / prices / site publication | Out of scope for this product; do not invent routes |

## 1. Review settings (once per stage before non-skip publish)

The sandbox review runs on a separate review Deploy in account `257779860257`
(`us-east-2`), not in the Marketplace account. Its API is
`https://bnxj2o10y7.execute-api.us-east-2.amazonaws.com/dev`, and it accepts
IAM-signed calls from the Marketplace account. Check status first; these
settings are usually already in place.

1. `GET /settings/status` — if `status.component_publication.is_operational`
   is `true`, skip to publishing.
2. Otherwise `PUT /settings` with
   `{ "review_api_key": "...", "review_environment_hosts": ["https://bnxj2o10y7.execute-api.us-east-2.amazonaws.com/dev"] }`.
   Marketplace probes each host with an IAM-signed call before saving; a
   `422 ReviewEnvironmentInvalid` means the review Deploy is unreachable or
   does not trust the Marketplace account. Marketplace only stores
   `review_api_key` and requires it to be non-empty; Deploy authorizes review
   calls with IAM, not with this key.
3. Require `is_operational: true` before publishing with `skip_review: false`.
4. Do not print `review_api_key`. SSM paths on the Marketplace side are
   `/marketplace/{stage}/review-api-key` and
   `/marketplace/{stage}/review-environment-hosts`.

The review account is new. If a review fails at the sandbox deploy with
CodeBuild `AccountLimitExceededException` ("Cannot have more than 0 builds in
queue"), report it as a blocker outside Marketplace: the account owner must ask
AWS Support to raise the CodeBuild limit in `257779860257`. Service Quotas can
show 60 while this hidden new-account limit still applies.

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

## 3a. Publish readiness

Run this when the user asks whether a product can publish, or a publish
stopped on a product gap. The Build service builds the bundle, so a product
needs no pack or publish scripts and no pull request to be published.

1. Ask for the product repository if it is not obvious; use its default branch
   (or the branch the user named) at the remote tip.
2. Walk [publish-readiness.md](reference/publish-readiness.md) section A:
   Build readiness (the local recipe of configure-build-product §1, no Build
   call), the registered component, the security scan and the review-stage rule.
3. Prove it end to end without a Marketplace write:
   `DRY_RUN=1 python3 skills/operate-marketplace/scripts/publish_via_build.py <checkout> [--branch <branch>]`.
   It runs one real Build build and stops before any Marketplace call.
4. Report each item as ready, missing or cannot verify, with evidence, and the
   concrete change for each missing item. Product source changes belong to the
   product's owners: never create branches, commits or pull requests in a
   product repository, and never patch a checkout to get a bundle.

## 3. Publish, review, rollback

Publish only from the product's merged default branch (or the branch the user
named): the script archives a commit that is on the remote branch and never
reads the working tree. Never publish from an unmerged or locally patched
checkout.

1. Run the publish-through-Build script from this kit (section B of
   [publish-readiness.md](reference/publish-readiness.md)):

   ```bash
   python3 skills/operate-marketplace/scripts/publish_via_build.py <product-checkout> [--branch <branch>]
   ```

   It checks `GET /settings/status`, resolves `product_id`
   (`MARKETPLACE_PRODUCT_ID` or `GET /ontology/products/by-name` with
   `MARKETPLACE_PRODUCT_NAME`, default the manifest's `component_name`),
   requires the component to be registered (§2 step 6) with the manifest's
   `bundle_type`, checks Build accepts the key, scans the source, builds it
   through Build, verifies the artifact and both tokens against Marketplace's
   checks, uploads through `POST .../components/{component_id}/bundle-uploads`,
   then performs steps 2–4. Add `DRY_RUN=1` to stop before any Marketplace call.
   Never mint `service-builder` or write `service-comply` by hand.
2. `PUT /ontology/products/{product_id}/components/{component_id}/bundles`
   `{ "bundle_url": "https://...", "skip_review": false }` → `202` with
   `review_id` and `bundle_status`.
3. Poll `GET /reviews/{review_id}` until `SUCCEEDED` or `FAILED` (default
   timeout 1200 s). On failure, return `review_details` without inventing fixes.
4. `GET .../components/{component_id}/bundles` — for `VALID` rows, use the
   Marketplace-hosted `bundle_url` (short-lived presign). Statuses:
   `UPLOADING_IN_PROGRESS` | `VALID` | `FAILED`.
5. Rollback: `POST .../components/{component_id}/rollback` when at least two
   VALID bundles exist → `202`. `400` otherwise.

The script stops, with the reason in its JSON report, on a scan at `MEDIUM` or
worse, a Build failure (`failure.tag`), a failed artifact or token check, more
than 2 KB of S3 metadata, or stack names with a live stage (section D of
publish-readiness.md). Report those; route Build defects and the stage gap to
`tinkaton`.

`skip_review: true` only before the first VALID bundle, and only with explicit
user acceptance of a draft. Invalid artifacts return `422 BuildArtifactInvalid`.

Env vars for `publish_via_build.py`: `MARKETPLACE_API_KEY` (Marketplace and
Build), optional `DRY_RUN`, `MARKETPLACE_BASE_URL`, `BUILD_BASE_URL`,
`MARKETPLACE_PRODUCT_ID`, `MARKETPLACE_PRODUCT_NAME`, `BUILD_TIMEOUT_SECONDS`,
`MARKETPLACE_REVIEW_TIMEOUT_SECONDS`.

Env vars for the Marketplace repo's `publish-product.sh` (an existing
`bundle_url` only): `MARKETPLACE_API_KEY`,
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

- Use `https://1ubssdfzw2.execute-api.us-east-2.amazonaws.com/dev/marketplace`.
  If the user names a different base URL, confirm it before any write.
- Never print secrets (`MARKETPLACE_API_KEY`, `review_api_key`).
- Do not claim Marketplace deployed a stack into a tenant — it only stores
  reviewed bundles.
- Record HTTP method, path, status, and error `tag` for every failed call.

## Return

Report: lane chosen; Prism Marketplace as the target; entities touched (names + ids); publish
source commit, `build_id`, scan severity, the checks passed, metadata bytes,
`review_id` and final `bundle_status` when relevant (never the presigned URLs);
Persist confirmation only if `demo.sh` or an equivalent check was run; and any
handoff outside Marketplace.

This install does not deliver catalog graph facts to Persist yet: the
Marketplace account has no Persist or `socap-engagement-events` bus. Do not
report catalog changes as persisted, and expect `demo.sh`'s Persist check to
fail until that is connected.
