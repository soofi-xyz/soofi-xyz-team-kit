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
restate --version       # brew install restatedev/tap/restate  (or npm i -g @restatedev/restate)
gh auth status          # PRs to Counties-trasform-scripts and Atlas
```

Propose the experimental Elephant CLI 2 before pinning 1.x
([`migrate-elephant-cli-v2`](../migrate-elephant-cli-v2/SKILL.md)): one binary with
`prepare` and `transform` built in, no npm package. Point `ELEPHANT_CLI` at the chosen
binary and record its version and commit.

## Runtime layout

```
skills/use-oracle/runtime/
  local/compose.yaml      # Restate only
  services/app.ts         # one endpoint binding every Restate service, listening on :9080
  src/counties/<county>/  # county config; optional capture.mjs for custom browser capture
  src/permits/adapters/   # permit vendor adapters used by PermitHarvest
  bin/reconcile-county.mjs
  flows/                  # Browser Flow JSON per county (elephant-cli prepare)
  docs/                   # <county>-sources.yaml catalogs + findings
  data/                   # DATA_DIR (gitignored)
```

`DATA_DIR` layout:

```
data/seeds/<county>.csv
data/artifacts/appraisal/<county>/<jobId>/<parcel_id>/capture.zip | transformed.zip | ready.json | dead.json | invalid.json | eligibility.json
data/artifacts/permits/<county>/<jobId>/{raw,extracted,status}/...
data/runs/<county>/<jobId>/manifest.json      # written by reconcile
data/groups/<county>/<jobId>/<group>/         # validated group dirs for publication
data/publish/<county>/<jobId>/<group>/        # hashed zip, hash.csv, CAR, tables/, upload json
```

`local/compose.yaml` runs one service: `restatedev/restate` with ingress `:8080`,
admin/UI `:9070`, the `restate-data` volume, `extra_hosts:
["host.docker.internal:host-gateway"]`, a fixed `RESTATE_NODE_NAME`, and
`restart: unless-stopped`. Keep the node name stable — a changed identity breaks
restoring the persisted `restate-data` volume.

## Environment

Write `skills/use-oracle/runtime/.env` (never commit it):

```
DATA_DIR=/absolute/path/to/skills/use-oracle/runtime/data
ELEPHANT_CLI=/absolute/path/to/elephant-cli
CONCURRENCY_PREPARE=8
CONCURRENCY_TRANSFORM=16
CONCURRENCY_PERMIT_ACCELA=2
```

Add `CONCURRENCY_PREPARE_<COUNTY>` when several counties share the services process.
Add upload credentials only when publication is in scope, and never print them. The
`CONCURRENCY_*` caps feed in-process semaphores — see `durable-workflow-builder`
pattern 2. Do not configure public county pointers, catalog maps, or runtime publishers
here — Atlas publication runs through the Elephant CLI and the Atlas repository
(`use-oracle`).

## Bring-up + verify

```bash
cd skills/use-oracle/runtime
npm ci
docker compose -f local/compose.yaml up -d

# Restate admin up
curl -s localhost:9070/health

# Data directories exist
mkdir -p data/seeds data/artifacts data/runs data/groups data/publish
ls data/ docs/

# Services process on :9080 (blocks — leave it running; see Gotchas for supervision)
npx tsx services/app.ts
```

In a separate terminal, register the services process with Restate:

```bash
restate deployments register http://host.docker.internal:9080   # Docker Desktop / host-gateway
restate deployments register http://localhost:9080              # Linux with host networking
restate services list
```

Require every service in the list: `CountyIngest`, `IngestChunk`, `Parcel`,
`CountyLedger`, `PermitFeed`, `PermitHarvest`, `PublishGroup`. Re-register
(`--force` in dev only) after changing service code.

Raise `inactivityTimeout`/`abortTimeout` for the long-step services (`Parcel` heavy
captures, `PermitHarvest` detail-heavy parcels, `PublishGroup` hashing and upload) or
split their work into smaller journaled steps — the defaults (1 min inactivity / 10 min
abort) abort a multi-minute `ctx.run` forever. See `durable-workflow-builder` authoring
rule 3. Review the retry policy (`default-retry-policy` in the server config, or
per-service options) so failures pause on your intended schedule: the stock
`restatedev/restate:1.7` default retries ~70 times then pauses
(`on-max-attempts = "pause"`), which the inspect-paused → fix → resume procedure relies
on. Do NOT unset the policy — unset means unlimited retries and nothing ever pauses.

## Record the stack proof

After the services list is complete, write the proof into the county catalog
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
  compose project and loopback ports instead of stopping the other stack.
- On Linux without host networking, the `extra_hosts: host-gateway` entry is required or
  Restate-in-Docker cannot reach the services process on host :9080.
- Reboot recovery: compose auto-restarts Restate (`restart: unless-stopped`), but the
  services process is a plain host process and must be relaunched before work resumes.
  For multi-day runs, run it supervised/detached (launchd/systemd-user, or at minimum
  `nohup npx tsx services/app.ts &`) and add `caffeinate -i` on laptops so sleep doesn't
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
  and re-register.

Return Node/Docker/Restate versions, container health, the deployment and services
lists, the CLI build, data-directory readiness, the `stack` catalog section written, the
service smoke result, and blockers. Redact secrets.
