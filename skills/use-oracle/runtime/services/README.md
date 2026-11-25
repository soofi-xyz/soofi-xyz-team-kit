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

Start a run, then reconcile it:

```bash
curl localhost:8080/CountyIngest/<county>-<jobId>/run/send \
  --json '{"county":"<county>","jobId":"<jobId>","seedPath":"seeds/<county>.csv"}'
npm run reconcile -- --county <county> --job <jobId> --strict --assemble county
```

Publish one group (stops before the Atlas PR):

```bash
curl localhost:8080/PublishGroup/<county>-county-<jobId>/run/send --json \
  '{"county":"<county>","jobId":"<jobId>","group":"county","groupDir":"groups/<county>/<jobId>/county",
    "atlasPage":"/abs/atlas/counties/<ST>/<county>.json","state":"<ST>","fips":"<fips>"}'
curl -X POST localhost:8080/PublishGroup/<county>-county-<jobId>/status    # awaiting-approval
curl localhost:8080/PublishGroup/<county>-county-<jobId>/approve --json '{"approvedBy":"<name>","groupDigest":"<from status>"}'
```

## Files (`DATA_DIR`)

```
seeds/<county>.csv
artifacts/appraisal/<county>/<jobId>/<parcelKey>/capture.zip | transformed.zip | transformed.meta.json
    | ready.json | dead.json | invalid.json | failed.json | eligibility.json | validate-findings.csv
artifacts/permits/<county>/<jobId>/{raw,extracted,status}/<jurisdiction>/<key>.json   # adapter artifacts
artifacts/permits/<county>/<jobId>/status/<parcelKey>.json                          # link status per parcel
artifacts/permits/<county>/<jobId>/eligible/<PermitFeed key>/c<N>.json              # eligible index
runs/<county>/<jobId>/manifest.json                                                 # reconcile
groups/<county>/<jobId>/<group>/<parcelKey>.zip  (+ <group>.assembly.json beside it)
publish/<county>/<jobId>/<group>/                                                   # hashed/, hash.csv, CAR, tables/, upload json
```

`<parcelKey>` is the parcel id when it is filesystem-safe, otherwise a
sanitized form with a short hash suffix.

## Per-county settings

Capture: `src/counties/<county>/capture.mjs` exporting `capture(input, ctx)`
(or `CAPTURE_MODULE_<COUNTY>`) wins; it writes the prepared ZIP to `input.dest`
and returns `{status: "captured"}` or `{status: "dead", reason}`. Otherwise
`elephant-cli prepare` runs on a seed ZIP built from the row (`source_url`
column or `PREPARE_URL_TEMPLATE_<COUNTY>`), with `counties/<county>/flow.json`
or the `PREPARE_*_<COUNTY>` flow settings.

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

Concurrency: `CONCURRENCY_PREPARE[_<COUNTY>]`, `CONCURRENCY_TRANSFORM[_<COUNTY>]`,
`CONCURRENCY_PERMIT_<ADAPTER>` (adapter keys such as `ACCELA`,
`TYLER_CIVIC_ACCESS`). Restart the services process to apply a change.
