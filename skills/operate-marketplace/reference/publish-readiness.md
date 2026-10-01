---
title: Product publish-readiness checklist and changes
impact: HIGH
tags: marketplace, publish, cloud-assembly, readiness, product-repo
---

# Product publish readiness

Use this when a user wants to publish a product to Prism Marketplace and has no
`bundle_url` yet. Inspect the product repository and find the gaps (section C).
If the user asked to publish, make the repository changes on a new branch and
open a pull request (section D) in the same run; if they only asked what is
missing, report. Never push to the default branch.

Reference implementation: [Spring-Oaks-Capital-LLC/deploy#3](https://github.com/Spring-Oaks-Capital-LLC/deploy/pull/3)
("Make Deploy Marketplace-publishable"). Reuse its manifest shape and
`scripts/pack-cloud-assembly.ts` instead of inventing a new layout.

Marketplace's own checks live in `prismteam-ai/marketplace`
`lambda/services/bundle-review.ts` (`inspectBundle`, `assertComplyPassed`,
`assertCloudAssemblyZip`). They win if this list drifts. Re-read them before
changing a product.

## A. Repository requirements

Check each item in the product repo at its default branch.

1. **`marketplace.product.json` at the repo root.** Declarative only.

   ```json
   {
     "component_id": "deploy",
     "component_name": "Deploy",
     "bundle_type": "SERVICE",
     "context_schema_version": "1",
     "stacks": ["deploy-data", "deploy-workflow", "deploy-api"],
     "base_path": "deploy",
     "requires": { "domain": false, "shared_usage_plan": false, "identity": false }
   }
   ```

   - `component_id` must equal the Marketplace component id it will publish to.
   - `bundle_type` is `SERVICE` or `DATA`.
   - `stacks[]` must equal the CDK construct ids in the app entrypoint.
   - Must NOT contain `entrypoint` in the packed copy, or any command or
     lifecycle field (`synth_command`, `deploy_command`, `post_deploy_command`,
     `build_command`, `scripts`, `docker_build`, `serverless`, `terraform`,
     `sam`, `pulumi`, `engine`).

   Incorrect — a command field Marketplace and Deploy reject:

   ```json
   { "component_id": "connect", "bundle_type": "SERVICE", "stacks": ["connect-api"], "deploy_command": "cdk deploy" }
   ```

2. **TypeScript CDK app with stage-neutral construct ids.** The construct id
   stays fixed (`deploy-api`, `Connect`); only `stackName` carries the stage
   (`deploy-${stage}-api`, `Connect-${stage}`), so existing installs update in
   place. `cdk synth --strict` must succeed. No Serverless Framework, SAM, or
   Terraform deploy path.

   Incorrect — the construct id changes per stage, so `stacks[]` cannot match:

   ```ts
   new ConnectStack(app, `Connect-${stage}`, { stage });
   ```

   Correct:

   ```ts
   new ConnectStack(app, "Connect", { stage, stackName: `Connect-${stage}` });
   ```

   If renaming the construct id in the deploy entrypoint would replace live
   resources, keep the deploy entrypoint unchanged and add a separate
   `marketplace/app.ts` with the stage-neutral id. Point `cdk.json` or the pack
   step at it, and have deploy commands name their entrypoint explicitly.
2a. **Marketplace entrypoint pins no account or region.** Leave `env` unset
   (or set neither `account` nor `region`) in the entrypoint the pack step
   synthesizes, and use no context lookups there, so the assembly installs
   into whichever account and region Deploy targets and packing needs no AWS
   credentials. Keep the live deploy entrypoint unchanged.

   Incorrect — the bundle only installs where it was packed:

   ```ts
   new DeployStack(app, "deploy-api", { env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-2" } });
   ```

3. **Lambda bundles minified with no source maps.** Set these in the product's
   single Lambda bundling helper, not per function:

   ```ts
   bundling: { minify: true, sourceMap: false, sourcesContent: false /* ...existing */ }
   ```

   No `.map` or `.ts` files may appear in staged assets. The Build service's
   `@internal/marketplace-cdk` import rule does not apply when Build is not in
   the pipeline; do not add that package or a stub import.
3a. **Lambda bundles obfuscated.** Marketplace requires
   `lambda_asset_policy.obfuscated: true`. Add `javascript-obfuscator` as a dev
   dependency and run it from an `afterBundling` hook in the same bundling
   helper, on the esbuild entry file (`index.mjs` for ESM, `index.js` for CJS):

   ```ts
   bundling: {
     minify: true, sourceMap: false, sourcesContent: false,
     commandHooks: {
       beforeBundling: () => [],
       beforeInstall: () => [],
       afterBundling: (_in: string, out: string) => [
         `npx --no-install javascript-obfuscator ${out}/index.mjs --output ${out}/index.mjs --seed 20260929 --target node --compact true --source-map false --self-defending false --rename-globals false`,
       ],
     },
   }
   ```

   Always pass a fixed non-zero `--seed`. The default seed is time-based, so
   every synth changes every Lambda asset hash: each deploy updates every
   function and two packs of one commit get different hashes. Verify by
   synthesizing twice and comparing the `cdk.out/asset.*` names.
   Keep `self-defending` and `rename-globals` off; they break Node handlers.
   The hook only reaches the product's own functions. CDK-provided handlers
   (for example the `autoDeleteObjects` custom resource) stay unobfuscated and
   fail the pack check, so disable them in the Marketplace entrypoint and set
   the affected bucket to `RemovalPolicy.RETAIN`: CloudFormation cannot delete
   a non-empty bucket, and `DESTROY` without auto-delete makes uninstalling
   fail. Keep the live entrypoint's behavior unchanged.
   The pack step must verify every staged Lambda entry file shows obfuscator
   output (for example hexadecimal `_0x` identifiers) and fail otherwise, so
   `obfuscated: true` is checked, not claimed. Run the full unit and
   integration suites against the obfuscated bundles; deployed Lambdas change
   too when deploy and pack share the helper.

   Incorrect — the flag is set without an obfuscation step:

   ```ts
   lambda_asset_policy: { minified: true, obfuscated: true, source_maps: false }
   ```
4. **No Docker image assets.** File assets only in `cdk.out/*.assets.json`.
5. **A pack step** (`just pack`, backed by `scripts/pack-cloud-assembly.ts`)
   that zips only:

   ```text
   marketplace.product.json
   build/build.manifest.json
   cdk.out/manifest.json
   cdk.out/<Stack>.template.json   # each with a Resources object
   cdk.out/*.assets.json and asset.* dirs
   ```

   and never `lib/`, `src/`, `lambda/`, `test/`, `node_modules/`,
   `marketplace/app.ts`, `.git/`, or env files. Under 256 MiB, non-ZIP64.
   The pack step writes `build/build.manifest.json` itself:

   ```json
   {
     "artifactKind": "CDK_CLOUD_ASSEMBLY",
     "deployerContractVersion": "1",
     "componentId": "connect",
     "componentName": "Connect",
     "bundleType": "SERVICE",
     "stacks": ["Connect"],
     "packedStage": "dev",
     "cloudFormationStackNames": ["Connect-dev"]
   }
   ```
6. **A security scan** that produces the `service-comply` verdict:
   - Dependencies: the repo's package manager audit on production
     dependencies (`npm audit --omit=dev --json` or `pnpm audit --prod --json`).
   - Infrastructure: `cdk-nag` `AwsSolutionsChecks` applied as an aspect in
     the Marketplace entrypoint only, so every pack synth is checked. Each
     `NagSuppressions` entry needs a written reason; list them in the PR.
     Require a nag report for every stack in `marketplace.product.json`
     (map each construct id to its `stackName` in `cdk.out/manifest.json`;
     reports are named `AwsSolutions-<stackName>-NagReport.json`). Fail when
     any is missing, so a partial assembly cannot understate the severity.
   - Map to one label: any critical or high audit finding, or any nag error →
     `HIGH`; any moderate finding → `MEDIUM`; only low findings or nag
     warnings → `LOW`; nothing → `NONE`. Stop before upload on `MEDIUM` or
     worse and report the findings.
7. **A publish step** (`just publish`) that packs, runs the scan, writes both
   metadata tokens from real results (section B), uploads through Prism
   Marketplace's upload endpoint with `MARKETPLACE_API_KEY` (section B2), and
   hands the returned `bundle_url` to `PUT .../bundles` without logging it.
   It takes the product id from
   `MARKETPLACE_PRODUCT_ID` (or resolves it with
   `GET /ontology/products/by-name`) and needs no AWS credentials or bucket.
   It supports a dry-run mode that stops before the upload and prints the zip
   path, size, and decoded token payloads.
   The script deletes `cdk.out` and runs the Marketplace synth itself; never
   scan or pack an existing `cdk.out`, or an older assembly gets attributed to
   the current commit.
8. **Tests** covering the manifest, stack ids, zip layout, obfuscation check
   and fixed seed, severity mapping, nag report coverage, bucket removal
   policy, and token payloads.

## B. Metadata Marketplace reads from the S3 object

- `bundle_url` is an Amazon S3 HTTPS object URL, reachable without redirects,
  with `Content-Length`.
- `x-amz-meta-service-builder` decodes to an object with
  `artifact_kind: "CDK_CLOUD_ASSEMBLY"`, `deployer_contract_version: "1"`,
  `component_id` matching the Marketplace component, `sha256:` values for
  `source_hash` / `assembly_hash` / `artifact_hash` (artifact hash must match
  the zip bytes), a `cloud_assembly` object, a `deployment_parameters` object,
  and a `lambda_asset_policy` object.
- `x-amz-meta-service-comply` decodes to an object with a `severity_label`
  below `MEDIUM`.

Encoding: an unsigned token `<base64url header>.<base64url JSON payload>.`;
Marketplace reads the middle segment. S3 limits all user metadata on an object
to 2 KB, so keep both payloads compact (no per-asset hash maps).

Example `service-builder` payload written by the product's publish step:

```json
{
  "issuer": "connect/just-publish",
  "artifact_kind": "CDK_CLOUD_ASSEMBLY",
  "deployer_contract_version": "1",
  "component_id": "connect",
  "source_hash": "sha256:<hash of the source commit tree>",
  "assembly_hash": "sha256:<hash of cdk.out contents>",
  "artifact_hash": "sha256:<hash of the zip bytes>",
  "cloud_assembly": { "stacks": ["Connect"], "packed_stage": "dev" },
  "deployment_parameters": {},
  "lambda_asset_policy": { "minified": true, "obfuscated": true, "source_maps": false }
}
```

Write `obfuscated: true` only after the pack step's obfuscation check (A3a)
passed for every Lambda asset; otherwise write `false` and stop.

Example `service-comply` payload from the scan (A6):

```json
{
  "issuer": "connect/just-publish",
  "scanners": ["npm-audit@10.9.2", "cdk-nag@2.35.0"],
  "severity_label": "LOW",
  "findings": { "critical": 0, "high": 0, "moderate": 0, "low": 2, "nag_errors": 0, "nag_warnings": 3 },
  "source_hash": "sha256:<same as service-builder>",
  "scanned_at": "2026-09-29T18:00:00Z"
}
```

```ts
const b64url = (s: string) => Buffer.from(s).toString("base64url");
const token = `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(payload))}.`;
```

