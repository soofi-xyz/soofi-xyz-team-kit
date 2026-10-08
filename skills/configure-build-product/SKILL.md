---
name: configure-build-product
description: "Configure and test Build through its deployed HTTP API: upload a product source zip, start SERVICE/DATA builds, follow status and logs, read the manifest, download and verify the CDK cloud assembly and its service-builder provenance, and check product build readiness. Use Metang; route service gaps to Tinkaton."
---

# Configure Build

Use `metang`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Build capability map](../guide-product-work/reference/iterations/build.md).
Read the [API contract summary](reference/api-contract.md), the relevant
[product contract](../build-build-service/reference/PRD.md) and
[synthetic test data](../build-build-service/reference/test-data.md).

Build is deployed. This skill drives its live HTTP API. Authoritative product:
[`prismteam-ai/build`](https://github.com/prismteam-ai/build). Its
`requirements/swagger.yml`, `README.md`, `AGENTS.md`, `docs/progress.md` and
`scripts/` (`demo.sh`, `smoke.sh`) win over this kit when they differ.

Build turns a TypeScript CDK source zip into a portable CDK cloud assembly zip
with provenance. It never deploys, never publishes to Marketplace, never runs
product-supplied commands and never creates `service-comply`.

## Prerequisites

1. Require two environment variables:
   - `BUILD_BASE_URL`: the `BuildApiUrl` output of stack `BuildApi-<stage>`
     (`https://<api-id>.execute-api.<region>.amazonaws.com/<stage>/`).
   - `BUILD_API_KEY`: a key on that stage's usage plan.

   Do not hardcode hosts, account ids or AWS profiles; use the user's values.
   Check presence with exactly this command and never any other expansion of
   the variables:

   ```bash
   if [ -n "${BUILD_BASE_URL:-}" ]; then echo "BUILD_BASE_URL set (${#BUILD_BASE_URL} chars)"; else echo "BUILD_BASE_URL unset"; fi; if [ -n "${BUILD_API_KEY:-}" ]; then echo "BUILD_API_KEY set (${#BUILD_API_KEY} chars)"; else echo "BUILD_API_KEY unset"; fi
   ```

2. Confirm the URL reaches Build (no key needed, so this does not check the key):

   ```bash
   curl -sS "${BUILD_BASE_URL%/}/information" | jq -c '{service, stage, capabilities}'
   ```

   Expect `"service": "build"` and capabilities including `source-uploads` and
   `marketplace-artifact`.

3. Confirm the key is accepted with this read-only call before any other
   request. It reads a build id that cannot exist, starts nothing and prints
   only the HTTP status:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' -H "x-api-key: $BUILD_API_KEY" "${BUILD_BASE_URL%/}/builds/bld_00000000000000000000000000"
   ```

   `404` (`BuildNotFound`) means the key works. `403` (`ApiKeyDenied`) means the
   key is missing, stale or for another stage. `000` or a DNS error means
   `BUILD_BASE_URL` is wrong.

4. If a variable is unset, the key check returns `403`, or the URL is wrong,
   stop before any API call, say which case it is, give the get-and-set steps
   below and wait. The readiness lane (§1, including its local recipe) reads
   the product repository and calls no Build endpoint, so it may still run. Do
   not call any other endpoint, do not read the values from AWS yourself, and
   do not ask the user to paste the key into chat.

   Offer both ways to get the values; the user picks the one that fits. The
   key is the only credential the API needs, so neither way requires AWS access
   after this step.

   **a. Someone gave you the URL and key** (a teammate with access to the Build
   account, through a secure channel). Go straight to setting them below.

   **b. You have AWS access to the Build account.** Read them in your own
   terminal (they print only there), with a profile for that account
   (`AWS_PROFILE=<selected-profile>`), the stage's region and stage name:

   ```bash
   export AWS_REGION=<region> STAGE=<stage>
   out() { aws cloudformation describe-stacks --stack-name "BuildApi-$STAGE" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
   out BuildApiUrl
   aws apigateway get-api-key --api-key "$(out CallerAApiKeyId)" --include-value --query value --output text
   ```

   Without either, ask someone with access to the Build account to share them.
   Today each stage has only two test keys (`build-<stage>-caller-a` and
   `-caller-b`); there are no per-consumer keys yet.

   Set them for the process that launches Cursor (for example in `~/.zshrc`,
   then launch Cursor from a new terminal, or with `launchctl setenv` on macOS),
   then fully quit and reopen Cursor so the agent can see them. An export in a
   terminal started after Cursor will not reach the agent.

   ```bash
   export BUILD_BASE_URL='<BuildApiUrl output>'
   export BUILD_API_KEY='<the key>'
   ```

   If an old value keeps coming back, remove it where it was set (a shell
   profile, or `launchctl unsetenv BUILD_API_KEY`) before setting the new one.
   Ask them to reply once it is set, then rerun steps 1–3.

5. Pass the key to `curl` only through `-H "x-api-key: $BUILD_API_KEY"` or a
   `curl -K -` config on stdin, never with `-v`, `--trace`, `set -x`, or
   `env`/`printenv` in the same shell.

6. Every Build API call (`GET /information` included), the upload `POST` and
   the presigned artifact download need full network access. A sandboxed
   agent must request it for those commands; a sandbox block is not a Build
   failure.

## Secrets

Never print, log, paste or commit `BUILD_API_KEY`, the `POST /sources` upload
form, `source_url`, `callback_url`, `artifact_url` or a callback payload. Write
response bodies to a file and print only selected fields: strip
`artifact_url` from status (`jq 'del(.artifact_url)'`), and take only
`source_id` and `expires_at` from `POST /sources`. Feed presigned URLs and
forms to `curl` on stdin (`-K -`) and `unset` them after use. Build ids,
source ids, transaction ids and hashes are safe to report.

## Workflow — pick the lane

Classify the request, then run the lanes it needs, in order.

| Lane | When | Start at |
| --- | --- | --- |
| Readiness | Will this product build? A build failed at `VALIDATING` or `BUILDING` | §1 |
| End-to-end check | Prove a product builds, with one copyable command | §2 |
| Source intake | Upload a source zip and get a `source_id` | §3 |
| Start | Start a SERVICE/DATA build, optionally with `callback_url` | §4 |
| Follow | Status, logs, failure tag | §5 |
| Verify artifact | Manifest, download, hashes, `service-builder`, asset policy | §6 |
| Negative cases | Auth, schema and isolation behavior | §7 |
| Service check | Is the deployed stage healthy after a Build change? | §8 |

Hand off and stop when:

| Finding | Owner |
| --- | --- |
| Product source must change (manifest, lockfile, obfuscation, synth error) | Product repository; report the concrete change |
| Build route, runner, policy or validator defect; missing capability | `tinkaton`, with a redacted reproducer |
| Scan / `service-comply`, Marketplace upload, publish, review | `registeel` |
| Installing the artifact into an account | `skarmory` |

Every build runs a real CodeBuild job (about 2–4 minutes; five at once per
stage). Start builds only within the requested scope.

When the user directly asks to build or verify a product, run the baseline
end to end (§2, or §3–§6) and report once. The one-piece-at-a-time flow that
waits for user feedback ("Piece discipline" below) is for guided walkthroughs.

Agents run each command in a fresh shell, so no variable or function survives
between commands. Use a fixed scratch directory, keep ids and bodies in files
there, and make every snippet self-contained. Write the helper once; every
snippet below starts by re-reading it. It sends the key on stdin, writes the
body to `$BUILD_TMP/body` and prints only the status:

```bash
BUILD_TMP="${TMPDIR:-/tmp}/metang-build"; mkdir -p "$BUILD_TMP"
cat > "$BUILD_TMP/api.sh" <<'EOF'
BUILD_TMP="${TMPDIR:-/tmp}/metang-build"
build_api() { # method path [json-body]
  if [ -n "${3:-}" ]; then
    printf 'url = "%s%s"\nheader = "x-api-key: %s"\n' "${BUILD_BASE_URL%/}" "$2" "$BUILD_API_KEY" |
      curl -sS -o "$BUILD_TMP/body" -w '%{http_code}\n' -X "$1" -K - -H 'content-type: application/json' -d "$3"
  else
    printf 'url = "%s%s"\nheader = "x-api-key: %s"\n' "${BUILD_BASE_URL%/}" "$2" "$BUILD_API_KEY" |
      curl -sS -o "$BUILD_TMP/body" -w '%{http_code}\n' -X "$1" -K -
  fi
}
EOF
```

The helper file holds no secret; it reads the variables at call time. Delete
`$BUILD_TMP` when done.

## 1. Product readiness

Check the product repository at the ref to build. Report each item as ready,
missing or cannot verify, with evidence and the concrete change.

- **Layout.** Root (or a single top-level directory) holds
  `marketplace.product.json`, `package.json`, exactly one lockfile
  (`pnpm-lock.yaml` or `package-lock.json`), `tsconfig.json` and
  `marketplace/app.ts`. `requirements/swagger.yml` describing the API is
  recommended when the manifest sets `base_path`; without it the build still
  succeeds with an `ApiSpecMissing` warning.
- **Manifest** (closed schema, unknown fields rejected): `component_id`,
  `component_name`, `bundle_type` (`SERVICE`/`DATA`), optional `entrypoint`
  (defaults to, and must equal, `marketplace/app.ts`),
  `"context_schema_version": "1"`,
  `stacks` (1–50 unique CDK stack ids), optional `base_path`, `requires`
  {`domain`, `shared_usage_plan`, `identity`}, optional `lambda_asset_policy`
  (when present exactly {`minified: true`, `obfuscated: true`,
  `source_maps: false`}). No command or lifecycle keys (`scripts`,
  `synth_command`, `deploy_command`, `engine`, …).
- **Entrypoint.** `marketplace/app.ts` is a normal CDK app (`new App()`) that
  adds exactly the manifest's stacks, each with at least one resource. An
  explicit `app.synth()` is optional: Build runs the entrypoint with `tsx` and
  `CDK_OUTDIR` set, and CDK then synthesizes automatically when the process
  exits (Connect relies on this). It must synth without AWS credentials: no
  context lookups (commit `cdk.context.json`), no SDK calls.
- **Install.** The lockfile picks the package manager: `pnpm install
  --frozen-lockfile --ignore-scripts` or `npm ci --ignore-scripts`. It must
  match `package.json`; both lockfiles, `yarn.lock`/`bun.lock` only, or
  `npm-shrinkwrap.json` are rejected. `typescript` is a dependency; `tsc
  --noEmit -p tsconfig.json` passes. Packages come from the public npm registry through
  Build's CodeArtifact proxy: private registries, `.npmrc`, `.pnpmfile.*`,
  Git dependencies and lifecycle scripts are not available.
- **Lambda assets.** Every Node.js Lambda is bundled minified with no source
  maps, and its entry file is `javascript-obfuscator` output (at least 20
  `_0x…` identifiers). Build fails the build otherwise; it does not obfuscate
  for you. No container image assets, inline `ZipFile` code, pre-zipped
  `Code.fromAsset("x.zip")`, or non-Node.js runtimes for product code. CDK's
  own handlers are exempt (`framework: true`).
- **Excluded paths.** The zip must not contain `.git/`, `node_modules/`,
  `cdk.out/`, `.env*` (except `.env.example`), private keys, `.npmrc`, or
  Serverless/SAM/Terraform/Pulumi layouts. `git archive` of a clean ref
  satisfies this for tracked files.

**Local readiness recipe** (no AWS, no Build API). Checks install, type check,
credentialless synth and Lambda obfuscation the way Build runs them:

```bash
W=$(mktemp -d); git -C <repo> archive <ref> | tar -x -C "$W"; cd "$W"
if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile; else npm ci --ignore-scripts; fi
node_modules/.bin/tsc --noEmit -p tsconfig.json
env -u AWS_PROFILE -u AWS_ACCESS_KEY_ID -u AWS_SECRET_ACCESS_KEY -u AWS_SESSION_TOKEN \
  CDK_OUTDIR="$W/cdk.out" npx tsx marketplace/app.ts
for f in "$W"/cdk.out/asset.*/*.js "$W"/cdk.out/asset.*/*.mjs "$W"/cdk.out/asset.*/*.cjs; do
  [ -f "$f" ] && echo "$(grep -oE '\b_0x[0-9a-f]{4,}\b' "$f" | wc -l | tr -d ' ') ${f#"$W"/cdk.out/}"
done
cd - >/dev/null; rm -rf "$W"
```

Use the lockfile that exists (exactly one). Each Lambda asset's entry file
(the `Handler` file, such as `index.js` for `index.handler`) needs at least
20 `_0x` identifiers; CDK's own framework handlers are exempt. These results
are local evidence only, not a Build run: Build still pins its own npm/pnpm,
installs through CodeArtifact and runs product code as an isolated user.

Making these changes is product source work for the product's owners. Report
them; never create branches, commits or pull requests in a product repository,
and never change Build to make one product pass.

## 2. End-to-end check (`scripts/demo.sh`)

From a checkout of `prismteam-ai/build` at `main`, with `BUILD_BASE_URL` and
`BUILD_API_KEY` set (no AWS credentials needed):

```bash
scripts/demo.sh <product-git-repo> [ref=origin/main]
```

Run the prerequisites' presence check first and run `demo.sh` only when it
shows both variables set. If either is unset, `demo.sh` silently falls back
to reading the URL and caller-A key from AWS with the user's AWS profile and
defaults to stage `dev`.

If the user's Build checkout is on another branch or read-only, never switch
it. Read Build files with `git -C <build> fetch origin` then
`git -C <build> show origin/main:<path>`. To run `demo.sh`, use a temporary
detached worktree and remove it afterwards:

```bash
T="${TMPDIR:-/tmp}/metang-build-main"; git -C <build> fetch origin
git -C <build> worktree add --detach "$T" origin/main
"$T/scripts/demo.sh" <product-git-repo> origin/main
git -C <build> worktree remove --force "$T"
```

It zips the ref with `git archive`, uploads it through `POST /sources`, starts
`POST /builds {source_id}`, polls every 10 s (`DEMO_TIMEOUT_SECONDS`, default
1200), prints the last 40 log lines, and on success checks the manifest and
artifact hashes, lists the zip, prints the per-asset policy and the decoded
`service-builder`. A failure prints `tag`, `reason` and findings and exits 1.
It never prints the key, form or URLs. Optional `MARKETPLACE_REPO` /
`DEPLOY_REPO` run Marketplace's and Deploy's own validators on the artifact;
`inspectBundle` then needs a real `SERVICE_COMPLY` token.

Use this as the copyable invocation for the user. One `demo.sh` run (or one
baseline build through §3–§6) is evidence for the `source-validation`
(intake), `assembly`, `asset-policy` and `provenance` pieces together; count
it for all four rather than starting a build per piece. Use §3–§6 when you
need the individual steps.

## 3. Source intake

```bash
. "${TMPDIR:-/tmp}/metang-build/api.sh"
git -C <repo> archive --format=zip -o "$BUILD_TMP/source.zip" <ref>
shasum -a 256 "$BUILD_TMP/source.zip" | tee "$BUILD_TMP/source.sha256"
build_api POST /sources '{}'            # expect 201
jq -r '.source_id, .expires_at' "$BUILD_TMP/body"
jq -r .source_id "$BUILD_TMP/body" > "$BUILD_TMP/source_id"
{
  jq -r '"url = \"\(.upload.url)\"", (.upload.fields | to_entries[] | "form-string = \"\(.key)=\(.value)\"")' "$BUILD_TMP/body"
  printf 'form-string = "x-amz-meta-service-code=%s"\n' ""
  printf 'form-string = "x-amz-meta-service-comply=%s"\n' ""
  printf 'form = "file=@%s;type=application/zip"\n' "$BUILD_TMP/source.zip"
} | curl -sS -o /dev/null -w '%{http_code}\n' -K -   # expect 204
rm -f "$BUILD_TMP/body"
```

Upload within 15 minutes. Both metadata fields must be sent; put a real
upstream token in one only when the user provides it (Build forwards it
verbatim). The zip's sha256 becomes the build's `source_hash`.

`source_url` remains supported for a caller who hosts the zip on a public
HTTPS URL; it is a bearer secret and gets synchronous address checks.

## 4. Start a build

```bash
. "${TMPDIR:-/tmp}/metang-build/api.sh"
build_api POST /builds "$(jq -nc --arg s "$(cat "$BUILD_TMP/source_id")" '{source_id: $s}')"   # expect 202
jq -c '{build_id, build_status, transaction_id}' "$BUILD_TMP/body" | tee "$BUILD_TMP/start.json"
jq -r .build_id "$BUILD_TMP/body" > "$BUILD_TMP/build_id"
```

Use `/service` or `/data` to pin the bundle type. Add `component_id`,
`log_level`, `worker_size` or `build_architecture` only as needed; any other
field is rejected. For a terminal callback add
`"callback_url": "https://<receiver you control>/…"`: one unsigned
best-effort POST that carries a presigned `artifact_url`, retried at most
three times, never changing the build's outcome. Do not use a public request
inspector for it.

## 5. Follow status and logs

```bash
. "${TMPDIR:-/tmp}/metang-build/api.sh"; build_id=$(cat "$BUILD_TMP/build_id")
build_api GET "/builds/$build_id"
jq 'del(.artifact_url) | {build_status, failure, validation: {outcome: .validation.outcome, warnings: .validation.warnings}, asset_policy: .asset_policy.outcome, runner}' "$BUILD_TMP/body"
build_api GET "/builds/$build_id/logs?limit=500"
jq -r '.entries[].message' "$BUILD_TMP/body" | tail -n 40
```

Poll every 10 s until `SUCCEEDED` or `FAILED`. The row stays `VALIDATING`
while the runner works. Page logs with `next_token` (URL-encode it) until it is
absent. Read `failure.tag`, `failure.phase`, `failure.reason`,
`validation.findings` and `asset_policy.findings`, then use the error table.

## 6. Verify the artifact

```bash
. "${TMPDIR:-/tmp}/metang-build/api.sh"; build_id=$(cat "$BUILD_TMP/build_id")
build_api GET "/builds/$build_id"
jq 'del(.artifact_url)' "$BUILD_TMP/body" > "$BUILD_TMP/status.json"
artifact_url=$(jq -r '.artifact_url // empty' "$BUILD_TMP/body"); rm -f "$BUILD_TMP/body"
printf 'url = "%s"\n' "$artifact_url" | curl -sSf -o "$BUILD_TMP/artifact.zip" -K -; unset artifact_url
shasum -a 256 "$BUILD_TMP/artifact.zip"
jq -r '.provenance | .artifact_sha256, .build_manifest_sha256' "$BUILD_TMP/status.json"
build_api GET "/builds/$build_id/manifest"; shasum -a 256 "$BUILD_TMP/body"
unzip -p "$BUILD_TMP/artifact.zip" build/build.manifest.json | shasum -a 256
unzip -Z1 "$BUILD_TMP/artifact.zip" | sort | head -n 30
jq -r .provenance.service_builder "$BUILD_TMP/status.json" |
  node -e 'const t=require("fs").readFileSync(0,"utf8").trim().split(".");for(const p of t.slice(0,2))console.log(Buffer.from(p,"base64url").toString());console.log("signature:",JSON.stringify(t[2]))'
jq -c '.asset_policy | {outcome, findings, assets: [.lambda_assets[] | {asset_id: .asset_id[0:12], used_by, obfuscated, framework, js_bytes}]}' "$BUILD_TMP/status.json"
```

Accept the artifact only when:

- the download sha256 equals `provenance.artifact_sha256` and the token's
  `artifact_hash` (`sha256:<hex>`);
- the manifest route bytes, `build/build.manifest.json` in the zip and
  `provenance.build_manifest_sha256` agree;
- the zip holds `marketplace.product.json`, `build/build.manifest.json` and
  `cdk.out/` (one `manifest.json`, a template per stack) and no product source;
- the token header is `{"alg":"none","typ":"JWT"}` with an empty signature,
  `iss: "build"`, `sub` = `build_id`, `artifact_kind: "CDK_CLOUD_ASSEMBLY"`,
  `deployer_contract_version: "1"`, `lambda_asset_policy` all true/true/false,
  and `source_hash` = `sha256:` + the uploaded zip's sha256;
- `asset_policy.outcome` is `PASSED` and every non-framework asset is
  `obfuscated: true`;
- `runner.artifact_built` is `true` and `provenance.service_comply` is
  `ABSENT` unless the user supplied one.

The token is unsigned provenance, not an authorization proof. Marketplace
still needs a real `service-comply` for the same source before it accepts the
bundle.

## 7. Negative cases

Run only what the piece needs. None of these start a build except the
bad-zip case.

| Case | Request | Expect |
| --- | --- | --- |
| No key / rejected key | Any route without `x-api-key` or with a wrong one | `403 ApiKeyDenied` |
| Unknown build | `GET /builds/bld_00000000000000000000000000` | `404 BuildNotFound` |
| Another key's build | Caller B reads caller A's `build_id` (status, logs, manifest) | `404 BuildNotFound`, same as unknown |
| Unknown or another key's upload | `POST /builds {"source_id":"src_00000000000000000000000000"}` | `404 SourceNotFound`, same for another key's id |
| Both or neither source | `source_id` + `source_url`, or neither | `400 BadRequest` |
| Unknown field | `{"source_id":"…","buildspec":"echo hi"}` | `400 UnknownField` |
| Unsafe source URL | `{"source_url":"https://10.0.0.1/source.zip"}` | `422 UnsafeSourceUrl` |
| Invalid callback | `{"source_url":"https://example.com/source.zip","callback_url":"https://10.0.0.1/hook"}` | `400 InvalidCallbackUrl` |
| Manifest on a failed build | `GET /builds/<failed id>/manifest` | `404 BuildManifestNotFound` |
| Non-zip upload | Upload form with `Content-Type: text/plain` | S3 `403` |
| Bad zip | Upload a zip without `marketplace.product.json`, then start | `FAILED`, `MarketplaceManifestInvalid` at `VALIDATING` |

Cross-key cases need the second test key; only ask for it when the piece
covers caller isolation.

## 8. Service check (`scripts/smoke.sh`)

After a Build change, the user runs from a Build checkout with AWS access to the
Build account:

```bash
AWS_PROFILE=<selected-profile> AWS_REGION=<region> scripts/smoke.sh --skip-codebuild <stage>
```

It starts no build and checks the API, auth, schema, URL rejection, uploads,
logs, caller isolation, IAM scoping and retention. `--one-build` adds one
baseline SERVICE build with provenance and download checks. The full mode
(every fixture) runs only on explicit request. Exit 0 = passed, 2 = only
CodeBuild capacity blocked checks, 1 = a failure. `smoke.sh` needs AWS
credentials; Metang does not run it with its own.

## Error tags and what to do

| Tag (phase) | Do |
| --- | --- |
| `ApiKeyDenied` | Stop; redo the prerequisites (key missing, stale or for another stage) |
| `BadRequest`, `UnknownField`, `InvalidJson` | Fix the request: one of `source_url`/`source_id`, only documented fields |
| `InvalidBuildOption` | Drop `checks`/`synth_context`/`allow_docker_assets`; match route and `bundle_type` |
| `InvalidCallbackUrl` | Use a public `https` receiver on port 443 |
| `SourceNotFound` | Upload again (forms expire in 15 minutes, uploads in 1 day; ids are per key) |
| `UnsafeSourceUrl`, `SourceUrlUnavailable`, `SourceUrlTimeout`, `SourceTooLarge` | Use `POST /sources`, or a public, reachable URL under 256 MiB |
| `UnsafeArchivePath` (VALIDATING) | Rebuild the zip from `git archive`; remove denied paths and links |
| `ProductLifecycleCommandRejected` (VALIDATING) | Remove command/lifecycle keys and `.pnpmfile.*` |
| `LegacyArtifactShape` (VALIDATING) | Remove Serverless/SAM/Terraform/Pulumi files; ship CDK only |
| `MarketplaceManifestInvalid` (VALIDATING) | Fix the manifest or layout per §1 (`entrypoint` value, `component_id`, lockfile) |
| `BundleTypeMismatch` (VALIDATING) | Use the route that matches the manifest's `bundle_type` |
| `DependencyInstallFailed` (BUILDING) | Update the lockfile (`pnpm-lock.yaml` or `package-lock.json`); drop private or Git dependencies |
| `CdkSynthFailed` (BUILDING) | Read logs: "Type check failed" → fix `tsc`; synth error or lookup → fix the app; "Cloud assembly invalid" → stacks must match the manifest and declare a resource |
| `LambdaAssetPolicyViolation` (BUILDING) | Read `asset_policy.findings`; minify, drop source maps, obfuscate entry files |
| `CodeBuildRunnerFailed` | "CodeBuild capacity unavailable" → retry later; otherwise hand to `tinkaton` |
| `InternalServerError` | Hand to `tinkaton` with `build_id` and `x-correlation-id` |
| `BuildRunConflict` | Retry once; if repeatable, hand to `tinkaton` |

## Piece discipline and evidence

1. Discover the Build revision, `GET /information` capabilities, stage and
   region. Separate required, implemented and observed capabilities; do not
   guess routes.
2. Select the requested feature pieces from the capability map. In each,
   explain the synthetic fixture, then exercise a baseline, a materially
   different supported configuration (`/data`, a wrapped zip, `LARGE`/`ARM64`),
   invalid/unauthorized input and relevant replay/recovery cases. Four pieces
   is a floor for a full walkthrough, not a quota for narrow work.
3. Give the user one copyable invocation (usually `scripts/demo.sh`), the
   expected result and at most three AWS inspection steps: the execution
   named by the `build_id` on state machine `BuildCloudAssembly-<stage>`; the
   CodeBuild build of project `BuildAssembly-<stage>`, whose log stream in
   `/aws/codebuild/BuildAssembly-<stage>` is prefixed by the `build_id`; the
   artifact object. In a guided walkthrough, have them run the baseline and
   variant, then report redacted `build_id`s and observations, and wait for
   that evidence before the next piece. On a direct build or verify request,
   run the baseline yourself and report once.
4. Report evidence levels separately: request accepted (`202`), build
   completed (`SUCCEEDED`/`FAILED`), artifact verified (hashes and token
   checked), consumer validators run. A built artifact is not a published
   bundle or an installed product.
5. If a capability or safe test adapter is missing, leave the check pending
   and hand a redacted reproducer to `tinkaton`. Do not edit Build code or
   buildspecs, write Build's storage, or fall back to direct AWS mutations.

Keep Marketplace publication/review with Regigigas/Registeel and deployment
execution with Corviknight/Skarmory. A successful build proves artifact
creation, not publication or installation.

Return configuration changes, redacted identifiers, API/read-back results,
automated and user/AWS evidence, mocked/live status, cleanup and builder
handoffs.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Verify configuration assets, wire compatibility and shared-provider references; hand source changes to owners and installer gaps to Corviknight.
