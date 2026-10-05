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
   Use this Build API URL (also `DEFAULT_BUILD_BASE_URL` in the publish
   script, step 4):
   `https://5b45a3h1bd.execute-api.us-east-2.amazonaws.com/dev`.
   Honor `MARKETPLACE_BUILD_BASE_URL` only when the user
   sets a different one, and confirm that URL with them before any publish.
   Check that Build accepts the key with this read-only call; it prints only
   the HTTP status:

   ```bash
   BUILD="${MARKETPLACE_BUILD_BASE_URL:-<the Build API URL above>}"
   curl -s -o /dev/null -w '%{http_code}\n' -H "x-api-key: $MARKETPLACE_API_KEY" "${BUILD%/}/builds/bld_00000000000000000000000000"
   ```

   `404` means Build accepts the key. `403` (`ApiKeyDenied`) after
   `GET /settings/status` returned `200` means Build's stage is not on the
   shared usage plan yet: report a Build deployment gap for `tinkaton`, not a
   key problem, and do not ask the user for another key.
4. Prefer the scripts when they fit:
   - `scripts/publish_via_build.py` in the private repository
     [`prismteam-ai/ci-action`](https://github.com/prismteam-ai/ci-action) — the
     same script product CI runs: Code (zip and security scan), Build, Publish
     ([publish-readiness.md](reference/publish-readiness.md) section B). Get or
     refresh it before every publish:

     ```bash
     CI_ACTION="$HOME/.cache/prism/ci-action"
     if [ -d "$CI_ACTION/.git" ]; then git -C "$CI_ACTION" pull -q --ff-only; else gh repo clone prismteam-ai/ci-action "$CI_ACTION" -- -q; fi
     ```

     Below, `publish_via_build.py` means `"$CI_ACTION/scripts/publish_via_build.py"`.
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
| Publish | Publish a product through Build (or check its CI publish run), review poll, rollback | §3 |
| Inspect | Read-only ontology, bundles, reviews, settings status | §4 |
| CI publishing | A publish found no CI workflow in the product repo, or the user asks to publish on every merge | §5 |

Hand off and stop when:

| Finding | Owner |
| --- | --- |
| Marketplace Lambda/CDK/OpenAPI defect | Stop; report evidence for a Marketplace repo change |
| Need customers, environments, or API key minting | Not this API |
| Need to install a bundle into an account | Deploy / Puller — not Marketplace |
| Build rejects the key, is unreachable, or fails with a Build defect | `tinkaton`, with the `build_id` and failure tag |
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
   `DRY_RUN=1 python3 "$CI_ACTION/scripts/publish_via_build.py" all <checkout> [--branch <branch>]`.
   It runs the Code and Build steps (one real build) and makes no Marketplace call.
4. Report each item as ready, missing or cannot verify, with evidence, and the
   concrete change for each missing item. Product source changes belong to the
   product's owners: never create branches, commits or pull requests in a
   product repository, and never patch a checkout to get a bundle.

## 3. Publish, review, rollback

Publish only from the product's merged default branch (or the branch the user
named): the script archives a commit that is on the remote branch and never
reads the working tree. Never publish from an unmerged or locally patched
checkout.

0. Before publishing, check the product repository's default branch for a
   workflow that uses `prismteam-ai/ci-action`:

   ```bash
   gh api "repos/<owner>/<repo>/contents/.github/workflows?ref=<default-branch>" --jq '.[].name' \
     | while read -r f; do gh api "repos/<owner>/<repo>/contents/.github/workflows/$f?ref=<default-branch>" --jq .content | base64 -d | grep -q 'prismteam-ai/ci-action' && echo "$f"; done
   ```

   No match: run the script with `DRY_RUN=1` (step 1), then go to §5, open
   the CI pull request and stop with the two choices (merge it to publish
   automatically, or "publish now" for a one-time publish with step 1).

   A match (`<workflow>`): CI publishes every merge, so check its run for the
   default branch's tip instead of publishing again:

   ```bash
   TIP=$(gh api "repos/<owner>/<repo>/commits/<default-branch>" --jq .sha)
   gh run list -R <owner>/<repo> --workflow <workflow> --branch <default-branch> -L 10 \
     --json databaseId,headSha,status,conclusion,url --jq ".[] | select(.headSha == \"$TIP\")"
   gh run view <run-id> -R <owner>/<repo> --json jobs --jq '.jobs[].steps[] | [.name, .status, .conclusion] | @tsv'
   gh run view <run-id> -R <owner>/<repo> --log | grep -E '"(error|build_id|review_id|review_status|bundle_id)"'
   ```

   - Running: report the current step (Code, Build or Publish) and the run
     URL. Offer to check again; do not publish.
   - Succeeded: confirm the `review_id` and `bundle_id` from the log in
     `GET .../components/{component_id}/bundles` (§3 step 4) and report them.
   - Failed: report the failed step and the log's `error`; route it like a
     script stop (below). Re-run only if the user asks:
     `gh run rerun <run-id> -R <owner>/<repo>`.
   - No run for the tip: say so and offer to start one
     (`gh workflow run <workflow> -R <owner>/<repo>`) or a one-time publish
     with step 1.

   Publish with step 1 only when the user asks for it explicitly.
