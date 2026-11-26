# Full run on Restate flow control (enqueue + ramp)

The default full-run fan-out. Each parcel is one `Parcel.process` invocation, sent one-way
through Restate's scoped ingress. Restate's VQueues hold the backlog, and a rule on the
source's **scope** caps how many run at once. No feeder workflow and no batch barrier.
`CountyIngest` chunk mode (`../SKILL.md` §3) stays as the fallback.

Measured on Cobb / qPublic, 2026-11-26, same machine and site:

| Fan-out | Captures in flight | Rate | Failures / retries |
|---|---|---|---|
| `CountyIngest` feeder, `window` 25, await all | 18 (running swung 1–25) | 10.8–12.6k parcels/h | — |
| VQueues, scope cap 6 | 6 | ~8,900/h | 0.0–0.3% |
| VQueues, scope cap 12 | 12 | ~18,700/h | 0.0–0.3% |
| VQueues, scope cap 18 | 18 | ~26,300/h | 0.0–0.3% |

Without the batch barrier each worker hits the site about 3x as often (about 7.3 qPublic
page loads/s at cap 18, against about 0.95/s for the feeder at 18). So size the cap by the
source's request rate, ramp it, and never go above 18 without a measured benchmark.

## Prerequisites

- Restate **1.7.9** with VQueues on (`bootstrap-oracle-infra`): `curl -s
  localhost:9070/version` shows `"vqueues": true`. The bundled compose file starts a fresh
  volume that way. Migrating an existing volume is one-way; back it up first.
- `npm run register` printed `oracle_flow_control` with `idempotency_retention` 14d for
  `Parcel` and `PermitHarvest`. Restate keeps idempotency keys 24 h after completion by
  default; the services set 14 days in their options, because re-registering a deployment
  overwrites values set only through the admin API.
- The in-process capture gate is **above** the top ramp level, so Restate's cap is the one
  that binds: `CONCURRENCY_PREPARE_<COUNTY>=24` for a ramp to 18. Restart the services
  process after changing it. For permits, `CONCURRENCY_PERMIT_<ADAPTER>` at or above that
  permit scope's cap.
- A scope per source site. Default `<county>-appraisal`. Set `APPRAISAL_SCOPE_<COUNTY>` when
  several counties hit the same site (for example `qpublic`), so they share one cap.
  Idempotency is per scope: keep the same scope on every re-run of a job.
- Services supervised with a short stop timeout (`TimeoutStopSec=20` under systemd). The
  services process does not stop on SIGTERM, and without that systemd waits 90 s and then
  SIGKILLs it. In-flight parcels resume from their journals either way.

## Run it

Run from `skills/use-oracle/runtime`. Name the job `full-<YYYYMMDD>`.

```bash
# 1. Enqueue. Creates the scope rule at SCOPE_CAP_<SCOPE> (default 6) when none exists.
npm run enqueue -- --county <county> --job full-<YYYYMMDD> --seed seeds/<county>.csv
#    -> {"event":"oracle_enqueue_parcels","scope":"<county>-appraisal","sent":…,
#        "skipped":…,"counts":{"Accepted":…},"rule":{"cap":6,"action":"created"},"warnings":[]}

# 2. Ramp the cap on measured health (leave it running; it exits when the queue drains).
systemd-run --user --unit=oracle-ramp-<county> --collect -p WorkingDirectory=$PWD \
  "$(command -v node)" --env-file-if-exists=.env bin/ramp-scope.ts --county <county> --job full-<YYYYMMDD>
#    (or: npm run ramp -- --county <county> --job full-<YYYYMMDD> in tmux)

# 3. Report (repeat as needed).
npm run status -- --county <county> --job full-<YYYYMMDD>
```

What the enqueuer does:

- Sends `POST <ingress>/restate/scope/<scope>/send/Parcel/process` per seed row with
  header `idempotency-key: <county>-<jobId>-<parcel_id>`, 16 sends in parallel. Only
  408, 425, 429, 5xx and network errors are retried. On Cobb, 220,903 sends took 43 s.
- Skips parcels whose directory already has `ready.json` or `dead.json`.
- Is safe to re-run: within the 14-day retention every known key answers
  `PreviouslyAccepted` and starts nothing. Past it, the marker skip still prevents repeated
  work. Parcels with neither marker (invalid, failed, still queued) are sent again.
- Keeps an existing scope rule (the ramp may have raised it). `--cap <n>` sets it; above 18
  it also needs `--benchmarked`.
- Refuses a server without VQueues, and warns when the in-process capture gate would bind.
- Writes `data/runs/<county>/<jobId>/enqueue.json` (seed, sha256, scope, counts). Reconcile
  reads the seed from it when `--seed` is omitted.

