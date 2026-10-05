---
title: Product publish readiness and the publish-through-Build flow
impact: HIGH
tags: marketplace, publish, build, cloud-assembly, readiness, security-scan
---

# Product publish readiness

The Build service builds every bundle Registeel publishes. A product needs no
pack or publish scripts and no pull request to be published: it is publishable
when Build accepts its source, the security scan passes and its stack names are
safe for the sandbox review. [`scripts/publish_via_build.py`](../scripts/publish_via_build.py)
runs the whole flow from a product checkout.

Marketplace's own checks live in `prismteam-ai/marketplace`
`lambda/services/bundle-review.ts` (`inspectBundle`, `assertComplyPassed`,
`assertCloudAssemblyZip`, `downloadBundle`). They win if this page drifts.
Build's contract is [the Build API summary](../../configure-build-product/reference/api-contract.md).

Build itself is published like any other product, through this script and the
Build service.

## A. Readiness checklist

Check the product repository at the tip of its default branch (or the branch
the user named). Report each row `ready`, `missing` or `cannot verify`.

1. **Build readiness.** Every item of
   [configure-build-product §1](../../configure-build-product/SKILL.md#1-product-readiness):
   layout and exactly one lockfile, the closed `marketplace.product.json`
   schema, a `marketplace/app.ts` that synthesizes without AWS credentials or
   context lookups, minified and `javascript-obfuscator` Lambda entry files
   without source maps, no Docker assets and no denied paths. Its local
   readiness recipe needs no Build call.
2. **Component.** `component_id` in the manifest is a registered Marketplace
   component of the same `type` as `bundle_type` (§2 of the skill registers it).
3. **Security scan passes** (section B, step 2): no critical, high or moderate
   production dependency advisory and no cdk-nag error. Each `NagSuppressions`
   entry in the product needs a written reason.
4. **Review-stage-safe stack names** (section D).

A `missing` row in 1, 3 or 4 is a product source change for the product's
owners. Report the concrete change and the failing evidence; do not create
branches, commits or pull requests in a product repository, and never patch a
checkout to get a bundle sooner.

## B. What `publish_via_build.py` does

```bash
DRY_RUN=1 python3 skills/operate-marketplace/scripts/publish_via_build.py <product-checkout> [--branch main]
python3 skills/operate-marketplace/scripts/publish_via_build.py <product-checkout> [--branch main]
```

1. **Source.** Resolves the tip of `origin/<branch>` (default: the remote
   default branch; `--ref` must be a commit on it) and `git archive`s that
   commit to `source.zip`. Its sha256 is the `source_hash` for both tokens.
   The checkout is only fetched and read.
2. **Scan the same zip.** Extracts it, installs with lifecycle scripts off
   (`pnpm install --frozen-lockfile --ignore-scripts` or
   `npm ci --ignore-scripts`), synthesizes `marketplace/app.ts` with `tsx` the
   way Build does (`CDK_OUTDIR`, `cdk.json`/`cdk.context.json` context, no AWS
   credentials, no API keys, an empty home), and reads:
   - the production dependency audit (`pnpm audit --prod --json` or
     `npm audit --omit=dev --json`);
   - the cdk-nag `AwsSolutionsChecks` report of every manifest stack. When the
     app applies no `AwsSolutionsChecks` aspect, the scan applies one (pinned
     `cdk-nag`, sharing the product's `aws-cdk-lib`); product suppressions
     still apply. A missing report fails the scan.

   Severity: any critical/high advisory or nag error → `HIGH`; any moderate
   advisory → `MEDIUM`; only low advisories or nag warnings → `LOW`; nothing →
   `NONE`. `MEDIUM` or worse stops before Build. The `service-comply` token is
   written only from these results, `issuer: registeel/publish-via-build`.
3. **Build.** `POST /sources` uploads the same zip with `service-comply`
   attached, so Build binds it as `service_comply_sha256` in its token;
   `POST /builds` with the manifest's `bundle_type` and `component_id`; polls
   `GET /builds/{id}`; downloads the artifact and `GET /builds/{id}/manifest`.
4. **Verify Build's output.** Download sha256 = `provenance.artifact_sha256` =
   token `artifact_hash`; manifest route = zip `build/build.manifest.json` =
   `provenance.build_manifest_sha256`; token `source_hash` = the zip's sha256;
   token header `{"alg":"none","typ":"JWT"}`, `iss: build`, `sub` = `build_id`;
   `service_comply_sha256` = sha256 of the comply token; `artifact_built: true`;
   asset policy `PASSED`; scan and Build produced the same CloudFormation stack
   names.
5. **Marketplace checks, offline** (section C), then the review-stage rule
   (section D). `--marketplace-repo <checkout>` also runs Marketplace's own
   `bundle-review.ts` from `origin/main` of that checkout against the artifact.
6. **Publish** (skipped by `DRY_RUN=1`, which makes no Marketplace call):
   `POST .../bundle-uploads`, uploads the zip with both tokens as
   `x-amz-meta-service-builder` and `x-amz-meta-service-comply`, `PUT .../bundles`
   `{bundle_url, skip_review: false}`, polls `GET /reviews/{review_id}` and reads
   the bundle row.

It prints progress on stderr and one JSON report on stdout (`build_id`, scan
findings, decoded tokens, metadata bytes, every check passed, `review_id`).
It never prints the key, upload forms, `bundle_url` or the artifact URL. The
work directory keeps `source.zip`, the artifact and `metadata.json`; delete it
after a dry run.

## C. Metadata Marketplace reads from the S3 object

- `x-amz-meta-service-builder`: Build's own token from
  `provenance.service_builder`, unchanged. Never mint or edit one.
  Marketplace requires `artifact_kind: "CDK_CLOUD_ASSEMBLY"`,
  `deployer_contract_version: "1"`, `component_id` equal to the component,
  `sha256:` `source_hash`/`assembly_hash`/`artifact_hash` (artifact hash =
  zip bytes), `cloud_assembly` and `deployment_parameters` objects and
  `lambda_asset_policy` `{minified: true, obfuscated: true, source_maps: false}`.
- `x-amz-meta-service-comply`: the scan's token; `severity_label` below
  `MEDIUM` and `source_hash` equal to `service-builder`'s.
- The zip: under 256 MiB, not ZIP64, with `marketplace.product.json`,
  `build/build.manifest.json`, `cdk.out/manifest.json` and templates that each
  have `Resources`. Build's artifact layout satisfies this.
- S3 caps keys plus values at 2 KB. Build caps its token at 1200 bytes; with
  both keys (29 bytes) the comply token may use 819. A Deploy dry run used
  1194 + 470 = 1664 bytes including keys.

Example `service-comply` payload:

```json
{
  "issuer": "registeel/publish-via-build",
  "scanners": ["pnpm-audit@10.14.0", "cdk-nag@2.38.2"],
  "severity_label": "LOW",
  "findings": { "critical": 0, "high": 0, "moderate": 0, "low": 0, "nag_errors": 0, "nag_warnings": 1 },
  "source_hash": "sha256:<sha256 of source.zip, equal to service-builder source_hash>",
  "scanned_at": "2026-10-02T15:29:39Z"
}
```

## D. Review-stage rule

The sandbox review installs the bundle into the review account `257779860257`,
where the review Deploy itself runs as `deploy-dev-*`. Build synthesizes every
product with CDK context `stage=review` (`packedStage` in the build manifest,
`cloud_assembly.packed_stage` in `service-builder`), so a product that reads
`stage` gets `-review` stack names; the scan synth sets the same context. The
script still refuses any CloudFormation stack name with a `dev` or `prod` stage
segment before a Marketplace write (before Build when publishing; a dry run
reports it after the build): that means the product hardcodes a live stage.

Report a refusal to the product's owners: the Marketplace entrypoint must take
its stage from CDK context. Do not work around it with a product patch, a
hand-packed zip or `skip_review`.

## E. How to report

One row per section A item, then: the `build_id`, scan severity and findings,
which Build and Marketplace checks passed, metadata bytes, and whether the
product can publish now. Name blockers outside the product (Build not reachable
with `MARKETPLACE_API_KEY`, review settings not operational, review-stage
names) with their owner.
