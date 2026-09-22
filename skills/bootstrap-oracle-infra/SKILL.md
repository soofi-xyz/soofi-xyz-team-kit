---
name: bootstrap-oracle-infra
description: "Verify and bootstrap the bundled local Oracle ingestion stack: Restate, Postgres, runtime data directories, and the services process. Use before county onboarding or when local workflows are unavailable."
metadata: {"author":"elephant-xyz"}
---

# Bootstrap Oracle Infra

Use only the bundled runtime at `skills/use-oracle/runtime/`. Do not require external
ingestion repository checkouts.

## Prerequisites

Verify:

```bash
docker info >/dev/null
node --version
restate --version
```

Require Node 22.18+, Docker, free disk, and localhost ports 5432, 8080, 9070, and 9080.
Install runtime dependencies with:

```bash
(cd skills/use-oracle/runtime && npm ci)
```

## Local stack

The stack consists of:

- Restate server and UI;
- local Postgres for internal Query DB reconciliation;
- one Node services endpoint;
- ignored `data/seeds`, `data/artifacts`, and staging directories;
- bundled county flows, transforms, adapters, and tests.

Start infrastructure from the bundled runtime:

```bash
cd skills/use-oracle/runtime
docker compose up -d
```

Start the runtime services process using the script defined in the bundled package, then
register its endpoint:

```bash
restate deployments register http://host.docker.internal:9080
```

Do not invent missing service files from documentation. Inspect the bundled package and
fail with the exact missing component.

## Environment

Keep `.env` untracked. Configure:

- absolute `DATA_DIR`;
- internal `DATABASE_URL`;
- source-specific concurrency;
- optional AWS/source credentials required by selected stages.

Never print `DATABASE_URL` or secrets. Restart the services process after changing its
environment.

Do not configure public county pointers, catalog maps, or runtime publishers. Atlas
publication runs later through Elephant CLI and the Atlas repository.

## Verification

Require:

```bash
curl -fsS http://localhost:9070
restate deployments list
```

Verify the services endpoint is registered and each required service appears. Run one
read-only or fixture-backed smoke invocation before a live county run.

For Postgres:

- prove the target database and role;
- run owning-package migrations through the bundled runtime integration;
- verify writer connectivity without logging the URL;
- keep the Query DB internal.

## Recovery

- If Docker is down, start Docker and retry once.
- If ports conflict, identify the owning local process and ask before stopping it.
- If Restate is up but services are absent, restart the services endpoint and re-register.
- If a handler changed incompatibly, follow `durable-workflow-builder` deployment rules;
  do not force over active journals without a replay-compatible plan.
- If the machine sleeps, relaunch the services process; durable invocations resume from
  journals.
- If database identity cannot be proven, stop writes.

Return Node/Docker/Restate versions, container health, deployment list, database identity
proof, data-directory readiness, service smoke result, and blockers. Redact secrets.
