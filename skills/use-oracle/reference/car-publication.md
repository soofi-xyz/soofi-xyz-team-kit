# County archive publication (CAR)

The publication unit is one Content Addressable aRchive per county run. It holds every
lexicon block the CLI hashed, rooted at a county index block. This reference is the exact
command sequence, the facts it relies on, and the evidence to keep. Everything here was
verified against real Duval, Pinellas, and Putnam output and against both a local kubo
daemon and Filebase.

## Command sequence

Inputs: a directory whose children are property outputs, one `.zip` or one subdirectory per
property, each containing the seed data-group root and the county data-group root. Children
whose names start with `.` or `__` are skipped; duplicate names abort the run.

```bash
# 1. Every property validates against the lexicon. Fix transforms until this is clean.
elephant-cli validate ./county-outputs --output-csv county-errors.csv

# 2. Hash every property and pack every JSON block into one archive.
elephant-cli hash ./county-outputs \
  --output-zip ./county-hashed \
  --output-csv county-hash.csv \
  --output-car county.car
#    prints: CAR written: county.car (<blocks> blocks, root <index cid>)

# 3. Prove the archive: integrity, root, index, graph, lexicon, orphans.
elephant-cli validate county.car --output-csv car-errors.csv

# 4. Derive the per-class tables from the validated archive.
elephant-cli export-tables county.car --output ./county-tables \
  --part-size 1g --output-json tables-export.json
#    prints: Tables written: ./county-tables (<n> tables, <n> parts, root <tables cid>)

# 5a. Publish to a local kubo daemon (API 127.0.0.1:5001, gateway 127.0.0.1:8080).
elephant-cli upload county.car --output-json upload-summary.json
elephant-cli upload ./county-tables --output-json tables-summary.json

# 5b. Publish to Filebase through its Kubo RPC endpoint.
export FILEBASE_ACCESS_KEY=... FILEBASE_SECRET_KEY=... FILEBASE_BUCKET=...
elephant-cli upload county.car --api https://rpc.filebase.io --output-json upload-summary.json
elephant-cli upload ./county-tables --api https://rpc.filebase.io --output-json tables-summary.json
```

`upload county.car` succeeds only after the node reports the same root the archive declares
and the gateway serves the root block with bytes that hash to its CID. Keep
`upload-summary.json` (api, root, blocks, gateway URL, timestamp) with the run.

`upload <tables-dir>` adds every part to the node, requires the node's CID for each part to
equal the one recorded in the tables index, imports `tables.car`, reads the tables root back
from the gateway, and writes the same summary shape (api, tables root, county root, parts,
gateway URL) to `tables-summary.json`. It takes the same `--api` and token options as the
CAR upload.

## What the archive looks like

- **Root**: one dag-json `CountyIndex` block: `label`, `version: 1`, `properties` (count),
  `shards` (links). A consumer walks root → shard → property → data group.
- **Shards**: at most 5000 properties each, so every block stays far below the 1 MiB block
  limit at any county size. Each entry holds `property_cid` and a `data_groups` map from
  data-group schema CID to data-group root CID.
- **Blocks**: every property's JSON files as the CLI hashed them. Data records use the
  dag-json codec (`baguqeera…`); the lexicon's schema CIDs stay raw (`bafkrei…`). Same
  input yields byte-identical archives: blocks are written in property order, then CID order.
- **Not included**: HTML captures and images. They stay in the hashed ZIPs.

## What the tables directory looks like

`export-tables` reads a validated archive and writes the derived per-class index next to it.
The archive stays canonical; the tables are a convenience for consumers who want one class
at a time. **Only this command produces them.** Never hand-build, patch, or export a
per-class table from the query DB or from the hashed ZIPs.

- **One table per lexicon class present** (`<tables-dir>/property/part-00000.parquet`, ...),
  one per relationship type, and a `properties` table from the county index.
- **Parts**: each table is split into parts of at most the `--part-size` cap (1 GB by
  default). Consumers range-read parts over the gateway.
- **Columns**: the class schema at the manifest version the archive used, plus `cid`,
  `property_cid`, `data_group_cid`, and `request_identifier`. Nested values are JSON
  strings. The CLI owns this layout; do not restate or extend it elsewhere.
