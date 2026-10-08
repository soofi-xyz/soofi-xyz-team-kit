---
title: Build API contract summary
impact: HIGH
tags: build, http, openapi, provenance
---

# Build API contract summary

Authoritative source: [`prismteam-ai/build`](https://github.com/prismteam-ai/build)
→ `requirements/swagger.yml`, `README.md`, `lib/build-api-stack.ts` and
`src/domain/errors.ts`. When they differ from this page, the repository wins.

Base URL: the `BuildApiUrl` output of stack `BuildApi-<stage>`
(`https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/`; drop the
trailing slash when concatenating). There is no `/infra-builder` custom domain
yet. Auth: API Gateway usage-plan `x-api-key` on every route except
`GET /information`. Every build and upload is bound to the API key id that
created it; another key's build is `404 BuildNotFound` and another key's
upload is `404 SourceNotFound`, identical to an unknown id.

## Routes

| Method | Path | Success | Notes |
| --- | --- | --- | --- |
| `POST` | `/sources` | `201` | Body empty or `{}`. Returns `{source_id, upload{url, fields}, expires_at}`. The form is a bearer secret for 15 minutes. |
| `POST` | `/builds` | `202` | Start a build; `bundle_type` optional (inferred from `marketplace.product.json`) |
| `POST` | `/service`, `/data` | `202` | Same, with `bundle_type` `SERVICE` / `DATA`; a conflicting request value is `400 InvalidBuildOption`, a conflicting manifest is `BundleTypeMismatch` at `VALIDATING` |
| `GET` | `/builds/{build_id}`, `/service/{build_id}`, `/data/{build_id}` | `200` | Status for the creating key |
| `GET` | `/builds/{build_id}/logs?limit=1..500&next_token=` | `200` | `{build_id, build_status, entries[{timestamp, message}], next_token?}` oldest first; `next_token` is omitted at the end |
| `GET` | `/builds/{build_id}/manifest` | `200` | Stored `build.manifest.json` bytes; `404 BuildManifestNotFound` without a stored assembly (failed or expired build) |
| `GET` | `/information` | `200` | No key. `{service: "build", stage, capabilities[], runner: "CODEBUILD"}` |

Logs and manifest exist only under `/builds/{build_id}`, also for builds started
on `/service` or `/data`. There is no `/keys`, no signing key, no cancel route,
no alias logs/manifest/sources routes and no callback queue. `CANCELLED` is in
the status enum because the PRD lists it; nothing sets it.

## Start request (closed schema)

Exactly one of `source_url` or `source_id`; both or neither is `400 BadRequest`.

| Field | Values |
| --- | --- |
| `source_id` | `src_…` from `POST /sources` (skips the URL probe) |
| `source_url` | `https`, port 443, public host, no credentials, no redirects; a bearer secret |
| `callback_url` | Optional `https` public URL; one best-effort terminal POST (below) |
| `bundle_type` | `SERVICE` \| `DATA` |
| `component_id`, `component_name` | Optional; `component_id` must equal the manifest's |
| `log_level` | `INFO` \| `DEBUG` |
| `worker_size` | `STANDARD` \| `LARGE` |
| `build_architecture` | `X86_64` \| `ARM64` |

Unknown fields (for example `buildspec`, `commands`) are `400 UnknownField`.
`checks`, `synth_context` and `allow_docker_assets` are PRD fields Build does
not support yet: `400 InvalidBuildOption`.

Response: `{"build_id": "bld_…", "build_status": "QUEUED", "transaction_id": "…"}`.
`202` is acceptance only; completion is a terminal status.

## Source upload

`POST` every `upload.fields` entry plus `file` (last) as `multipart/form-data` to
`upload.url` within 15 minutes; S3 answers `204`. The policy requires
`Content-Type: application/zip`, 1 byte to 256 MiB, and names two optional
fields that must be sent (empty when you have no token):
`x-amz-meta-service-code` and `x-amz-meta-service-comply`. A wrong content type
is an S3 `403`. Uploads expire after 1 day; one upload can start several builds
until then.

## Status

`build_status`: `QUEUED` → `VALIDATING` → `BUILDING` → `SUCCEEDED` | `FAILED`.
Main fields: `failure {tag, reason, phase}`, `validation {outcome, root,
entry_count, stacks, findings, warnings?}`, `assembly {stacks, size_bytes, file_count}`,
`asset_policy {outcome, lambda_assets[{asset_id, used_by, file_count, js_bytes,
obfuscated, framework}], findings}`, `provenance {artifact_sha256,
artifact_size_bytes, build_manifest_sha256, source_sha256, service_code,
service_comply ("PRESENT"|"ABSENT"), service_builder, artifact_metadata_keys}`,
`runner {kind: "CODEBUILD", artifact_built, outcome}`, `created_at`,
`updated_at`, `artifact_expires_at` (created + 180 days).

`validation.warnings` lists accepted source problems as `{code, message}`
(today only `ApiSpecMissing`: `base_path` set without
`requirements/swagger.yml`). Warnings never fail a build; the field is
omitted when there are none.

A `SUCCEEDED` build with a stored assembly also has `artifact_url` (presigned
`GetObject`, 15 minutes, a bearer secret; read status again for a fresh one)
and `artifact_url_expires_at`. Failed builds have neither. Status never returns
`source_url` or `callback_url`.

## Artifact

`cloud-assembly.zip` (sorted entries, fixed timestamps):

```text
marketplace.product.json      product manifest, source-only fields removed
build/build.manifest.json     Deploy pack manifest + Build provenance (build.manifest.v2)
cdk.out/manifest.json         exactly one
cdk.out/<Stack>.template.json every stack declares at least one resource
cdk.out/asset.<hash>/…
```

`build/build.manifest.json` also carries top-level `warnings` (the same
`{code, message}` list, `[]` when there are none) and a `builder` block:
`{service: "build", runner_version, codebuild_build_id, node_version,
package_manager, aws_cdk_lib_version?, asset_policy_version,
isolation_version?}`. `builder.package_manager` is the tool pin that ran the
install, `npm@10.9.3` or `pnpm@10.14.0`. The runner pins its own npm and pnpm
versions; the product's `packageManager` field or npm/pnpm version does not
change them.

S3 metadata on the object: `x-amz-meta-service-builder` first, then any
forwarded `service-comply`, `service-code` and other inbound `service-*` values
while they fit S3's 2 KB limit (`provenance.artifact_metadata_keys` lists
them). Build never creates `service-comply`.

