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
| `Enabled` | 400 `PROVENANCE_REQUIRED`, one problem per missing or malformed header, nothing written |

Headers, not body fields, carry provenance so the installed document stays byte
for byte the one Build checked and Marketplace reviewed. Reads and the documented
exempt switches (for example System's `PUT /flows/{name}/schedule/enabled`) need
no headers.

Where the gate lives:

| Product | Repository | Gate and record |
|---|---|---|
| System | `prismteam-ai/system` (#110) | `src/configuration/provenance.ts`, `src/configuration/store.ts`, `src/handlers/api.ts` |
| Connect | `prismteam-ai/connect` (#54) | `src/control-plane/provenance-gate.ts`, `src/contracts/provenance.ts` |
| Transform | `prismteam-ai/transform` (#84) | `src/shared/provenance-gate.ts`, `src/shared/provenance.ts`, `src/lambdas/register-*` |
| Report | `prismteam-ai/report` (#5) | `src/api/provenance-gate.ts`, `src/api/provenance.ts` |
| Schedule | `prismteam-ai/schedule` (#8) | `src/api/provenance-gate.ts`, `src/lib/provenance.ts` |
| Inference | `prismteam-ai/inference` (#29) | `src/api/provenance-gate.ts`, `src/configuration/provenance.ts` |
| Persist | `prismteam-ai/persist` (#481) | `lambda/http/provenance-gate.ts`, `lambda/config/provenance.ts`, `lib/configuration-provenance.ts` |
| Model | `prismteam-ai/model` (#83) | `src/http/provenance-gate.ts`, `src/domain/provenance.ts` |
| Console | `prismteam-ai/console` (#15) | `src/handlers/provenance-gate.ts`, `src/domain/provenance.ts` |
| Build | `prismteam-ai/build` (#58) | `src/domain/source-origin.ts`, `src/provenance/build-manifest.ts`, `actions/publish/publish_via_build.py` |
| Deploy | `prismteam-ai/deploy` (#86) | `lambda/services/configuration/provenance.ts`, `lambda/services/persist-lexicon/` |

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

## Rollout

Turn the gate on per environment, product by product:

1. Ship the product and Deploy releases above (`Disabled`, no change).
2. Rebuild and republish each configuration bundle with a Build that records
   `source`; confirm Deploy installs show no provenance warning.
3. Set the product's `ConfigurationProvenance` to `Warn`. Watch for the log line
   and response warnings; trace each one to its caller.
4. Link the product's live configurations to their repositories ([story 2](https://app.asana.com/1/1213832292301323/project/1218437645682547/task/1220467175651868)).
5. Only then set `Enabled`, and only where Deploy has an installer for every gated
   route (see Known gaps).

For dev tests, install through Deploy, or set the dev stack to `Warn`. Do not set
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
- **Install warning `provenance not sent`:** same fix as a missing source; the
  write succeeded only because the product is not `Enabled`.
- **`configuration write without Deploy provenance` in a product log:** a `Warn`
  product saved a write without provenance. Find the caller from the logged
  actor and route it through Deploy.

## Known gaps

- Deploy has no installer for Model or Console yet; neither can go to `Enabled`.
- Deploy installs only the Persist lexicon and extensions. Persist's other gated
  writes (process triggers, metrics catalog, MCP configuration, registered-index
  metrics) have no Deploy installer yet, so `Enabled` blocks them.
- Shared-key and admin callers can still send the headers themselves. Refusing
  them is future work.
- Existing live configurations carry no `provenance` until story 2 links them.
