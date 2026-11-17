# Configuration provenance: repo-linked Deploy installs

Every base product records where a configuration write came from and can refuse
one that did not come through Deploy. Builders keep the gate on every
configuration write route; configurers ship configuration only through a
configuration repository and Deploy.

Story: [Require repo-linked Deploy installs for all product configuration writes](https://app.asana.com/1/1213832292301323/project/1218437645682547/task/1220450593111881).
Follow-up: [story 2, link existing configurations to their repos](https://app.asana.com/1/1213832292301323/project/1218437645682547/task/1220467175651868).

## Rule

Configuration reaches a product only through **PR → Build → Marketplace → Deploy**:

1. Change the configuration in its repository through a pull request the user merges.
2. Build packages the merged commit and records its repository and commit.
3. Marketplace reviews and publishes the bundle.
4. Deploy (a run or a Puller subscription) installs it and sends the provenance headers.

Never write configuration to a product API in an environment directly, with the
shared `x-api-key`, an admin role or an IAM caller. Direct writes are for local
or dev tests only (see Rollout).

## Convention (identical in every product)

| Part | Value |
|---|---|
| Request headers | `X-Source-Repository` (`owner/name`), `X-Source-Commit` (full 40- or 64-character lowercase SHA), `X-Deploy-Install-Id` (the Deploy install that sends the write) |
| Storage | `provenance` (`repository`, `commit`, `installId`) on the saved configuration, returned on the write and on GET (Persist keeps it beside the artifact, not in the pointer) |
| Stack parameter | `ConfigurationProvenance`: `Disabled` (default), `Warn`, `Enabled` |
| `Disabled` | Records well-formed headers when sent; otherwise answers as before |
| `Warn` | Saves, returns a warning per problem, logs `configuration write without Deploy provenance` |
| `Enabled` | 400 `PROVENANCE_REQUIRED`, one problem per missing or malformed header **or missing or invalid Deploy signature**, nothing written |

Headers, not body fields, carry provenance so the installed document stays byte
for byte the one Build checked and Marketplace reviewed. Reads and the documented
exempt switches (for example System's `PUT /flows/{name}/schedule/enabled`) need
no headers.

## Deploy signature (only Deploy can pass `Enabled`)

The three headers are claims anyone with the shared key or an admin role could
copy. So Deploy also signs every configuration write it sends, and a product in
`Warn` or `Enabled` checks that signature (convention `deploy-configuration-write-v1`).

| Part | Value |
|---|---|
| Key | KMS HMAC_256 key, alias `alias/deploy-configuration-writer`, in Deploy's `deploy-workflow` stack (account and region Deploy runs in). Only Deploy's ApplyConfiguration and InstallPersistLexicon worker roles, plus the exact role ARNs in `AdditionalConfigurationWriterRoleArns` (default empty; no wildcards), may `kms:GenerateMac`; the account gets `VerifyMac`/`DescribeKey` only. `ConfigurationWriterKeyMode=Existing` installs Deploy without creating the key (second install in the same account and region) |
| Headers | `X-Deploy-Signed-At` (ISO 8601 UTC with `Z`, fresh per attempt) and `X-Deploy-Signature` (padded base64 of `GenerateMac`, `HMAC_SHA_256`) |
| Signed message | 8 UTF-8 lines joined by `\n`, no trailing newline: `deploy-configuration-write-v1`, METHOD, shared-domain path with base path and without query (for example `/system/flows/x`), sha256 hex of the exact body bytes (of the empty string when none), repository, commit, install id, signed-at. Missing repository or commit are empty lines |
| Product check | Signed-at within 300 s; one `kms:VerifyMac` per write on the alias, never cached; KMS errors fail closed. A verified write records `provenance.signed: true` |
| Product IAM | Only `kms:VerifyMac` and `kms:DescribeKey` on `arn:aws:kms:<region>:<account>:key/*` with `ForAnyValue:StringEquals kms:ResourceAliases = alias/deploy-configuration-writer`, on the function that runs the gate |
| Path | Rebuild from API Gateway `requestContext.path`: unchanged through the shared domain; through an execute-api URL replace `/<stage>` with the product's base path (Connect's IAM API already has `/connect`, so only drop the stage) |

Signature problem texts (same refusal shape as the headers):
`X-Deploy-Signature header is required: Deploy's signature of this configuration write`,
`X-Deploy-Signed-At header is required: when Deploy signed this configuration write`,
`X-Deploy-Signed-At must be within 300 seconds of now`,
`X-Deploy-Signature is not Deploy's signature of this request`,
`Deploy signature could not be verified: <AWS error code>`.

Golden vector (Deploy and every product test it): `PUT`, `/system/flows/my-flow`,
body `{"description":"Answer","definition":"answer"}` (sha256
`b2a373a9ef3d3113255b650323e3c5becff2850bfa79aac1c819930d282b26cc`),
`prismteam-ai/acme-configuration`, `0123456789abcdef0123456789abcdef01234567`,
`3f2b8c1e-5d4a-4e7b-9c6d-1a2b3c4d5e6f`, `2026-11-14T17:30:00.000Z`. HMAC-SHA256 of
that message with the UTF-8 test secret `deploy-configuration-writer-test-key`
is `yx72hSkrOrR39gonVpntVgHxQjZPPwk74W9ZZr0n3xk=`; use it to stub `VerifyMac`
(a real KMS signature cannot be reproduced offline).

Builders: a new configuration write route must pass both the header check and
the signature check, and a new Deploy installer must sign through Deploy's
signer (`lambda/services/configuration/signature.ts`). Never add a bypass, an
allow-list of other roles, or result caching.

Where the gate lives:

| Product | Repository (headers; signature) | Gate and record |
|---|---|---|
| System | `prismteam-ai/system` (#110; #112) | `src/configuration/provenance.ts`, `src/configuration/store.ts`, `src/handlers/api.ts` |
| Connect | `prismteam-ai/connect` (#54; #55) | `src/control-plane/provenance-gate.ts`, `src/contracts/provenance.ts` |
| Transform | `prismteam-ai/transform` (#84; #85) | `src/shared/provenance-gate.ts`, `src/shared/provenance.ts`, `src/lambdas/register-*` |
| Report | `prismteam-ai/report` (#5; #6) | `src/api/provenance-gate.ts`, `src/api/provenance.ts` |
| Schedule | `prismteam-ai/schedule` (#8; #9; deletes #10) | `src/api/provenance-gate.ts`, `src/lib/provenance.ts` |
| Inference | `prismteam-ai/inference` (#29; #30) | `src/api/provenance-gate.ts`, `src/configuration/provenance.ts` |
| Persist | `prismteam-ai/persist` (#481; #483; deletes #488) | `lambda/http/provenance-gate.ts`, `lambda/config/provenance.ts`, `lib/configuration-provenance.ts` |
| Model | `prismteam-ai/model` (#83; #84) | `src/http/provenance-gate.ts`, `src/domain/provenance.ts` |
| Console | `prismteam-ai/console` (#15; #16) | `src/handlers/provenance-gate.ts`, `src/domain/provenance.ts` |
| Build | `prismteam-ai/build` (#58; Model and Persist kinds #63) | `src/domain/source-origin.ts`, `src/provenance/build-manifest.ts`, `actions/publish/publish_via_build.py` |
| Deploy | `prismteam-ai/deploy` (#86; #87; Model, Console, Persist installers and key options #89) | `lambda/services/configuration/provenance.ts`, `lambda/services/persist-lexicon/` |

System also has IAM-only `DELETE /flows|templates|definitions/{name}` for orphan
configurations (shared key: 403 `IAM_REQUIRED`; 409 `FLOW_CHANGED`,
`CONFIGURATION_IN_USE` or `TEMPLATE_RUNNING` on conflicts) and the
`RequireFlowRepository` parameter for a flow's `repository` field.

## Build and Deploy

- **Build** accepts `source_repository` and `source_commit` on `POST /builds`
  (both or neither) and records them as `source.repository` and `source.commit`
  in `build/build.manifest.json`. The publish action sends `GITHUB_REPOSITORY`
  and the archived commit (`GITHUB_SHA` in Actions).
- **Deploy** reads the build manifest's `source` (else `bundle.source`) and sends
  the three headers on every configuration-bundle `PUT`/`POST` and on Persist
  lexicon writes; the Persist source is the Model release's
  `productAsset.provenance`. A bundle without a well-formed source sends only
  `X-Deploy-Install-Id`, logs `Configuration provenance warning` and lists
  `provenance not sent: ...` in the install's `warnings`. A
  `PROVENANCE_REQUIRED` answer fails the run as `ProvenanceRequired`.
- **Deploy signs** each of those writes (see Deploy signature) with
  `alias/deploy-configuration-writer` in the run's target region. Every run first
  probes `GenerateMac`; if KMS refuses, the run fails as
  `DeploySignatureUnavailable` with nothing applied, and the message names the
  region and cause (no key there, key owned by another install, key disabled).
- **Configuration kinds Deploy installs:** Transform `mapping`; Connect `flow`,
  `partner-configuration`, `activation`; System `definition`, `template`, `flow`;
  Report `report`; Schedule `schedule`; Inference `configuration`; Console
  `application`; Model `vocabulary`, `change-set` (a directory: `change-set.json`
  plus its artifact files, uploaded to Model's presigned URLs); Persist
  `process-trigger`, `metrics-catalog`, `mcp-configuration`,
  `registered-index-metrics` (the bundle entry `name` is the registered index);
  plus the Persist lexicon and extensions from Model releases. Model installs
  need the shared key to hold Model's Configurer operations.
- **A second Deploy** in an account and region that already has the key: install
  it with `ConfigurationWriterKeyMode=Existing`, then add its
  `ConfigurationWriterRoleArns` output to the key owner's
  `AdditionalConfigurationWriterRoleArns`. Same for a Deploy in another region
  that targets this one.

## Rollout

Turn the gate on per environment, product by product:

1. Ship the product and Deploy releases above (`Disabled`, no change). Deploy
   (with the signing key) must be installed in the same account and region
   before any product goes `Warn` or `Enabled`.
2. Rebuild and republish each configuration bundle with a Build that records
   `source`; confirm Deploy installs show no provenance warning.
3. Set the product's `ConfigurationProvenance` to `Warn`. Watch for the log line
   and response warnings; trace each one to its caller.
4. Link the product's live configurations to their repositories ([story 2](https://app.asana.com/1/1213832292301323/project/1218437645682547/task/1220467175651868)).
5. Only then set `Enabled`, and only where Deploy has an installer for every gated
   route (see Known gaps).

For dev tests, install through Deploy, or set the dev stack to `Warn`. In
`Enabled` even an admin cannot delete or write directly; to clean up a test, set
the parameter back to `Warn` or `Disabled` first (dev only). Do not set
`Disabled` back in an environment that reached `Enabled` to get a direct write in.

## Diagnose

- **`400 PROVENANCE_REQUIRED` from a product:** the problems list names each
  missing or malformed header. System answers `{ error: "PROVENANCE_REQUIRED", problems }`;
  Connect and Transform answer `{ error: { code: "PROVENANCE_REQUIRED", message, problems } }`.
  A direct caller must move the change to its configuration repository and Deploy.
  A Deploy caller points to a bundle without source.
- **Deploy run failed as `ProvenanceRequired`:** the message is
  `<configuration>: <product> <METHOD> <path> returned 400 PROVENANCE_REQUIRED (<problems>): <cause>`.
  If the cause is `bundle has no source repository/commit`, rebuild the bundle
  with a Build that records source (Build #58 or later) and republish. If the
  product refused the bundle's `repository@commit`, check the values are well
  formed and the product's validation matches the convention.
- **Signature problems in a 400 or warning:** `header is required` means the
  write did not come from Deploy (route it through Deploy) or came from a Deploy
  release older than deploy#87. `not Deploy's signature` means the bytes, path,
  method or headers changed after signing, or the caller forged it.
  `within 300 seconds` means clock skew or a replay. `could not be verified:
  NotFoundException` means no `alias/deploy-configuration-writer` in that account
  and region (install Deploy); `AccessDeniedException` means the product's
  `VerifyMac` grant is missing.
- **Deploy run failed as `DeploySignatureUnavailable`:** the worker could not
  `GenerateMac` (key missing, policy changed, throttled). Nothing was applied.
- **Install warning `provenance not sent`:** same fix as a missing source; the
  write succeeded only because the product is not `Enabled`.
- **`configuration write without Deploy provenance` in a product log:** a `Warn`
  product saved a write without provenance. Find the caller from the logged
  actor and route it through Deploy.

## Known gaps

- Shared-key and admin callers are refused in `Enabled` only through the Deploy
  signature; in `Warn` they still save (with warnings). The account root can
  rewrite the key policy; that is CloudTrail-audited and the accepted residual risk.
- Deploy does not delete configurations. In `Enabled`, removing a schedule,
  Persist extension or process trigger (and System's IAM-only deletes aside) means
  setting the product to `Warn` first.
- Model change-set artifacts must be UTF-8 text (Build's bundle reader is text-only).
- Existing live configurations carry no `provenance` until story 2 links them.
