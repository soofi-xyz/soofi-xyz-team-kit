# Pipeline reporting (team data-mining process)

How a county moves through the team's data-mining pipeline, and how the Console sees each
stage. The Oracle agent's completion contract states the rules; this file holds the stage
table and the commands.

## Six stages per county

| # | Stage | Where the data is | Done when | Who |
|---|---|---|---|---|
| 1 | **Local** | The miner's machine only (`DATA_DIR`) | Readiness, mapping, ~25-parcel pilot, collect, convert, validate, CAR packed, tables exported | Oracle |
| 2 | **IPFS** | Filebase bucket `elephant-oracle-county-repair` | Archive root and tables root both read back through a public gateway | Oracle |
| 3 | **GitHub · Atlas** | Atlas PR touching only `counties/<STATE>/<county>.json` | PR merged with `validate` green | Oracle opens; the miner merges |
| 4 | **GitHub · IPNS** | Org `elephant-atlas` Filebase, `index.json`, global IPNS | The global IPNS index contains the county | Atlas publish job |
| 5 | **Persist · MCP** | Persist | Load finished in System flow `atlas-county-persist-load` | A Prism Team Member |
| 6 | **Persist · Metrics** | Persist | County metrics computed from the load | A Prism Team Member |

A county counts as **published only at stage 4**. A merged PR without the repointed IPNS is
stage 3.

- **Stage 2:** start the upload as soon as the CAR and tables validate; it needs no human
  go-ahead. Run one large upload at a time. When an upload or readback fails, retry at
  15, 30 and 60 minutes, then stop and report it. Never open the Atlas PR before both
  roots read back (`car-publication.md`).
- **Stage 3:** one county per PR. Request review from the code owners `movsiienko`,
  `samandun` and `mrndacreative`, and link the PR in the county's Asana story. One
  approval is enough; the miner merges once `validate` is green. Oracle never merges.
- **Stage 4:** the publish job copies both roots to `elephant-atlas`, rewrites
  `index.json` and repoints IPNS; a large county takes 50–100 minutes. A failed copy is
  retried hourly by the publish-retry job; an automatic revert is a failed publication.
- **Stage 5:** a Prism Team Member releases loads into `atlas-county-persist-load`, at most
  four at once. Oracle does not start loads.
- **Side lane:** HOA and Mortgage data go straight to Persist through `/persist/validate`
  and `/persist/ingest`. They never go to Filebase, IPFS or Atlas.

## Before mining

1. Take counties from Opendoor's 500-county schedule.
2. **Claim the county in Asana.** Search for the county. If someone has a story for it or
   has already mined it, stop and report who. Otherwise create or take the story and assign
   yourself (the miner). Without Asana access, ask the miner to claim it and wait.
3. **Publish-queue gate.** If any packed county is stuck in stages 2–4 (upload or readback
   failing after the 60-minute retry, an Atlas PR red or waiting, a publish job not
   repointing IPNS), start no new mining. Unblock it or report it first.
4. **Register the official parcel count** (below) and keep the coverage push installed
   (`bootstrap-oracle-infra`).

## Mine exit check and stops

Leave stage 1 only when the mined count is within 2% of the official parcel count, or the
cause of the gap is written down in the county findings. Stop and alert a Prism Team Member
when the data is only for sale, needs a purchase, form or records request, hits a lexicon
gap, or the count gap is unexplained or above 100% of the official count.

## How the Console sees progress

The Console's `county-coverage-persist` report (Pipeline tab) reads repository
`prismteam-ai/meet-backfill-progress-report`, directory `county-coverage/`. Its **Local**
column is mined ÷ official parcels.

- **While a run mines**, the exporter reports the Oracle run's validated count (parcels
  with `ready.json`, which is written only after validation passes) and the Pipeline
  stage reads **Mining (in progress)**
  (`prismteam-ai/meet-backfill-progress-report#153`, merged).
- **Every data group has its own Local count while a run mines.** The exporter also
  counts the validated parcels with at least one Sales history, Tax and Property
  improvement (permit) record, plus those records, so the Sales History, Tax and Permits
  rows climb beside County (`prismteam-ai/meet-backfill-progress-report#161`).
  - Permits come from two places: the transform's `property_improvement` records, and
    the permits the permit pass linked. The linked ones are read from
    `artifacts/permits/<county>/<jobId>/status/<parcel>.json`, and a permit number is
    counted only once.
  - Run the permit pass under the **same jobId** as the appraisal run, or its permits
    are left out of Local.
  - These counts are Local only. Opendoor delivery reads the Atlas index.
