---
title: Product publish-readiness checklist
impact: HIGH
tags: marketplace, publish, build, cloud-assembly, readiness
---

# Product publish-readiness checklist

Use this when a user wants to publish a product to Prism Marketplace and has no
Build-produced `bundle_url` yet. Inspect the product repository read-only and
report which items are missing. Do not edit the product repository from this
skill; return the gap list so the product owner can make the change.

Reference implementation: [Spring-Oaks-Capital-LLC/deploy#3](https://github.com/Spring-Oaks-Capital-LLC/deploy/pull/3)
("Make Deploy Marketplace-publishable"). Point users at it as the worked example.

Marketplace's own checks live in `prismteam-ai/marketplace`
`lambda/services/bundle-review.ts` (`inspectBundle`, `assertComplyPassed`,
`assertCloudAssemblyZip`). They win if this list drifts.

## A. Repository changes (product owner adds these)

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

   Incorrect — a command field Build and Marketplace reject:

   ```json
   { "component_id": "connect", "bundle_type": "SERVICE", "stacks": ["connect-api"], "deploy_command": "cdk deploy" }
   ```

2. **TypeScript CDK app that synthesizes the declared stacks.** Stage-neutral
   construct ids (`deploy-api`), stage-specific `stackName`
   (`deploy-${stage}-api`). `cdk synth --strict` must succeed. No Serverless
   Framework, SAM, or Terraform deploy path.
3. **Lambda assets minified and obfuscated, no source maps.** Use the approved
   platform construct, not raw `aws_lambda.Function` with `Code.fromAsset` for
   Node.js handlers. Marketplace rejects metadata where `minified`, `obfuscated`
   are not `true` or `source_maps` is not `false`.
4. **No Docker image assets.** File assets only in `cdk.out/*.assets.json`.
5. **A pack step that produces the cloud-assembly zip** (Deploy uses
   `scripts/pack-cloud-assembly.ts` behind `just pack`). The zip contains only:

   ```text
   marketplace.product.json
   build/build.manifest.json
   cdk.out/manifest.json
   cdk.out/<Stack>.template.json   # each with a Resources object
   cdk.out/*.assets.json and asset.* dirs
   ```

   and never `lib/`, `src/`, `lambda/`, `test/`, `node_modules/`,
   `marketplace/app.ts`, `.git/`, or env files. Keep it under 256 MiB and
   non-ZIP64.
6. **Tests** covering the manifest and zip layout, as Deploy PR #3 does.

## B. Pipeline requirements (outside the repo)

A correct zip is necessary but not sufficient. Marketplace also reads S3 object
metadata that only Build and Comply issue. Never tell the user to hand-write it.

- `bundle_url` is an Amazon S3 HTTPS object URL, reachable without redirects,
  with `Content-Length`.
- `x-amz-meta-service-builder` (issued by Build) decodes to an object with
  `artifact_kind: "CDK_CLOUD_ASSEMBLY"`, `deployer_contract_version: "1"`,
  `component_id` matching the Marketplace component, `sha256:` values for
  `source_hash` / `assembly_hash` / `artifact_hash` (artifact hash must match
  the bytes), `cloud_assembly`, `deployment_parameters`, and
  `lambda_asset_policy`.
- `x-amz-meta-service-comply` (issued by Comply) has a `severity_label` below
  `MEDIUM`.

If Build or Comply is not deployed in the target account, say so: the repo can
be made ready, but publishing waits on those services.

## C. How to report

Return a table with one row per item in A and B: `ready`, `missing`, or
`cannot verify`, with the file path or evidence. Then list the concrete next
change for each `missing` row, citing Deploy PR #3 for the pattern. End with
whether the product can publish now, and what blocks it if not.