`service-builder` is unsigned and JWT-shaped: header
`{"alg":"none","typ":"JWT"}`, base64url JSON claims, empty third segment, at
most 1200 bytes. Required claims: `iss: "build"`, `sub` (= `build_id`), `iat`,
`artifact_kind: "CDK_CLOUD_ASSEMBLY"`, `deployer_contract_version: "1"`,
`component_id`, `source_hash`, `assembly_hash`, `artifact_hash` (all
`sha256:<hex>`), `cloud_assembly {stacks}`, `deployment_parameters`,
`lambda_asset_policy {minified: true, obfuscated: true, source_maps: false}`.
Optional claims, added in this order while the token fits:
`service_comply_sha256`, `bundle_type`, `build_manifest_sha256`,
`source_commit`, `repository`, `runner_version`, `codebuild_build_id`.

Checks a consumer can make: download sha256 == `provenance.artifact_sha256`
== `artifact_hash` without the `sha256:` prefix; manifest route sha256 ==
`provenance.build_manifest_sha256` == sha256 of `build/build.manifest.json`
in the zip; for an uploaded source, `source_hash` == `sha256:` + sha256 of the
uploaded zip.

## Terminal callback (PRD §5.8)

With `callback_url`, one `BuildTerminalCallback` JSON POST when the build ends:
`{status, build_id, transaction_id, component_id, bundle_type}` plus
`artifact_url`, `artifact_url_expires_at`, `artifact_hash` on `SUCCEEDED`, or
`reason` on `FAILED`. Up to 3 attempts in one invocation (5 s each; network
errors, `429` and `5xx` retried), sent at most once, unsigned, no queue. A
failed callback never changes the build's status. The payload's `artifact_url`
is a bearer secret, so use a receiver you control.

## Errors

Body: `{"error": {"tag", "message", "reason"}}`. Every response from a Lambda
carries `x-correlation-id`.

| Status | Tags |
| --- | --- |
| 400 | `BadRequest`, `InvalidJson`, `UnknownField`, `InvalidBuildOption`, `InvalidCallbackUrl` |
| 403 | `ApiKeyDenied` (missing or rejected key); unrouted paths are also `403` |
| 404 | `BuildNotFound`, `BuildManifestNotFound`, `SourceNotFound` (non-PRD) |
| 409 | `BuildRunConflict` |
| 422 | `SourceUrlUnavailable`, `SourceTooLarge`, `UnsafeSourceUrl` (intake); persisted `failure.tag`s below |
| 500 | `InternalServerError`, `CodeBuildRunnerFailed` |
| 504 | `SourceUrlTimeout` |

Persisted `failure.tag` values on a `FAILED` build:

| Phase | Tag | Meaning |
| --- | --- | --- |
| `VALIDATING` | `UnsafeArchivePath` | Traversal, symlink, denied path (`.git/`, `node_modules/`, `cdk.out/`, `.env*`, `.npmrc`, keys), zip bomb |
| `VALIDATING` | `ProductLifecycleCommandRejected` | Command/lifecycle keys in the manifest, `.pnpmfile.*` |
| `VALIDATING` | `LegacyArtifactShape` | `config.json`, `serverless.*`, `samconfig.*`, `Pulumi*.yaml`, `*.tf`, `artifacts/*/update.json` |
| `VALIDATING` | `MarketplaceManifestInvalid` | Missing/invalid `marketplace.product.json`, missing required file, several roots, `component_id` mismatch |
| `VALIDATING` | `BundleTypeMismatch` | Request/route `bundle_type` ≠ manifest |
| `BUILDING` | `DependencyInstallFailed` (non-PRD) | `pnpm install --frozen-lockfile` or `npm ci` failed |
| `BUILDING` | `CdkSynthFailed` | Type check ("Type check failed"), synth, or "Cloud assembly invalid" |
| `BUILDING` | `LambdaAssetPolicyViolation` | A Lambda asset is not minified, obfuscated and source-map-free |
| any | `CodeBuildRunnerFailed` | Runner crash, isolation probe failure, or "CodeBuild capacity unavailable" |
| any | `InternalServerError` | "Build interrupted" (reconcile sweep) |
