---
name: bootstrap-oracle-infra
description: "Verify and bootstrap the local pipeline stack required for county ingestion: the Restate server, data directories, and the bundled runtime services process registered with Restate. Use when starting county onboarding, when a run or registration fails because the stack is down, or when setting up on a fresh machine."
metadata: {"author":"elephant-xyz"}
---

# Bootstrap Oracle Infra

Everything runs locally: Restate in Docker Compose plus one Node services process, both
from the bundled runtime at `skills/use-oracle/runtime`. Restate is the only run-state
store (progress, retries, per-parcel status, dedupe, resume). Files under `DATA_DIR` hold
all data. There is no SQL database, no Postgres service, and no `DATABASE_URL`. Do not
clone sibling source repositories as prerequisites. Verify first; only bootstrap what is
missing. Once prerequisites are confirmed, proceed without check-ins; ask only on genuine
ambiguity.

## Prerequisites check

```bash
docker info >/dev/null && echo docker-ok
node --version          # need 22.18+
restate --version       # optional: `npm run register` and curl cover the essentials
gh auth status          # PRs to Counties-trasform-scripts and Atlas
```

Propose the experimental Elephant CLI 2 before pinning 1.x
([`migrate-elephant-cli-v2`](../migrate-elephant-cli-v2/SKILL.md)): one binary with
`prepare` and `transform` built in, no npm package. Point `ELEPHANT_CLI` at the chosen
binary and record its version and commit.

## Runtime layout

```
skills/use-oracle/runtime/
  docker-compose.yml      # Restate only
  .env.example            # copy to .env (never commit .env)
  services/app.ts         # one endpoint binding all seven Restate services, :9080
  services/README.md      # service table, run commands, file layout
  scripts/register-services.mjs
  bin/reconcile-county.mjs
  counties/<county>/      # flow.json, transform-v2.zip or transforms/ (scripts)
  src/counties/<county>/  # optional capture.mjs for custom browser capture
  src/permits/adapters/   # permit vendor adapters used by PermitHarvest
  flows/<county>.json     # optional Browser Flow JSON (elephant-cli prepare)
  docs/                   # <county>-sources.yaml catalogs + findings
  data/                   # DATA_DIR (gitignored)
```

`DATA_DIR` layout (`<parcelKey>` is the parcel id when filesystem-safe, otherwise a
sanitized form with a short hash suffix):

```
data/seeds/<county>.csv
data/artifacts/appraisal/<county>/<jobId>/<parcelKey>/capture.zip | transformed.zip
    | transformed.meta.json | ready.json | dead.json | invalid.json | failed.json
    | eligibility.json | validate-findings.csv
data/artifacts/permits/<county>/<jobId>/{raw,extracted,status}/<jurisdiction>/<key>.json
data/artifacts/permits/<county>/<jobId>/status/<parcelKey>.json             # link status per parcel
data/artifacts/permits/<county>/<jobId>/eligible/<PermitFeed key>/c<N>.json # eligible index
data/runs/<county>/<jobId>/manifest.json                                    # written by reconcile
data/groups/<county>/<jobId>/<group>/<parcelKey>.zip (+ <group>.assembly.json beside it)
data/publish/<county>/<jobId>/<group>/                                      # hashed/, hash.csv, CAR, tables/, upload json
```

`docker-compose.yml` runs one service: `restatedev/restate:1.7.2` with ingress and
admin/UI bound to loopback (`127.0.0.1:${RESTATE_INGRESS_PORT:-8080}` and
`127.0.0.1:${RESTATE_ADMIN_PORT:-9070}`), the `restate-data` volume, `extra_hosts:
["host.docker.internal:host-gateway"]`, a fixed `RESTATE_NODE_NAME`, and
`restart: unless-stopped`; the project name is `${COMPOSE_PROJECT_NAME:-oracle-local}`.
Keep the node name stable — a changed identity breaks restoring the persisted
`restate-data` volume.

## Environment

