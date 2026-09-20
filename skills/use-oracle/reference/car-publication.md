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

# 4a. Publish to a local kubo daemon (API 127.0.0.1:5001, gateway 127.0.0.1:8080).
elephant-cli upload county.car --output-json upload-summary.json

# 4b. Publish to Filebase through its Kubo RPC endpoint.
export FILEBASE_ACCESS_KEY=... FILEBASE_SECRET_KEY=... FILEBASE_BUCKET=...
elephant-cli upload county.car --api https://rpc.filebase.io --output-json upload-summary.json
```

`upload` succeeds only after the node reports the same root the archive declares and the
gateway serves the root block with bytes that hash to its CID. Keep `upload-summary.json`
(api, root, blocks, gateway URL, timestamp) with the run.

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
  `--output-car`, CAR upload, and CAR validation (PRs 244 through 248). Record the
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
- the CLI commit and the manifest URL used

## Property-list runs

For a supplied list of properties across counties (for example the Open Door set): split the
list by county, build one `seed.csv` per county, run capture and transform for those rows
only, then steps 1 through 4 per county. Each county yields its own archive and root. Do not
merge counties into one archive; the index is a county index.

## Known limits and out of scope

- The county index does not yet record the county key or the lexicon manifest CID. Record
  both in the run evidence until the CLI carries them.
- The existing query-table, coverage, IPNS, and MCP publication keeps running as its skills
  describe; the archive is an additional output today. Registry registration, replacing
  that path, and per-table Parquet indexes are separate stories. Hand back the root CID;
  do not improvise those steps.
- A raw IPFS node cannot discover inner blocks from the network. Consumers that need that
  must pin the archive on a node they control.
