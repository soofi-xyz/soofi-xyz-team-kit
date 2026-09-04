---
name: bootstrap-oracle-infra
description: "Verify and bootstrap the local pipeline stack required for county ingestion - Restate server, data directories, Postgres, and the skills/use-oracle/runtime services process registered with Restate. Use when starting county onboarding, when a run or registration fails because the stack is down or services are missing, or when setting up the pipeline on a fresh machine."
metadata: {"author":"elephant-xyz"}
---
# Bootstrap Oracle Infra

Everything runs locally: Docker Compose (Restate + Postgres) plus one Node
services process. Work happens in the bundled runtime at `skills/use-oracle/runtime` with sibling repos
next to it. Verify first; only bootstrap what is missing. Once prerequisites are
confirmed, proceed without check-ins; ask only on genuine ambiguity.

## Prerequisites check

```bash
docker info >/dev/null && echo docker-ok
node --version          # need 22+
restate --version       # brew install restatedev/tap/restate  (or npm i -g @restatedev/restate)
gh auth status          # PRs to Counties-trasform-scripts
```

## Scaffold `skills/use-oracle/runtime` (if missing)

Layout:

```
elephant/
  skills/use-oracle/runtime/          # your durable pipeline project (scaffolded)
    docker-compose.yml
    services/                 # TypeScript Restate services (one process)
      app.ts                  # endpoint: binds all services, listens on :9080
      county-ingest.ts        # CountyIngest workflow (feeder) + its IngestChunk child workflow
      parcel.ts               # Parcel service (prepare→transform→validate→store)
      permit-harvest.ts       # PermitHarvest service (portal harvesters per vendor)
      loader.ts               # Loader virtual object (per-county DB merges)
      publish.ts              # Publish virtual object (export→approve→IPNS loop)
      enrichment.ts           # SunbizIngest / BbbHarvest workflows
    flows/                    # Browser Flow v2 JSON per county (elephant-cli prepare)
    transforms/               # synced from Counties-trasform-scripts (<county>/scripts/)
    docs/                     # county sources catalogs + findings
                              #   (county-discovery writes docs/<county>-sources.yaml)
    data/                     # pipeline data (gitignored): seeds/ + artifacts/
                              #   created by scaffold: mkdir -p data/seeds data/artifacts docs
  Counties-trasform-scripts/
  elephant-query-db/
  lexicon/                    # optional
```

`docker-compose.yml` (canonical):

```yaml
services:
  restate:
    image: restatedev/restate:1.7.2
    ports: ["8080:8080", "9070:9070"]
    volumes: ["restate-data:/restate-data"]
    extra_hosts: ["host.docker.internal:host-gateway"]
    environment:
      RESTATE_NODE_NAME: restate-1
    restart: unless-stopped
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_PASSWORD: elephant
      POSTGRES_DB: elephant
    volumes: ["pg-data:/var/lib/postgresql/data"]
    restart: unless-stopped
volumes:
  restate-data:
  pg-data:
```

The node name must stay stable — Restate derives it from the container hostname by
default, and a changed identity breaks restoring the persisted `restate-data` volume.

Ports: 8080 Restate ingress (invoke), 9070 Restate admin + Web UI, 9080 the services
Node process (host), 5432 Postgres.

Initialize the package so the scaffold compiles as handed off:

```bash
npm init -y
```

`tsconfig.json` (minimal):

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "strict": true
  }
}
```

Deps: `npm i @restatedev/restate-sdk postgres csv-parse p-limit dotenv tsx typescript
@types/node` plus
`@elephant-xyz/cli` pinned from GitHub — npm publishing has been unreliable — via
`npm i github:elephant-xyz/elephant-cli#<tag-or-commit>` (check the repo's releases
for the latest tested tag and record the chosen ref in the project README; the npm
registry `@elephant-xyz/cli@<version>` is the fallback when publishing works), and
`npm i -D vitest`. Add `"dev": "tsx watch services/app.ts"`,
`"typecheck": "tsc --noEmit"`, and `"test": "vitest run"` to scripts.
(`@aws-sdk/client-s3` is needed only
by the publish services — Filebase upload — not the core scaffold. Playwright/Puppeteer
are installed when authoring browser-based modules — permit vendors, BBB — not part of
the core scaffold.)

`.env`:

```
DATA_DIR=/absolute/path/to/elephant/skills/use-oracle/runtime/data  # absolute — sibling-repo commands rely on it
DATABASE_URL=postgresql://postgres:elephant@localhost:5432/elephant
CONCURRENCY_PREPARE=8
CONCURRENCY_TRANSFORM=16
CONCURRENCY_PERMIT_ACCELA=2
```

The `CONCURRENCY_*` caps feed in-process semaphores — see `durable-workflow-builder`
pattern 2 for how they're enforced.