Copy `.env.example` to `skills/use-oracle/runtime/.env` (never commit it). The npm
scripts load it with `node --env-file-if-exists=.env`. Per-county names take the
`_<COUNTY>` suffix (slug uppercased, `-` → `_`, so `palm-beach` → `PALM_BEACH`).

| Variable | Purpose |
|---|---|
| `DATA_DIR` | Data root; relative paths resolve against `skills/use-oracle/runtime` (default `data`). |
| `ELEPHANT_CLI`, `ELEPHANT_CLI_COMMIT` | CLI binary (Elephant CLI 2 preferred). Set the commit when the binary prints none (the v2 alpha does not), so ready markers and gates record it. |
| `SERVICES_PORT`, `SERVICES_URL` | Services process port (9080) and the URI `npm run register` registers (default `http://host.docker.internal:9080`). |
| `RESTATE_ADMIN_URL`, `RESTATE_INGRESS_URL` | Admin (9070) and ingress (8080) URLs for register and reconcile. |
| `COMPOSE_PROJECT_NAME`, `RESTATE_INGRESS_PORT`, `RESTATE_ADMIN_PORT` | Compose overrides when another stack holds the default ports. |
| `CONCURRENCY_PREPARE[_<COUNTY>]`, `CONCURRENCY_TRANSFORM[_<COUNTY>]`, `CONCURRENCY_PERMIT_<ADAPTER>` | In-process gates (`durable-workflow-builder` pattern 2); restart the services process to apply. |
| `CAPTURE_MODULE_<COUNTY>`, `PREPARE_URL_TEMPLATE_<COUNTY>`, `PREPARE_{MULTI_REQUEST_FLOW,BROWSER_FLOW,BROWSER_FLOW_ZIP,USE_BROWSER,CONTINUE_BUTTON,IGNORE_CAPTCHA,PROXY}_<COUNTY>` | Capture route; see `county-appraisal-onboarding`. |
| `TRANSFORM_{ZIP,SCRIPTS_DIR,DATA_GROUP,SEED}_<COUNTY>`, `COUNTY_NAME_<COUNTY>` | Transform package, data-group label, Seed merge (`off` disables), display name. |
| `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES[_<COUNTY>]` | Permit eligibility: CSV of usage types, `__ALL__`, or `__NONE__`. Unset means `__NONE__` (appraisal only); set it explicitly anyway. |
| `{PARCEL,PERMIT,PUBLISH}_{INACTIVITY,ABORT}_TIMEOUT_MS` | Long-step Restate timeouts (defaults 15/45 min, 20/60 min, 60/360 min). |
| `IPFS_API`, `IPFS_API_TOKEN`, `ELEPHANT_CAR_GATEWAY`, `FILEBASE_*` | Upload credentials, only when publication is in scope. Never print them. |

There is no `DATABASE_URL`. Do not configure public county pointers, catalog maps, or
runtime publishers here — Atlas publication runs through the Elephant CLI and the Atlas
repository (`use-oracle`).

## Bring-up + verify

```bash
cd skills/use-oracle/runtime
cp .env.example .env              # then set ELEPHANT_CLI and per-county settings
npm ci
docker compose up -d              # or npm run stack:up; Restate only

# Restate admin up
curl -s localhost:9070/health

# Data directories exist
mkdir -p data/seeds data/artifacts data/runs data/groups data/publish
ls data/ docs/

# Services process on :9080 (blocks — leave it running; see Gotchas for supervision)
npm run services                  # node services/app.ts; `npm run dev` restarts on change
```

In a separate terminal, register the services process with Restate through the admin
API:

```bash
npm run register                                    # registers SERVICES_URL, checks all 7 services
npm run register -- --uri http://localhost:9080     # Restate on the host or Linux host networking
npm run register -- --force                         # after handler changes (dev only)
```

`npm run register` exits non-zero and lists `missing` unless every service is visible:
`CountyIngest`, `IngestChunk`, `Parcel`, `CountyLedger`, `PermitFeed`, `PermitHarvest`,
`PublishGroup`. `restate deployments register <uri>` and `restate services list` are
equivalent when the restate CLI is installed.

