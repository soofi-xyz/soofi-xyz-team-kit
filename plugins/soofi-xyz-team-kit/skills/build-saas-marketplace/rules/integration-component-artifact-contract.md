---
title: Component Artifact Contract
impact: CRITICAL
tags: [artifact, cdk-synth, cloudformation, immutability]
---

# Component Artifact Contract

A component is the **output of `cdk synth`**, not source code. The marketplace deploys what was synthesized — nothing more, nothing less. This rule anchors reproducibility and removes a whole class of "works on the CI machine" bugs.

## What gets registered

A registration payload is a tarball (`tar.gz`) or zip with this exact shape:

```
<component>-<version>.tgz
├── manifest.json              # CDK cloud assembly manifest (copied from cdk.out/)
├── template.json              # root CloudFormation template (or <stack>.template.json)
├── assets/
│   ├── asset.<hash>.zip       # lambda code assets
│   ├── asset.<hash>.json      # nested templates, etc.
│   └── ...
└── metadata.json              # marketplace-specific (see below)
```

`metadata.json` is authored by the registering CI job:

```json
{
  "component": "analytics-api",
  "version": "1.2.0",
  "synthesized_at": "2026-04-23T18:12:05Z",
  "cdk_version": "2.150.0",
  "synthesized_by": "ci@github-actions-run-123",
  "source_commit": "abc1234",
  "checksum_sha256": "…"
}
```

The producer's CI pipeline is responsible for building this archive. A canonical producer flow:

```bash
# in the component's repo
pnpm cdk synth --output cdk.out
cp package-metadata.json cdk.out/metadata.json
tar -czf analytics-api-1.2.0.tgz -C cdk.out .

# upload
curl -X POST \
  -H "Content-Type: application/gzip" \
  -H "Idempotency-Key: analytics-api-1.2.0-ci-run-123" \
  --data-binary @analytics-api-1.2.0.tgz \
  https://marketplace.example.com/components/analytics-api/versions/1.2.0
```

## Rules

1. **Synthesized only.** Never accept raw `cdk` source trees. The marketplace has no build toolchain and no CDK runtime.
2. **Immutable `(component, version)`.** Second registration of the same version returns `409 Conflict`. To change code, bump the version.
3. **Marketplace never calls `cdk synth`.** Deploy time uses CloudFormation directly against the stored `template.json` + assets.
4. **Artifact storage is content-addressed for assets.** Asset filenames already carry their hash (e.g., `asset.abc123.zip`). Preserve those names on S3 so the template's `asset.*` parameters resolve without rewriting.
5. **Checksum and verify.** On upload, compute `sha256` of the archive, compare to `metadata.json.checksum_sha256`, and store it. On deploy, verify the S3 objects still match.
6. **Parameterize, don't re-synthesize.** If a tenant needs a different value for an env var, expose it as a CloudFormation `Parameter` in the synthesized template and pass it per-tenant via StackSet parameter overrides — do not re-run `cdk synth` per tenant.
7. **Region strategy is per component.** A component declares which regions it supports in `metadata.json`; the marketplace rejects subscriptions that target unsupported regions.

## Registration Flow

```
Producer CI → POST /components/{name}/versions/{version}
                 │
                 ▼
         Marketplace API Lambda
                 │
                 ├── verify Idempotency-Key
                 ├── reject if (component, version) exists
                 ├── stream body to S3: s3://component-artifacts/{component}/{version}/archive.tgz
                 ├── unpack archive in a tmpfs Lambda /tmp (size-limited) OR in a Fargate task for large archives
                 ├── upload each file back to s3://component-artifacts/{component}/{version}/<path>
                 ├── verify template.json parses as CloudFormation
                 ├── write Versions row (component, version, s3_prefix, checksum, metadata)
                 └── emit audit event: component.version.registered
```

## ✅ Correct

- Producer CI runs `cdk synth` and uploads the result. Template and assets are stored verbatim on S3.
- `metadata.json` records CDK version, synthesized-at timestamp, and source commit for every registration.
- Same `(component, version)` uploaded twice returns `409 Conflict`.

## ❌ Incorrect

- Marketplace clones the producer's repo and runs `cdk synth` itself at registration or deploy time (adds language runtimes, secrets, and build variance to the marketplace).
- Registered artifact is a `.cdk.json` + TypeScript source (marketplace now needs a CDK runtime).
- Asset hashes rewritten on upload, breaking the `asset.<hash>` parameter lookup in the template.
- Same `(component, version)` re-registration silently overwrites the previous bytes.
