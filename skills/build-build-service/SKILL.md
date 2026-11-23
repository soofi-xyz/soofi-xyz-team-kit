---
name: build-build-service
description: "Build or maintain the Build HTTP API and its source intake, isolated build jobs, CDK synthesis, runtime asset policy, provenance, observable results and delivery. Use Tinkaton; use Metang for existing-service configuration."
disable-model-invocation: true
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Build Build

Use `tinkaton`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Build capability map](../guide-product-work/reference/iterations/build.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `metang` with [configure-build-product](../configure-build-product/SKILL.md)
for operations through an existing deployment.

## Scope and contract

Read [the product contract](reference/PRD.md) and
[synthetic test data and dependency fakes](reference/test-data.md) before coding.
Discover the target repository/revision, supported contract, deployment and
selected AWS profile; verify the account and region. Record discrepancies between
the specification and observed implementation without inventing deployed routes.

Deliver an HTTP API with explicit authentication, caller/resource authorization,
request validation, correlated errors and observable results. Expose submission,
status and results for async capabilities. Reuse execution logic behind CLI,
workflow and API adapters; a direct workflow call does not complete API acceptance.
No separate API-documentation workstream is added.

Preserve Build-owned runner commands, isolated source execution and credentialless synthesis. Reject product-controlled lifecycle hooks, unsafe archive paths, forbidden lookups and leaked secrets. Emit portable CDK cloud assemblies with verified template/asset digests and minified, obfuscated, source-map-free Lambda assets as required by the verified contract.

Keep Marketplace publication/review with Regigigas/Registeel and deployment execution with Corviknight/Skarmory. A successful build proves artifact creation, not publication or installation.

## Build each feature piece

1. Select and order the capability map's logical features. Use at least four
   increments for a full-product build; scope narrow fixes to relevant pieces.
   Bring the minimal API and authorized test deployment into the first usable
   increment so the person can try it before further implementation.
2. Show the next feature with synthetic data, then implement only that piece.
   Mock external dependencies and effects first. Use the linked fixture matrix
   to test baseline, a supported variant, invalid/unauthorized input and relevant
   replay, timeout and recovery paths. Verify effects, redaction and HTTP results.
3. Make the piece runnable through the API in the authorized test environment.
   Give one invocation, expected output and at most three AWS inspection steps
   using actual resource names. Have the user run the baseline and variant and
   return request/execution IDs and observations. Wait for their evidence before
   implementing the next piece; fix a failed current check before advancing.
4. Finish selected pieces with cumulative acceptance and requested, authorized
   live dependencies. Keep local unit tests, synthesis, deployed mocked runs and
   real effects distinct. Never claim a mock dependency proves its live service.

Return changes, supported API/configuration examples, automated and user evidence,
AWS observations, cleanup and remaining gaps. Keep reusable product code in its
target repository; this kit contains guidance and synthetic inputs.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Package configuration assets and shared-provider declarations; verify digests without calling target APIs or adding per-bundle Lambdas.
The configuration bundle check must apply parameter defaults with the same fill
as Deploy before `JSON.parse`, then run the structural and type checks on the
filled document (the `sha256` stays over the original source). A Build/Deploy
mismatch here is a defect — see [prismteam-ai/build#68](https://github.com/prismteam-ai/build/pull/68).

Keep each closed product document's top-level field list (`FieldRules` in
`src/configuration/bundle-check.ts`) equal to the target product's schema
`properties`, optional fields included; the Console list includes `forms` (an
array of at most 20). When a product adds a top-level field, add it with its
shape rather than opening the list, and keep refusing unknown fields. Test a
manifest using the new field and one with an unknown field. A field the target
product accepts but Build refuses is a defect.

## Console apps and design-system configuration

`console` `design-system` and `app` (prismteam-ai/build#70) and `component-pack`
(prismteam-ai/build#76) are `CONFIGURATION` kinds (`configuration-bundle-check.v6`,
`assembly-runner.v11`); keep them that way so Marketplace and Deploy's Puller need no
new bundle type. Keep these rules:

- **`design-system`.** One JSON file checked against Console's closed
  `DesignSystemConfiguration` (`src/configuration/console-design-system.ts`) after
  parameter defaults are filled; named `design-system`, once per bundle; no
  `{{secret:…}}`. When Console's schema changes, change this copy with it and test
  the new value and a refused one. Runs no code.
- **Routing.** `FetchSource` sends a bundle holding an `app` to the CodeBuild runner
  (`PACKAGE_AS=CONFIGURATION_BUILD`, `src/runner/run-configuration.ts`);
  `PackageConfiguration` refuses one and `packageConfigurationBundle` throws on an
  unbuilt app, so nothing packs an app the runner did not check.
- **Kit gate before install** (`src/configuration/console-app.ts`). Require an exact
  `@prism/console-app-kit` pin in `dependencies` and `pnpm-lock.yaml` pinning the same
  version with only `{ integrity: sha512-… }` resolutions and registry versions on every
  `snapshots` dependency edge. Refuse `file:`, `link:`, git,
  tarball and `npm:` alias sources, ranges, lockfile `overrides`/`patchedDependencies`,
  `pnpm`/`overrides`/`resolutions` in `package.json`, `pnpm-workspace.yaml`,
  `.pnpmfile.cjs`, any other lockfile and a committed `dist/`. Require pnpm: an npm
  lockfile writes the registry host into every `resolved` URL.
- **Run.** Install every app with Build's fixed pnpm command as the product user, then
  remove the registry login before any check; require `node_modules/@prism/console-app-kit` to be
  pnpm's store copy of the pinned name and version; run that kit's
  `console-app check --json` as the product user into a runner-owned file. A non-zero
  exit or `passed` not `true` fails at `BUILDING` with `ConfigurationBundleInvalid`,
  naming each `rule file:line`; stage nothing.
- **Output.** Verify `dist/build-record.json` (passed check, the app's `appId`, the
  pinned kit) and that `dist/` holds exactly the files it lists, UTF-8 and matching
  their digests. Pack only `dist/` (Console's `{ buildRecord, files }` upload body) and
  record `app.kit_version`, `app.kit_integrity` and `app.build` in the build manifest.
- **`component-pack`** (`src/configuration/console-pack.ts`, `console-app.ts`,
  `src/runner/run-configuration.ts`). A directory with `console-pack.json` (`pack`
  matching Console's `AppIdentifier`, an exact `version`), `package.json` and
  `pnpm-lock.yaml`, routed to the runner like an app and under the same kit gate,
  registry binding, install and installed-kit check (the pack tool is in kit 1.29.0 and
  later). Also refuse a committed `package/`, where the check writes the types package,
  and any `{{parameter:…}}` or `{{secret:…}}`. Named by `pack`, versioned by `version`.
  Gate with `console-app pack check --json` only: it is the gate and the build, writing
  `dist/` and `dist/pack-record.json` only when every rule passes. Never run
  `pack build`: with the real kit it empties `dist/`, deletes `pack-record.json` and
  applies no rules. A failing pack fails at `BUILDING` with `ConfigurationBundleInvalid`
  naming each rule, file and line, and stages nothing (`AD-7`). Check
  `dist/pack-record.json` against Build's copy of Console's closed pack-record schema
  (`gallery` optional, for kits before 1.33.0) and against this pack, its `version`, the
  pinned kit and the types package `@prism/console-pack-<pack>` at that version; require
  `index.js`, only flat `.js` files Console hosts (at most 50) and `dist/` holding exactly
  the listed files, UTF-8, digest and size matching. The artifact is
  `dist/pack-record.json` plus exactly those files, Console's `installPackVersion` body
  `{ packRecord, files: [{ path, contentBase64 }] }`; record `version`,
  `pack.kit_version`, `pack.kit_integrity` and `pack.build`. When Console's pack-record
  schema changes, change Build's copy with it. Publishing the types package is
  Console's CI (`published-packs.json`, prismteam-ai/console#53) and installing is
  Deploy's.
- **Bind the kit to the published release** (`src/runner/kit-registry.ts`, before
  install). Require the pinned version in Build's registry with origin `INTERNAL`,
  status `Published` and exactly one tarball whose SHA-512 equals the lockfile's
  integrity; fail closed when no registry is configured. Grant the runner only
  `DescribePackageVersion` and `ListPackageVersionAssets` on the kit package.
- **Registry.** The CodeArtifact package group `/npm/prism/*` blocks the public npm
  upstream for `@prism` packages. Resource policies on both repositories deny
  `PublishPackageVersion` on `npm/prism/*` to everyone but `privatePackagePublishers`
  and deny `CopyPackageVersions`. Until the kit is published an app build fails
  before install.
- **Publisher** (`lib/console-kit-publisher.ts`, `-c consoleKitPublisher=true`).
  `Build-<stage>-ConsoleKitPublisher` trusts only the account's existing GitHub OIDC
  provider with `aud` `sts.amazonaws.com` and `sub`
  `repo:prismteam-ai@275408031/console@1408014148:ref:refs/heads/main`
  (prismteam-ai/build#74). prismteam-ai repositories use GitHub's immutable subject
  (owner and repository ids); a role trusting `repo:prismteam-ai/console:…` refuses
  Console's CI at `AssumeRoleWithWebIdentity`. Read a repository's subject form (its
  OIDC customization's `use_immutable_subject`) before writing any trust policy. A Build
  installed through Deploy creates no such role: its registry policies exempt
  `<BuildWorkflow stack>-ConsoleKitPublisher` by name, and an administrator deploys the
  `BuildConsoleKitPublisher` stack (`bin/console-kit-publisher.ts`, prismteam-ai/build#73)
  where Console publishes. In prism-marketplace (848665034107) that role is
  `BuildWorkflow-ConsoleKitPublisher`, and Console's CI uses it for the app kit and each
  listed pack's types package. Reference the provider, never create
  it: IAM allows one per issuer per account and other products share it. Grant publish
  and read on `npm/prism/*` only, never delete, dispose, copy or status changes, and
  leave it out of the Marketplace pack. Before the first publish, audit retained
  `@prism/*` versions in both repositories and dispose of any whose origin cannot be
  confirmed.
- **Tests.** Add a fake-kit case for each new way a source could resolve the kit, and
  run the real path against a stand-in registry (Verdaccio), never AWS.

## Configuration provenance

Follow [configuration provenance: repo-linked Deploy installs](../guide-product-work/reference/configuration-provenance.md).
Accept `source_repository` and `source_commit` on `POST /builds` (both or neither,
`src/domain/source-origin.ts`) and record them as `source.repository` and `source.commit`
in `build/build.manifest.json` (`src/provenance/build-manifest.ts`); drop malformed stored
values rather than ship them. Keep the publish action
(`actions/publish/publish_via_build.py`) sending `GITHUB_REPOSITORY` and the archived
commit (`GITHUB_SHA`). Deploy sends these to products as provenance headers.

## Shared API domain

For API infrastructure, packaging, review or installation, read and apply
[the shared API domain contract](../guide-product-work/reference/shared-api-domain.md).
Require the API Gateway domain and product-owned mappings; keep DNS traffic
records optional. Publish `base_path` and `requires.domain: true` only;
`endpoints`/`endpoint_contract_version` need a Build schema change first. Read
domain metadata from `/account/env-parameters`. Verify support in the target
revision and route missing behavior to the responsible builder.