- **Once the County group is packed** (every gate passed, `.car` and
  `tables-export.json` under `publish/<county>/<jobId>/county/`), the finished
  `properties` count replaces it
  (`prismteam-ai/meet-backfill-progress-report#152`, merged).
- Only the county's own seed (`seeds/<county>.csv`) counts. Trial jobs (`pilot-`,
  `smoke-`, `sample-`, `test-`, `dev-`) never count, and a job with no run manifest yet
  counts only when named `full-<YYYYMMDD>` (`county-ingest-run` §3).

### Coverage push (every mining machine)

An hourly job runs `export_local_inputs.py --push`, which commits
`county-coverage/local-inputs/<machine-id>.json` to branch `county-coverage-inputs`. The
exporter reads Oracle runtime data dirs from `ORACLE_DATA_DIRS` (colon-separated) and
installs on an Oracle-only machine (no repair directory needed). It needs a Python with
`duckdb`; system Pythons on Arch, Debian 12+ and Homebrew refuse `pip install`, so use a
venv and pass it as `PYTHON`:

```bash
python3 -m venv ~/.local/share/county-coverage-venv
~/.local/share/county-coverage-venv/bin/pip install duckdb
# check prerequisites first, then install
gh api repos/prismteam-ai/meet-backfill-progress-report/contents/county-coverage/install-autopush.sh \
  -H 'Accept: application/vnd.github.raw' \
  | PYTHON=~/.local/share/county-coverage-venv/bin/python ORACLE_DATA_DIRS=<runtime>/data bash -s -- --dry-run
gh api repos/prismteam-ai/meet-backfill-progress-report/contents/county-coverage/install-autopush.sh \
  -H 'Accept: application/vnd.github.raw' \
  | PYTHON=~/.local/share/county-coverage-venv/bin/python ORACLE_DATA_DIRS=<runtime>/data bash
```

`<runtime>/data` is the absolute runtime `DATA_DIR`. If the installer refuses, fix what it
lists and run it again.

**Push by hand at milestones** (pilot passed, each finished chunk or each 10% of the seed
validated, appraisal drained, CAR packed, upload read back). Run the installed job once;
it refreshes its clone and pushes with the settings written at install:

```bash
bash ~/code/prismteam/county-coverage-autopush.sh   # beside COVERAGE_CLONE_DIR when that was set
```

**How long the Console takes.** A push reaches the Pipeline tab in two steps:

1. The **County coverage** GitHub workflow merges every machine's file with Atlas and
   uploads the build. Its hourly cron is unreliable, so after a milestone push run it by
   hand:
   `gh workflow run county-coverage.yml -R prismteam-ai/meet-backfill-progress-report`.
2. The Pipeline report (`county-coverage-persist`) refreshes hourly at :12 and takes about
   40 minutes.

So Local trails a push by about an hour. Report the Restate status and file counts as the
current numbers, and the Console as lagging until it catches up.

### Official parcel count

The Local column stays blank until the county has a row in
`county-coverage/parcel-counts.csv`. Once the canonical parcel count is fixed
(`county-seed-data`), open one PR in `prismteam-ai/meet-backfill-progress-report` that adds
the row (keep the state/county order), runs
`python3 county-coverage/persist_feed.py repin --as-of <UTC date>`, and passes
`python3 -m unittest discover -s county-coverage/tests`. State the source layer, the
counted key, and why it matches the seed. Example: PR
`prismteam-ai/meet-backfill-progress-report#151` (Cobb GA). Skip it when the row already
exists.

## In every status and required report

Name the county's Pipeline stage (1–6) and the Local % (mined ÷ official parcels), and
flag when the Console lags the Restate status or the file counts by more than about an
hour (`monitoring-county-ingestion`). Give it beside the Restate hand-off block from
`npm run status` (`county-ingest-run/reference/full-run-flow-control.md`): the Restate UI
link, the SSH tunnel, the parcels-left query and the Console Pipeline tab link.
