# Oracle pipeline services (Restate)

One Node process (`app.ts`, port 9080) serves every pipeline service. Restate is
the only run-state store; all data lives in files under `DATA_DIR`. There is no
database.

| Service | Kind | Key | Handlers |
|---|---|---|---|
| `CountyIngest` | workflow | `<county>-<jobId>[-rN]` | `run({county, jobId, seedPath, chunkSize=10000, window=25, startPermits=true, permitWindow?})`, `status()` |
| `IngestChunk` | workflow | `<CountyIngest key>-c<N>` | `run({county, jobId, rows \| seed, window})`, `status()` |
| `Parcel` | service | — | `process({county, jobId, parcel_id, source_identifier?, situs_address?, extra?})` |
| `CountyLedger` | virtual object | `<county>-<jobId>` | `record`, `get`, `summary` (shared), `list` (shared) |
| `PermitFeed` | workflow | `<CountyIngest key>-permits` (children `…-c<N>`) | `run({county, jobId, window, chunkSize?})`, `status()` |
| `PermitHarvest` | service | — | `harvestParcel({county, jobId, parcel_id})` |
| `PublishGroup` | workflow | `<county>-<group>-<jobId>` | `run({county, jobId, group, groupDir, atlasPage, state, fips})`, `approve({approvedBy, groupDigest?})`, `reject({reason})`, `status()` |

## Run it

```bash
cd skills/use-oracle/runtime
cp .env.example .env            # set ELEPHANT_CLI and per-county settings
npm ci
docker compose up -d            # Restate only: ingress :8080, admin/UI :9070
npm run services                # or `npm run dev` (restarts on change)
npm run register                # admin API; --force after handler changes
```

`npm run register` registers `SERVICES_URL` (default
`http://host.docker.internal:9080`, which compose maps to the host). With
Restate on the host or on host networking, use
`npm run register -- --uri http://localhost:9080`.

Binding: `SERVICES_HOST=auto` (default) listens on `127.0.0.1` plus the Docker
default-bridge gateway (`docker0`, usually `172.17.0.1`), which is where
`host.docker.internal:host-gateway` lands from the compose Restate on Linux.
The endpoint never listens on the machine's public interfaces by default. Set
`SERVICES_HOST=127.0.0.1` when Restate runs on the host, or an explicit list.
`0.0.0.0` is for a remote Restate only, and only with request identity:

Request identity (optional hardening): start Restate with an ed25519 private
key (`openssl genpkey -algorithm ed25519 -out request-identity.pem`, mounted
into the container with
`RESTATE_REQUEST_IDENTITY_PRIVATE_KEY_PEM_FILE=/identity/request-identity.pem`
in a compose override file). Restate logs the matching `publickeyv1_…` key at
startup; set `RESTATE_IDENTITY_KEYS=<that key>` (comma list allowed) and
restart the services process. Unsigned requests then get HTTP 401.

Start a run, then reconcile it:

```bash
curl localhost:8080/CountyIngest/<county>-<jobId>/run/send \
  --json '{"county":"<county>","jobId":"<jobId>","seedPath":"seeds/<county>.csv"}'
npm run reconcile -- --county <county> --job <jobId> --strict --assemble county
```

Without `--seed`, reconcile uses the seed the run was started with (CountyIngest
`<county>-<jobId>` state via the admin API, then its `status` handler), falling
back to `seeds/<county>.csv`; the manifest records `seed.source`.
`CountyIngest` awaits its `PermitFeed`, so its `status()` phase moves
`appraisal` → `permits` → `done` (or `appraisal-done` with `startPermits:false`)
and carries the permit counts.

Publish one group (stops before the Atlas PR):

```bash
curl localhost:8080/PublishGroup/<county>-county-<jobId>/run/send --json \
  '{"county":"<county>","jobId":"<jobId>","group":"county","groupDir":"groups/<county>/<jobId>/county",
    "atlasPage":"/abs/atlas/counties/<ST>/<county>.json","state":"<ST>","fips":"<fips>"}'
curl -X POST localhost:8080/PublishGroup/<county>-county-<jobId>/status    # awaiting-approval
curl localhost:8080/PublishGroup/<county>-county-<jobId>/approve --json '{"approvedBy":"<name>","groupDigest":"<from status>"}'
```

`export-tables --atlas-page` writes to a STAGED copy of the page under
`publish/<county>/<jobId>/<group>/atlas/counties/<ST>/<county>.json` (seeded
from the checkout page when it exists); review it with the status
(`atlasPage.staged`). The given Atlas checkout path is written only after
approval and verified upload readback, and only if that page has not changed
since export (otherwise the run fails and must be rerun). Publication then
continues with one Atlas PR per `use-oracle`.

Only the County group (or another appraisal-transform group) is publishable
through PublishGroup today: no Restate stage yet produces a
`property_improvement` permit group from the permit artifacts, and official
identity edges (company, license, person) are not emitted either.

## Files (`DATA_DIR`)