`services/app.ts` starts as a stub endpoint binding no services yet and listening on
:9080, with `import "dotenv/config"` as its first line so `.env` (DATA_DIR,
DATABASE_URL, `CONCURRENCY_*`) is actually loaded — tsx alone does not read `.env`:

```ts
import "dotenv/config";
import * as restate from "@restatedev/restate-sdk";
restate.serve({ services: [], port: 9080 }); // bind services as you author them
```

Author the actual services per `durable-workflow-builder`; the `app.ts` bind list fills
in as each service is authored.

`services/lib/storage.ts` (dataPath/exists/atomic write — `dataPath` resolves
DATA_DIR-relative paths and rejects absolute/traversal input;
`buildSeedIndex(seedPath)` writes a byte-offset index next to the seed and returns
the row count, and `readSeedBatch` seeks via that index — O(1) per batch, never
rescan the CSV from row 1),
`services/lib/parcel-steps.ts`, and `services/lib/limits.ts` are typed stubs the
operator authors per `durable-workflow-builder`'s contracts before the first run.
The helper-contract signatures live in `durable-workflow-builder`'s "Lib contracts"
block — author them until `npm run typecheck` passes.

## Bring-up + verify

```bash
docker compose up -d

# Restate admin up
curl -s localhost:9070/health

# Data directories exist
mkdir -p data/seeds data/artifacts docs
ls data/ docs/

# Postgres up
docker compose exec postgres psql -U postgres elephant -c "SELECT 1"

# Services process (blocks — leave it running)
npm run dev
```

In a separate terminal (or with `npm run dev` backgrounded), register with Restate:

```bash
restate deployments register http://host.docker.internal:9080
```

Register (or `--force` re-register in dev) each time you author and bind a new service,
then confirm whichever services are registered at that point appear in the Web UI at
`http://localhost:9070`. The full set once everything is authored (10 services):
`CountyIngest`, `IngestChunk`, `Parcel`, `PermitFeed`, `PermitFeedChunk`,
`PermitHarvest`, `Loader`, `Publish`, `SunbizIngest`, `BbbHarvest` (the latter two per
`sunbiz-corporate-ingest`/`bbb-harvest`).

Then raise `inactivityTimeout`/`abortTimeout` for the long-step services (`Loader`,
`Publish`, `SunbizIngest`, `BbbHarvest`, `PermitHarvest` — detail-heavy parcels can
exceed the abort window; alternatively split vendor work into journaled
search/list/detail steps — and `Parcel`, whose heavy captures can also exceed the
abort window) — apply this to whichever of them are
registered so far, and revisit once all are authored: the defaults (1 min inactivity / 10 min
abort) will abort multi-minute bulk/export steps stuck in a single `ctx.run`. Set them
via the service definition's options, or per service in the Web UI/CLI — see
`durable-workflow-builder` authoring rule 3. Also review/tune the **retry policy**
(`default-retry-policy` in the server config, or per-service retry options via the
UI/CLI/SDK) during bootstrap so failures pause on your intended schedule: the stock
`restatedev/restate:1.7` default is ~70 attempts then pause (`on-max-attempts =
"pause"`), which the inspect-paused → fix → resume procedure relies on. Do NOT
explicitly unset the policy — unset means unlimited retries and nothing ever pauses.
See `durable-workflow-builder`'s error taxonomy.

## Sibling repos

- `Counties-trasform-scripts` — county transform scripts + findings docs; PR target.
- `elephant-query-db` — schema + loader scripts; run its migrations against the local
  `DATABASE_URL` before any loading. Use the migration command from that repo's
  README / `package.json` scripts (e.g. `npm run migrate` or its drizzle migration
  script) — check the repo, don't guess.
- `lexicon` — optional, for lexicon-gap work.

## Gotchas

- On Linux, the `extra_hosts: host-gateway` entry is required or Restate-in-Docker
  cannot reach the services process on host :9080.
- Reboot recovery: compose auto-restarts Restate + Postgres
  (`restart: unless-stopped`), but the services process (`npm run dev`) is a plain
  host process and must be relaunched before work resumes. For multi-day runs, run it
  supervised/detached (launchd/systemd-user, or at minimum `nohup npm run dev &`) and
  add `caffeinate -i` on laptops so sleep doesn't kill the run.
- The `restate-data` volume is the durability root: back it up for long runs; remove it
  to wipe all dev state. The complete state of a run is `data/` + the `restate-data`
  volume + `pg_dump`.
- There is only ONE endpoint (the single services process on :9080), so a "new
  deployment version" during a live run is not actually possible. `--force`
  re-registration is fine while iterating in dev; once a real multi-day run is in
  flight, freeze the code. If a fix is unavoidable and replay-compatible (no journaled
  steps added/removed/reordered), apply it in place and `--force` re-register;
  otherwise cancel the affected invocations and re-run them as a redrive pass on the
  new code. See `durable-workflow-builder` authoring rule 2.