- **Tables root**: `<tables-dir>/tables.car` is a tiny archive whose single root is a
  `CountyTables` index block. It links every part by content identifier and records the
  county root, the part-size cap, and per-table row counts.
- **Deterministic**: the same archive in yields byte-identical parts and the same tables
  root out. A different tables root for the same county root means the input changed.

## Facts the design depends on

- **Kubo RPC `dag/import` is the one transport.** Filebase (`https://rpc.filebase.io`, bearer
  token = base64 of `ACCESS_KEY:SECRET_KEY:BUCKET`), a local kubo, and any other provider that
  speaks Kubo RPC accept the same call and return the same response. No S3 client is needed.
- **Roots are discoverable; children are reachable through them.** Filebase announces the
  root to the network and serves every inner block on its public gateway, by CID or by path
  from the root. A dedicated Filebase gateway answers bare-CID requests only for the object's
  root; use paths from the root there. Public third-party gateways and raw IPFS nodes cannot
  find inner blocks by bare CID because the provider does not announce them. Consumers start
  from the root.
- **One request fetches a whole subtree.** `GET <gateway>/ipfs/<root>?format=car` returns the
  index, every shard, and every property block beneath, verifiable offline with
  `ipfs dag import`. A property's own data-group root fetched the same way returns just that
  property.
- **Billing follows object bytes, not block count.** A CAR import is one object and one pin.
  The per-file cost that broke the earlier Pinata setup does not apply.
- **Validation is offline.** `validate <county>.car` resolves every link from inside the
  archive; a missing block is an error, never a network fetch.

## CLI requirements

- Install the Elephant CLI from GitHub `main`: `npm i github:elephant-xyz/elephant-cli#main`
  (or run it with `npx --package=github:elephant-xyz/elephant-cli#main elephant-cli`).
  The npm release workflow is failing, so the registry package lacks batch input,
  `--output-car`, CAR upload, CAR validation (PRs 244 through 248), and `export-tables`. Record the
  installed commit in the run evidence.
- The CLI reads the lexicon manifest from `https://lexicon.elephant.xyz/api/manifest`
  (`ELEPHANT_SCHEMA_MANIFEST_URL` overrides) and fetches schemas from
  `https://ipfs.filebase.io` first, then Pinata's gateway, then the public gateways
  (`ELEPHANT_IPFS_GATEWAYS` overrides, comma-separated origins). The ipfs.io family
  rate-limits shared runners; a local kubo gateway in that list is the most robust option.
- Upload environment: `IPFS_API`, `IPFS_API_TOKEN`, `ELEPHANT_CAR_GATEWAY` (origin, no
  trailing slash), or the three `FILEBASE_*` variables. `--timeout` bounds the gateway
  readback, not the upload.
- Node 20+ for the CLI; the bundled runtime needs 22.18+.

## Evidence to keep per run

- `county-errors.csv` empty of data rows, or the list of transform fixes that emptied it
- `county-hash.csv` and the printed `CAR written` line
- `car-errors.csv` empty, and the six per-check counts from the summary
- `upload-summary.json`, plus the gateway URL that served the root
- the printed `Tables written` line, `tables-export.json`, and the tables root
- `tables-summary.json` from `upload <tables-dir>`, plus the gateway URL that served the
  tables root
- the CLI commit and the manifest URL used

## Property-list runs

For a supplied list of properties across counties (for example the Open Door set): split the
list by county, build one `seed.csv` per county, run capture and transform for those rows
only, then steps 1 through 5 per county. Each county yields its own archive, root, and
tables root. Do not merge counties into one archive; the index is a county index.

## Known limits and out of scope

- The county index does not yet record the county key or the lexicon manifest CID. Record
  both in the run evidence until the CLI carries them.
- The existing query-table, coverage, IPNS, and MCP publication keeps running as its skills
  describe; the archive and its tables are additional outputs today. Registry
  registration and replacing that path are separate stories. Hand back the root CID and
  the tables root; do not improvise those steps.
- A raw IPFS node cannot discover inner blocks from the network. Consumers that need that
  must pin the archive on a node they control.