The long-step services already raise their timeouts (`Parcel`, `PermitHarvest`,
`PublishGroup`, plus `CountyIngest`/`PermitFeed` for indexing); tune them with the
`*_TIMEOUT_MS` variables above rather than in the UI. See `durable-workflow-builder`
authoring rule 3. Review the retry policy (`default-retry-policy` in the server config,
or per-service options) so failures pause on your intended schedule: the stock
`restatedev/restate:1.7` default retries ~70 times then pauses
(`on-max-attempts = "pause"`), which the inspect-paused → fix → resume procedure relies
on. Do NOT unset the policy — unset means unlimited retries and nothing ever pauses.

## Record the stack proof

After `npm run register` reports no missing services, write the proof into the county catalog
`skills/use-oracle/runtime/docs/<county>-sources.yaml` for `county-readiness-preflight`:

```yaml
stack:
  orchestrator: restate
  restate_admin_url: http://localhost:9070
  services_registered: true
  verified_at: "<iso8601>"
  publication:
    in_scope: false          # true when Atlas publication is authorized
    upload_node: null        # required when in_scope is true; publicly reachable through Atlas merge
```

Delete any leftover `destination:` section; the validator only warns on it. When
publication is in scope, verify the upload node by a safe runtime check and Atlas
repository access plus the county-page path, without storing credential values in the
catalog.

## Sibling repos

- `Counties-trasform-scripts` — PR target for county transform scripts and findings
  docs. Not a runtime prerequisite.
- `lexicon` — optional, for lexicon-gap work.

## Gotchas

- On a cloud VM, read
  [`operating-in-vm.md`](../use-oracle/reference/operating-in-vm.md) before probing
  sources: the VM egresses from a hosting ASN that some county firewalls refuse, WARP
  proxy mode is the safe alternate egress, a full-tunnel VPN (Mullvad) needs the
  connect → run → disconnect script, and `pkill -f` must not match its own command.
- If another county's stack already holds the default ports, give the new county its own
  compose project and loopback ports (`COMPOSE_PROJECT_NAME`, `RESTATE_INGRESS_PORT`,
  `RESTATE_ADMIN_PORT`, then matching `RESTATE_*_URL` and `SERVICES_PORT`/`SERVICES_URL`)
  instead of stopping the other stack.
- On Linux without host networking, the `extra_hosts: host-gateway` entry is required or
  Restate-in-Docker cannot reach the services process on host :9080.
- Reboot recovery: compose auto-restarts Restate (`restart: unless-stopped`), but the
  services process is a plain host process and must be relaunched before work resumes.
  For multi-day runs, run it supervised/detached (launchd/systemd-user, or at minimum
  `nohup npm run services &`) and add `caffeinate -i` on laptops so sleep doesn't
  kill the run.
- The `restate-data` volume is the durability root for run state: back it up for long
  runs; remove it to wipe all dev state. Restate keeps finished invocation state only for
  its retention window, so the durable record of a finished run is `data/` plus the
  `data/runs/<county>/<jobId>/manifest.json` written by `reconcile-county.mjs`.
- There is only ONE endpoint (the single services process on :9080), so a "new
  deployment version" during a live run is not actually possible. `--force`
  re-registration is fine while iterating in dev; once a real multi-day run is in
  flight, freeze the code. If a fix is unavoidable and replay-compatible (no journaled
  steps added/removed/reordered), apply it in place and `--force` re-register;
  otherwise cancel the affected invocations and re-run them as a redrive pass on the
  new code. See `durable-workflow-builder` authoring rule 2.
- If ports 8080/9070/9080 conflict, identify the owning local process and ask before
  stopping it. If Restate is up but services are absent, restart the services process
  and run `npm run register`.

Return Node/Docker/Restate versions, container health, the `npm run register` result, the CLI build, data-directory readiness, the `stack` catalog section written, the
service smoke result, and blockers. Redact secrets.