## Ramp policy

`npm run ramp` samples every 3 minutes and appends to `data/runs/<county>/<jobId>/ramp.jsonl`:

- A sample is **clean** when non-captured < 1%, multi-attempt < 5%, there are no challenge
  pages and no paused invocations. With a capture plug-in that writes
  `capture-receipt.json` (`outcome`, `attempts[]`), the receipts are the base. Otherwise
  new `dead.json` count as non-captured and `backing-off` Parcel invocations as
  multi-attempt.
- **Two consecutive clean samples raise the cap one level: 6 → 12 → 18.**
- **One unclean sample steps it down one level and holds** (no further raises). A sample
  with no completions changes nothing.
- Never above the last level (default 18). `--levels 6,12,18,24 --benchmarked` only after
  a measured benchmark of that source (`use-oracle/reference/source-access.md` §5).
- Set the cap by hand with `npm run scope-cap -- --scope <scope> --cap <n>`; the ramp follows
  a hand-set cap and holds.

Cobb went 6 → 12 at +6 min and 12 → 18 at +12 min, then held at 18 with clean samples.

## Permits (after the appraisal queue drains)

```bash
npm run enqueue:permits -- --county <county> --job full-<YYYYMMDD>
```

One `PermitHarvest.harvestParcel` per eligible ready parcel, key
`<county>-<jobId>-permits-<parcel_id>`, scope per permit source: `<county>-permits-<adapter>`
(`PERMIT_SCOPE_<COUNTY>_<ADAPTER>` overrides; `…-unrouted` for parcels no jurisdiction
matches). New permit scopes start at `SCOPE_CAP_<SCOPE>` or 2. It refuses to start while the
county's appraisal scope still has queued, running, suspended or paused parcels (`--force`
overrides), rebuilds the eligible index with the current policy fingerprint, and skips
parcels whose permit `status/<parcelKey>.json` is terminal (no transient failures). Run the
identity prerequisites in `../SKILL.md` first, exactly as for `PermitFeed`.

## Watch, hand off, wrap up

`npm run status` prints the queue per scope (`sys_vqueue_meta`: queued, running,
suspended, paused, finished), caps in use, stuck invocations, file counts, the rate over the
last 15 minutes (`--minutes`), the ETA, and the hand-off block. Give the person that block in
every status report and every hand-off:

- the Restate UI: `http://127.0.0.1:<RESTATE_ADMIN_PORT>/ui` (default 9070);
- the tunnel to open it from another machine:
  `ssh -N -L <port>:127.0.0.1:<port> <user>@<host>`;
- the parcels-left query:

  ```sql
  SELECT num_inbox AS queued, num_running AS running, num_suspended AS suspended,
         num_paused AS paused, num_finished AS done,
         num_inbox + num_running + num_suspended + num_paused AS parcels_left
  FROM sys_vqueue_meta WHERE service_name = 'Parcel' AND scope = '<scope>';
  ```

- the Console Pipeline tab (shared view, refreshed hourly):
  <https://soofi-safavi.account.prismteam.ai/console/app/?app=meet-backfill-progress&tab.data-mining-tabs=data-mining-pipeline-table#/data-mining>.

The appraisal pass is done when parcels left is 0. Then run
`npm run reconcile -- --county <county> --job <jobId> --strict` (the seed comes from
`enqueue.json`), start permits, and wrap up per `../SKILL.md` §8.

## Capacity and server notes

- 232k queued invocations ≈ 72 MB on disk (about 310 B each). Restate RSS rose to about
  1.8 GB with about 210k queued on Cobb. Finished invocations cost about 5.9 KB each until
  their retention expires.
- One scope lives on one partition. That is fine at a few parcels per second.
- Flow control in Restate 1.7 is experimental and caps concurrency only: no rate limit.
- `GET /limits/rules` answers 405. Read rules with `SELECT * FROM sys_rules` and usage with
  `sys_user_limits`. `PUT /limits/rules` upserts only the patterns it names.
- Restate 1.7.2 crashed once with a worker-thread stack overflow on an admin SQL query;
  `RUST_MIN_STACK=16777216` stopped it, and 1.7.9 lists no fix, so keep it set.
- A restart of the services process re-attempts only the in-flight parcels (from their
  journals); a Restate restart keeps the queue, the rule and the cap.

## When to use chunk mode instead

Use `CountyIngest` chunk mode (`../SKILL.md` §3) only when the server cannot run VQueues
(an older Restate, or an existing volume you may not migrate), or when the operator asks
for it. Never run both paths for one job at the same time: they share the artifact paths
and the ledger, and the source sees both loads.