```
seeds/<county>.csv
artifacts/appraisal/<county>/<jobId>/<parcelKey>/capture.zip | transformed.zip | transformed.meta.json
    | ready.json | dead.json | invalid.json | failed.json | eligibility.json | validate-findings.csv
artifacts/permits/<county>/<jobId>/{raw,extracted,status}/<jurisdiction>/<key>.json   # adapter artifacts
artifacts/permits/<county>/<jobId>/status/<parcelKey>.json                          # link status per parcel
artifacts/permits/<county>/<jobId>/eligible/<PermitFeed key>/c<N>.json              # eligible index
publish/<county>/<jobId>/<group>/atlas/counties/<ST>/<county>.json                  # staged Atlas page
runs/<county>/<jobId>/manifest.json                                                 # reconcile
groups/<county>/<jobId>/<group>/<parcelKey>.zip  (+ <group>.assembly.json beside it)
publish/<county>/<jobId>/<group>/                                                   # hashed/, hash.csv, CAR, tables/, upload json
```

`<parcelKey>` is the parcel id when it is filesystem-safe, otherwise a
sanitized form with a short hash suffix.

## Per-county settings

Capture: `src/counties/<county>/capture.mjs` exporting `capture(input, ctx)`
(or `CAPTURE_MODULE_<COUNTY>`) wins. The parcel directory (`input.parcelDir`)
exists before the call; `ctx` is `{signal, timeoutMs, parcelDir}`, where
`signal` aborts at `CAPTURE_TIMEOUT_MS[_<COUNTY>]` (default 10 min; the step
then fails and is retried). The plug-in writes the prepared ZIP to
`input.dest` and returns `{status: "captured"}` or `{status: "dead", reason}`.
Otherwise `elephant-cli prepare` runs on a seed ZIP built from the row, with
`counties/<county>/flow.json` or the `PREPARE_*_<COUNTY>` flow settings.

Source request (`source_http_request`) is kept whole end to end: method, base
URL, `multiValueQueryString`, and `json` or `body` with a `content-type`
header. Seed columns `source_url`/`url`, `method`, `multiValueQueryString`,
`json`, `body`, `headers`, `content_type`; or templates
`PREPARE_URL_TEMPLATE_<COUNTY>` (a query string moves into
`multiValueQueryString`), `PREPARE_METHOD_<COUNTY>`,
`PREPARE_JSON_TEMPLATE_<COUNTY>`, `PREPARE_BODY_TEMPLATE_<COUNTY>`,
`PREPARE_CONTENT_TYPE_<COUNTY>` (each fills `{parcel_id}` and
`{source_identifier}`). The merged Seed group takes the request the capture
actually stored (`property_seed.json`, `parcel.json` or `address.json`) first.

Transform: `TRANSFORM_ZIP_<COUNTY>` or `counties/<county>/transform-v2.zip`
(handler package), else the county scripts directory. `TRANSFORM_DATA_GROUP_<COUNTY>`
names the group. When the county output carries no Seed root, the CLI's
seed-mode transform runs from the seed row and is merged in
(`TRANSFORM_SEED_<COUNTY>=off` disables it); the hash step needs Seed in every
property. The transform version is the package digest, so a changed package
re-transforms from the stored capture and an unchanged one is skipped.

Permit eligibility: `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_<COUNTY>`
(CSV of transformed `property_usage_type` values, `__ALL__`, or `__NONE__`);
unset means `__NONE__`.

Permit routing: `src/counties/<county>/permit-routing.mjs` (or
`PERMIT_ROUTING_MODULE_<COUNTY>`) may export
`resolveJurisdiction({seedRow, routing, profile})` returning a permit-profile
jurisdiction key (route by tax district or any seed column) or null for the
default city routing (seed `city`, `situs_city`, `address_city`, then situs).

Permit adapter options: `PERMIT_TIMEOUT_MS_<COUNTY>`,
`PERMIT_MAX_ATTEMPTS_<COUNTY>`, `PERMIT_CHROMIUM_PATH_<COUNTY>` (else
`CHROME_EXECUTABLE_PATH`), `PERMIT_HEADLESS_<COUNTY>`, and
`PERMIT_ADAPTER_OPTIONS_<COUNTY>` (JSON object of scalars) reach every adapter
with the profile's `countyKey`/`countyName`.

Bulk permits: `PERMIT_BULK_DIR_<COUNTY>` (DATA_DIR-relative or absolute) names a
directory of per-source snapshots, `<jurisdiction or adapter-route key>/linked-permits.jsonl`
(one normalized permit record per line, already bound to its
`parcel_identifier`) plus `summary.json` (`{jurisdictionKey, routeKey?,
adapterKey?, snapshotSha256?, completedAt?}`). PermitHarvest reads each
parcel's records from it with no portal traffic and writes the same
raw/extracted/status artifacts; a jurisdiction without a snapshot falls back
to its live adapter. A blocked primary portal is still covered by its
snapshot.

Permit outcomes in the ledger (`stage: "permits"`): `ready` (harvested; reason
`unlinked: N` when some permits could not be linked), `blocked` (the source is
blocked, e.g. captcha, login or custodian-only: harvestable later), `dead`
(no profile, not eligible, unrouted), `failed`. Reconcile reports blocked
parcels by jurisdiction apart from dead ones.

Concurrency: `CONCURRENCY_PREPARE[_<COUNTY>]`, `CONCURRENCY_TRANSFORM[_<COUNTY>]`,
`CONCURRENCY_PERMIT_<ADAPTER>` (adapter keys such as `ACCELA`,
`TYLER_CIVIC_ACCESS`). Restart the services process to apply a change.