Build-only checks do not apply to this path: do not switch the package
manager to pnpm, add `@internal/marketplace-cdk`, or file Build issues.

Who writes it:

- **`service-builder`**: when Build is not in the pipeline, the product's own
  publish step writes it. Set `issuer` to the product pipeline (for example
  `connect/just-publish`), never to the Build service. Compute every hash from
  real bytes.
- **`lambda_asset_policy`**: write the true values. `obfuscated: true` only
  when A3a ran and its check passed.
- **`service-comply`**: only from the scan in A6, written by the publish step
  from the scanner output. Never write a verdict by hand or copy one from
  another bundle.

## B2. Upload the bundle through Prism Marketplace

Prism Marketplace hands out the upload. Uploading needs only
`MARKETPLACE_API_KEY`: no AWS credentials, no bucket, and no `aws s3`
commands. Never ask the user for a bucket or an AWS profile for this step.

1. `POST /ontology/products/{product_id}/components/{component_id}/bundle-uploads`
   (no body) returns `{ upload: { url, fields }, bundle_url, expires_at }`.
   The upload accepts one `application/zip` file of at most 256 MiB for 15
   minutes (`expires_at`), and S3 rejects it unless both metadata fields are
   present.
2. POST the zip to `upload.url` as a form: every entry of `upload.fields`,
   plus `x-amz-meta-service-builder` and `x-amz-meta-service-comply` with the
   two tokens, and the file last. A `204` means it is stored.
