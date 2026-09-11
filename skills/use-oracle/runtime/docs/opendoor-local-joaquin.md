# OpenDoor Wave 1: local Joaquin handoff

This package captures, transforms, exports, and validates the selected Lake,
Clay, or Volusia OpenDoor rows entirely on the local filesystem. It has no
AWS, S3, database-load, Filebase, IPFS, catalog, or publication command.
Every handoff reports `loadedRows: 0`, `publishedRows: 0`, and all publication
flags as false.

The repository is public. Never add a real seed, capture, receipt, output, or
browser profile to Git.

## Install and private inputs

```sh
RUNTIME=/tmp/soofi-joaquin-handoff/skills/use-oracle/runtime
cd "$RUNTIME"
npm ci

mkdir -p "$RUNTIME/local-input" "$RUNTIME/local-output"
chmod 700 "$RUNTIME/local-input" "$RUNTIME/local-output"

# Copy these from the separately shared private location. Do not use oracle-node.
cp /path/from/private-handoff/lake.csv "$RUNTIME/local-input/lake.csv"
cp /path/from/private-handoff/clay.csv "$RUNTIME/local-input/clay.csv"
cp /path/from/private-handoff/volusia.csv "$RUNTIME/local-input/volusia.csv"
chmod 600 "$RUNTIME/local-input/"*.csv
```

Expected full seed counts are Lake 770, Clay 706, and Volusia 784. `full` mode
refuses any other count. `smoke` mode validates the complete supplied seed and
selects its first row.

Confirm the private files remain ignored:

```sh
git -C /tmp/soofi-joaquin-handoff status --short --ignored \
  skills/use-oracle/runtime/local-input \
  skills/use-oracle/runtime/local-output
```

Only `!!` ignored entries should appear. The committed
`fixtures/opendoor-local/synthetic-one-row.csv` is synthetic and is only for
offline planning/tests.

## Chromium

The runtime uses `puppeteer-core` and does not download a browser. It finds
Google Chrome/Chromium in common macOS and Linux locations. Otherwise pass:

```sh
--chromium "/absolute/path/to/Chromium"
```

Volusia automatically clicks the reviewed `#acceptDataDisclaimer` button and
then requests `/parcel/summary/?altkey={7-digit ALTKEY}`.

Clay uses only the reviewed qPublic detail parameters: `AppID=830`,
`LayerID=15008`, `PageTypeID=4`, `PageID=6754`, and the exact hyphenated parcel
ID as `KeyValue`. The runner detects Cloudflare, CAPTCHA, and access-denied
responses and stops that row without attempting to evade or solve them. If an
ordinary, authorized interactive visit establishes a reusable session, close
that browser and pass its dedicated local profile:

```sh
--user-data-dir "$RUNTIME/local-output/qpublic-browser-profile"
```

Do not automate a CAPTCHA, change egress to evade controls, or reuse a personal
default browser profile. If the reviewed source still blocks access, retain the
failure receipt and report `source_access_blocked`.

## Plan and one-row smokes

`plan` performs no browser or network access. Use the same browser/session
flags for `plan` and `run` because those settings are bound into the immutable
request digest.

```sh
cd "$RUNTIME"

npm run opendoor:local -- plan \
  --county lake \
  --seed "$RUNTIME/local-input/lake.csv" \
  --run-id lake-opendoor-smoke-20260911-v1 \
  --mode smoke

npm run opendoor:local -- run \
  --county lake \
  --seed "$RUNTIME/local-input/lake.csv" \
  --run-id lake-opendoor-smoke-20260911-v1 \
  --mode smoke \
  --output "$RUNTIME/local-output/lake-opendoor-smoke-20260911-v1"
```

Repeat with `clay`/`clay.csv` and `volusia`/`volusia.csv`, using unique run IDs
and output directories. Add `--user-data-dir` to both Clay commands when an
authorized dedicated profile is required.

A successful smoke ends with:

- `status: captured_transformed_exported_local`
- `selectedRows: 1`, `capturedRows: 1`, `failedRows: 0`
- `queryTable.validation.rows: 1`
- one distinct request identifier and property ID
- one exact OpenDoor identity match
- `loadedRows: 0`, `publishedRows: 0`

The validated final file is:

```text
local-output/<run-id>/query-table.parquet
```

Raw HTML, transform inputs/outputs, immutable receipts, the immutable request,
checkpoint, failure records, and final handoff remain under the same ignored
run directory.

## Full local runs

Run a county in full mode only after its one-row smoke has the successful
handoff above:

```sh
npm run opendoor:local -- run \
  --county lake \
  --seed "$RUNTIME/local-input/lake.csv" \
  --run-id lake-opendoor-full-20260911-v1 \
  --mode full \
  --output "$RUNTIME/local-output/lake-opendoor-full-20260911-v1"
```

Repeat for Clay and Volusia with their own seed, run ID, output directory, and
any reviewed session profile. A full run with any failed row does not create a
partial `query-table.parquet`; it emits a fail-closed handoff instead.

## Resume and immutability

Resume by rerunning the exact same command with the exact same seed, run ID,
mode, browser settings, and output directory. Valid receipts and artifacts are
revalidated and skipped. Terminal failures stay terminal for that immutable
request. To retry after correcting a source/session issue, use a new run ID and
new output directory.

The runner refuses conflicting request, receipt, failure, handoff, or existing
Parquet state. It uses three bounded attempts only for retryable browser errors,
with exponential backoff and jitter. CAPTCHA and contract failures receive no
automatic retry.

## Local verification

```sh
cd "$RUNTIME"
npm run test:opendoor-local
npm run opendoor:local:typecheck
npm run opendoor:local:lint
npm test
npm audit
python3 /tmp/soofi-joaquin-handoff/scripts/check-plugin-clean-room.py
```

No command in this handoff loads or publishes the resulting Parquet. Any later
load or publication is a separate, explicitly approved workflow.
