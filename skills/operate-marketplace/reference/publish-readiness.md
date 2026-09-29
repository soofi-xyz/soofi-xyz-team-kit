---
title: Product publish-readiness checklist and changes
impact: HIGH
tags: marketplace, publish, cloud-assembly, readiness, product-repo
---

# Product publish readiness

Use this when a user wants to publish a product to Prism Marketplace and has no
`bundle_url` yet. First inspect the product repository and report the gaps
(section C). When the user asks, make the repository changes on a new branch and
open a pull request (section D). Never push to the default branch.

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
         `npx --no-install javascript-obfuscator ${out}/index.mjs --output ${out}/index.mjs --target node --compact true --source-map false --self-defending false --rename-globals false`,
       ],
     },
   }
   ```

   Keep `self-defending` and `rename-globals` off; they break Node handlers.
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
   - Map to one label: any critical or high audit finding, or any nag error →
     `HIGH`; any moderate finding → `MEDIUM`; only low findings or nag
     warnings → `LOW`; nothing → `NONE`. Stop before upload on `MEDIUM` or
     worse and report the findings.
7. **A publish step** (`just publish`) that packs, runs the scan, writes both
   metadata tokens from real results (section B), uploads to S3, and prints a
   presigned URL (section B2).
8. **Tests** covering the manifest, stack ids, zip layout, obfuscation check,
   severity mapping, and token payloads.

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

## B2. Host the bundle and get the presigned URL

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=<region>
BUCKET=<product-artifacts-bucket>
KEY=bundles/<component_id>/<component_id>-cloud-assembly.zip

TARGET_ENV=<stage> just pack

aws s3 cp artifacts/<component_id>-cloud-assembly.zip "s3://$BUCKET/$KEY" \
  --content-type application/zip \
  --metadata "service-builder=$BUILDER_TOKEN,service-comply=$COMPLY_TOKEN"

aws s3 presign "s3://$BUCKET/$KEY" --expires-in 7200
```

- Set metadata at upload time; S3 cannot add it to an existing object.
- Use an expiry that outlasts the review (Marketplace re-downloads after up to
  ~7.5 minutes of sandbox polling). SSO sessions cap the URL lifetime.
- The URL must be a plain Amazon S3 HTTPS object URL, not CloudFront.
- Treat the presigned URL as a secret while it is valid. Do not commit it.
- Pack with credentials for the install account when the app pins
  `env.account` at synth time.
- The sandbox review installs the bundle into the Marketplace account. Pack
  with a stage no live install uses there (for example `TARGET_ENV=review`),
  or the review updates live stacks. This matters most for Deploy, which runs
  as `deploy-dev-*` in that account.

Run upload or presign commands only when the user asks, after they confirm AWS
credentials are ready and name the bucket, account, and region.

## C. How to report

Return a table with one row per item in A and B: `ready`, `missing`, or
`cannot verify`, with the file path or evidence. List the concrete change for
each `missing` row, citing Deploy PR #3. End with whether the product can
publish now, and which blockers are outside the product repo (scan findings
at `MEDIUM` or worse, missing sandbox Deploy or review settings).

## D. Make the product publishable (only when the user asks)

1. Confirm the target repository and that the user wants a pull request.
2. Create a branch `feat/marketplace-publishable` from the default branch.
3. Implement every `missing` item from A: manifest, stage-neutral construct id
   (update tests that construct the stack), bundling flags, obfuscation hook
   and check, pack script adapted from Deploy's (map construct id to the stage
   `stackName`), security scan, publish target, and tests. Match the repo's
   package manager, test runner, and style.
4. Run the repo's own checks (format, lint, type-check, tests, `cdk synth`) and
   the pack step locally. Fix failures before opening the PR.
5. Open the pull request. In the description, list what changed, the check
   results, and any blocker outside the repo from section B.
6. Do not deploy, upload, or publish as part of this lane. Do not merge.