3. Pass `bundle_url` unchanged to `PUT .../bundles`. It is a presigned GET for
   the uploaded object, valid for 1 hour, which covers the review.

```bash
BASE="${MARKETPLACE_BASE_URL:-https://1ubssdfzw2.execute-api.us-east-2.amazonaws.com/dev/marketplace}"
TARGET_ENV=review just pack

curl -sf -X POST -H "x-api-key: $MARKETPLACE_API_KEY" \
  "$BASE/ontology/products/$PRODUCT_ID/components/<component_id>/bundle-uploads" > upload.json

# --form-string sends values literally; plain -F treats a leading @ or < specially.
args=()
while IFS= read -r field; do args+=(--form-string "$field"); done \
  < <(jq -r '.upload.fields | to_entries[] | "\(.key)=\(.value)"' upload.json)
curl -sf -o /dev/null -w '%{http_code}\n' "$(jq -r .upload.url upload.json)" "${args[@]}" \
  --form-string "x-amz-meta-service-builder=$BUILDER_TOKEN" \
  --form-string "x-amz-meta-service-comply=$COMPLY_TOKEN" \
  -F "file=@artifacts/<component_id>-cloud-assembly.zip;type=application/zip"

BUNDLE_URL=$(jq -r .bundle_url upload.json); rm -f upload.json
```