1. Run the publish script (Prerequisites step 4; section B of
   [publish-readiness.md](reference/publish-readiness.md)):

   ```bash
   python3 "$CI_ACTION/scripts/publish_via_build.py" all <product-checkout> [--branch <branch>]
   ```

   Code: zips the commit and scans it. Build: checks `GET /settings/status`,
   resolves `product_id` (`MARKETPLACE_PRODUCT_ID` or
   `GET /ontology/products/by-name` with `MARKETPLACE_PRODUCT_NAME`, default
   the manifest's `component_name`), requires the component to be registered
   (§2 step 6) with the manifest's `bundle_type`, checks Build accepts the key
   and builds through Build. Publish: uploads through
   `POST .../components/{component_id}/bundle-uploads`, then performs steps
   2–4. Add `DRY_RUN=1` to stop after Build. Build and Marketplace check the
   bundle themselves. Never mint `service-builder` or write `service-comply`
   by hand.
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

The script stops, with the failed step and reason in its JSON report's
`error`, on a scan at `MEDIUM` or worse, stack names with a live stage
(section D of publish-readiness.md), a Build failure (`failure.tag`) or a
failed review (`review_details`). Report those; route Build defects to
`tinkaton` and live-stage stack names to the product's owners.

`skip_review: true` only before the first VALID bundle, and only with explicit
user acceptance of a draft. Invalid artifacts return `422 BuildArtifactInvalid`.

Env vars for `publish_via_build.py`: `MARKETPLACE_API_KEY` (Marketplace and
Build), optional `DRY_RUN`, `MARKETPLACE_BASE_URL`, `MARKETPLACE_BUILD_BASE_URL`,
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

## 5. CI publishing (publish on every merge)

When a publish request finds no CI workflow in the product repository (§3
step 0), or the user asks for it. The product repository gets one GitHub Actions
file that publishes each push to its default branch (a merged pull request)
with the same flow as §3, through the shared action
[`prismteam-ai/ci-action`](https://github.com/prismteam-ai/ci-action). Its run
shows the three steps (Code, Build, Publish) separately. The action repository
is private and shared with every `prismteam-ai` repository; a product outside
that organization cannot use it. The repository needs one secret,
`MARKETPLACE_API_KEY`; the Marketplace and Build URLs are built in.

1. The product's component must already be registered (§2) and its review
   settings operational (§1).
2. Run `DRY_RUN=1 python3 "$CI_ACTION/scripts/publish_via_build.py" all <product-repo>`
   (§3). Stop on any readiness gap or blocking scan; report it to the owners.
3. On a new branch from the default branch, add exactly
   [`templates/marketplace.yml`](templates/marketplace.yml) as
   `.github/workflows/marketplace.yml`. If the default branch is not `main`,
   change only `branches: [main]`. Commit only that file and open one pull
   request. Never push to the default branch, merge, or touch other files.
4. Tell the user the two choices and wait: merge the pull request (after
   adding the secret below) and the product publishes itself now and on every
   later merge, or reply "publish now" and you publish this commit once with
   §3 step 1. Never publish before they choose. Secret steps:

   ```bash
   gh secret set MARKETPLACE_API_KEY -R <owner>/<repo> --body "$MARKETPLACE_API_KEY"
   ```

   or GitHub → repository Settings → Secrets and variables → Actions → New
   repository secret `MARKETPLACE_API_KEY`. They run it in their own terminal;
   never run it for them, never print or paste the value.
5. After they merge, the "Publish to Marketplace" run shows the commit, scan
   severity, `build_id`, stacks, `review_id` and bundle id in its job summary,
   and the step that stopped when one fails. `workflow_dispatch` re-runs the
   latest default-branch commit. Later publish requests check this run
   (§3 step 0) instead of publishing again.

## Safety

- Use `https://1ubssdfzw2.execute-api.us-east-2.amazonaws.com/dev/marketplace`.
  If the user names a different base URL, confirm it before any write.
- Never print secrets (`MARKETPLACE_API_KEY`, `review_api_key`).
- Do not claim Marketplace deployed a stack into a tenant — it only stores
  reviewed bundles.
- Record HTTP method, path, status, and error `tag` for every failed call.

## Return

Report: lane chosen; Prism Marketplace as the target; entities touched (names + ids); publish
source commit, `build_id`, scan severity, `review_id` and final `bundle_status` when relevant (never the presigned URLs);
Persist confirmation only if `demo.sh` or an equivalent check was run; and any
handoff outside Marketplace.

This install does not deliver catalog graph facts to Persist yet: the
Marketplace account has no Persist or `socap-engagement-events` bus. Do not
report catalog changes as persisted, and expect `demo.sh`'s Persist check to
fail until that is connected.