- Run these from a clean checkout of the merged default branch; `source_hash`
  must name a commit that exists on the remote.
- The upload form and `bundle_url` are secrets while valid. Never print, log,
  or commit them, and delete `upload.json` after use.
- Request a new upload for every attempt; each one is single-use and expires.
- The sandbox review installs the bundle into the review account
  `257779860257`. Pack with a stage no live install uses there (for example
  `TARGET_ENV=review`), or the review updates live stacks. This matters most
  for Deploy, whose review install runs as `deploy-dev-*` in that account.
- A Marketplace entrypoint that pins `env.account` at synth still needs
  install-account credentials to pack (see A2a); that is the only remaining
  AWS requirement, and only for such products.

## C. How to report

Return a table with one row per item in A and B: `ready`, `missing`, or
`cannot verify`, with the file path or evidence. List the concrete change for
each `missing` row, citing Deploy PR #3. End with whether the product can
publish now, and which blockers are outside the product repo (scan findings
at `MEDIUM` or worse, missing sandbox Deploy or review settings).

## D. Make the product publishable

Run this whenever the user asked to publish and section C found `missing`
items. A publish request is the request for this pull request; do not ask
again.

1. Use the repository and branch the user named (else its default branch).
2. Create a branch `feat/marketplace-publishable` from the default branch.
3. Implement every `missing` item from A: manifest, stage-neutral construct id
   (update tests that construct the stack), bundling flags, obfuscation hook
   and check, pack script adapted from Deploy's (map construct id to the stage
   `stackName`), security scan, publish target, and tests. Match the repo's
   package manager, test runner, and style.
4. Run the repo's own checks (format, lint, type-check, tests, `cdk synth`).
5. Verify the bundle is good to go, locally and without uploading. Run the
   publish step in dry-run mode (pack, obfuscation check, scan, token
   generation; no S3 upload) under the review stage, then check the result
   against Marketplace's own rules in `lambda/services/bundle-review.ts`:
   - zip under 256 MiB, not ZIP64, contains `marketplace.product.json`,
     `build/build.manifest.json`, `cdk.out/manifest.json`, and every template
     has `Resources`;
   - manifest `component_id` equals the Marketplace component and `stacks[]`
     match the assembly;
   - both tokens decode; `service-builder` has every required field, its
     `artifact_hash` equals the zip's sha256, and `lambda_asset_policy` is
     `{ minified: true, obfuscated: true, source_maps: false }` backed by a
     passing obfuscation check;
   - `service-comply` `severity_label` is below `MEDIUM`;
   - both tokens together fit in 2 KB of S3 metadata;
   - two consecutive Marketplace synths produce identical `asset.*` hashes.
   Fix every failure before opening the PR. The zip is a test output only:
   delete it; never upload or publish it.
6. Open the pull request. In the description, list what changed, the check
   results, the verified bundle facts (size, stacks, scan severity,
   obfuscation check), and any blocker outside the repo.
7. Do not deploy, upload, or publish as part of this lane. Do not merge. End
   the run with:

   ```text
   <Product> pull request is ready: <PR URL>
   The bundle built from it passed Marketplace's checks locally (<size>, scan <severity>, obfuscation verified).
   Merge the pull request, then ask Registeel to publish <Product> from main.
   ```

Incorrect — patching a temporary checkout to get a bundle before review:

```bash
git clone …/deploy /tmp/deploy && cd /tmp/deploy   # edit files locally
TARGET_ENV=review just pack && just publish          # bundle from unmerged code
```

Correct — the pull request carries the change; the bundle comes from `main`
after merge:

```bash
gh pr create --base main --head feat/marketplace-publishable …   # this lane ends here
# later, after merge:
git clone --branch main …/deploy && cd deploy && TARGET_ENV=review just publish
```
