# County archive publication (CAR) and Atlas registration

The publication unit is **one Content Addressable aRchive per county per data group**.
The appraisal transform's output directory yields the `county` archive; the permit
pipeline's yields `property_improvement`; HOA, corporate registry, and places each yield
their own. Each archive holds every lexicon block the CLI hashed for that group, rooted at
a county index block. A finished county is a set of such archives, each registered as one
group entry on the county's page in Atlas. This reference is the exact command sequence,
the facts it relies on, the registration flow, and the evidence to keep. The archive
commands were verified against real Duval, Pinellas, and Putnam output and against both a
local kubo daemon and Filebase.

## The seed data group rides inside every archive

Every property directory in a group's output carries **that group's data-group root plus
the seed data-group root**. The seed root is the property's identity: `hash` derives the
property CID from it, so the same property resolves to the same CID in every group's
archive. Seed is never hashed, uploaded, or registered as a group of its own; it rides
inside each archive.

## Command sequence, once per data group

Inputs: `<group-dir>`, a directory whose children are property outputs for one data group,
one `.zip` or one subdirectory per property, each containing the seed data-group root and
that group's data-group root. Children whose names start with `.` or `__` are skipped;
duplicate names abort the run. Repeat the whole sequence for every group the county has.

```bash
county=lee; group=county   # then property_improvement, hoa, corporate_registry, places ...

# 1. Every property validates against the lexicon. Fix transforms until this is clean.
elephant-cli validate ./$group-outputs --output-csv $county-$group-errors.csv

# 2. Hash every property and pack every JSON block into this group's archive.
elephant-cli hash ./$group-outputs \
  --output-zip ./$county-$group-hashed \
  --output-csv $county-$group-hash.csv \
  --output-car $county-$group.car
#    prints: CAR written: lee-county.car (<blocks> blocks, root <index cid>)

# 3. Prove the archive: integrity, root, index, graph, lexicon, orphans.
elephant-cli validate $county-$group.car --output-csv $county-$group-car-errors.csv

# 4. Derive the per-class tables from the validated archive.
elephant-cli export-tables $county-$group.car --output ./$county-$group-tables \
  --part-size 1g --output-json $county-$group-tables-export.json
#    prints: Tables written: ./lee-county-tables (<n> tables, <n> parts, root <tables cid>)

# 5a. Development and validation: a local kubo daemon (API 127.0.0.1:5001,
#     gateway 127.0.0.1:8080). Registrable only if it stays online and publicly
#     reachable until the Atlas merge.
elephant-cli upload $county-$group.car --output-json $county-$group-upload.json
elephant-cli upload ./$county-$group-tables --output-json $county-$group-tables-upload.json

# 5b. Worked example for registration: a pinning provider, here Filebase over Kubo RPC.
export FILEBASE_ACCESS_KEY=... FILEBASE_SECRET_KEY=... FILEBASE_BUCKET=...
elephant-cli upload $county-$group.car --api https://rpc.filebase.io --output-json $county-$group-upload.json
elephant-cli upload ./$county-$group-tables --api https://rpc.filebase.io --output-json $county-$group-tables-upload.json
```

`upload <county>-<group>.car` succeeds only after the node reports the same root the archive
declares and the gateway serves the root block with bytes that hash to its CID. Keep the
upload summary (api, root, blocks, gateway URL, timestamp) with the run.

`upload <tables-dir>` adds every part to the node, requires the node's CID for each part to
equal the one recorded in the tables index, imports `tables.car`, reads the tables root back
from the gateway, and writes the same summary shape (api, tables root, county root, parts,
gateway URL). It takes the same `--api` and token options as the CAR upload.

At review and at merge the archive and tables roots must be retrievable from the IPFS
network by root CID. Upload to any IPFS pinning provider, or to a node that stays online
and publicly reachable until the Atlas merge; Atlas fetches the archive by its root from
public gateways and copies it onto the org account on merge. Filebase through
`--api https://rpc.filebase.io` is the worked example because `upload` already targets it.
A local kubo behind NAT that goes offline before the merge cannot be registered.

## What each archive looks like

- **Root**: one dag-json `CountyIndex` block: `label`, `version: 1`, `properties` (count),
  `shards` (links). A consumer walks root → shard → property → data group.
- **Shards**: at most 5000 properties each, so every block stays far below the 1 MiB block
  limit at any county size. Each entry holds `property_cid` and a `data_groups` map from
  data-group schema CID to data-group root CID: the seed group and this archive's group.
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
  archive root, the part-size cap, and per-table row counts.
- **Deterministic**: the same archive in yields byte-identical parts and the same tables
  root out. A different tables root for the same archive root means the input changed.

## Register in Atlas

The registry is [`elephant-xyz/atlas`](https://github.com/elephant-xyz/atlas) (private
today). It holds **one JSON page per county** at `counties/<STATE>/<county>.json`:

```json
{
  "county": "lee",
  "state": "FL",
  "fips": "12071",
  "groups": {
    "county": {
      "cid": "<CountyIndex root printed by hash>",
      "schema": "<data-group schema CID for this group>",
      "tables": "<CountyTables root printed by export-tables>"
    },
    "property_improvement": { "cid": "…", "schema": "…", "tables": "…" }
  }
}
```

A group entry holds exactly three CIDs: `cid` is the archive root printed by `hash`,
`tables` the root printed by `export-tables`, `schema` the data-group schema CID for that
group (the `dataGroupCid` column in `<county>-<group>-hash.csv` for that group's rows, or
the manifest entry for the group label). Withdraw a group by removing its key; supersede a
group by changing its CIDs. The page carries no history, no evidence, and no counts.

There is no entry generator in the CLI yet: write the page by hand from the three printed
values and the hash CSV. A generator is the planned replacement for this step.

### Open the pull request

One PR per publication, touching exactly that county's page:

```bash
git clone git@github.com:elephant-xyz/atlas.git && cd atlas
git checkout -b publish/fl-lee
mkdir -p counties/FL && $EDITOR counties/FL/lee.json   # add or update the group entries
git add counties/FL/lee.json
git commit -m "Publish FL lee county"
git push -u origin publish/fl-lee
gh pr create --base main --title "Publish FL lee county" \
  --body "Archive root, tables root, and schema CID for the county group; uploads served by <gateway origin>."
gh pr checks --watch
```

Branch name is `publish/<state>-<county>`; title is `Publish <STATE> <county> <group>` (list
every group the PR adds or changes). A PR that touches more than one file, or another
county's page, is rejected.

### What `validate` checks

The `validate` check on the PR fails closed. It verifies:

- the page matches the schema and every CID is unique across the whole registry
- the archive root fetches from a gateway, and so do shard 0 and one property CID
- the `schema` CID appears in the archive's own data-group map
- the `tables` root points back at the archive root, and one table part is served

Fix a red check by re-uploading or correcting the page, then push to the same branch.

### Who merges, and what publish does

A code owner merges: one of `movsiienko`, `sean-cedar`, `samandun`, `mrndacreative`. Ask
in the PR; do not self-merge. On merge the publish workflow:

1. transfers the archive and the tables from wherever they were uploaded into the org's
   Filebase account by gateway export and import
2. regenerates `index.json` on `main`
3. repoints the IPNS name `elephant-atlas`
   (`k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04`) at it

If a root cannot be fetched at merge time, the merge is **reverted automatically and an
issue is opened**. Treat that as "the archive was not available": re-upload to a node
whose gateway serves the root, confirm the readback, and open a new PR.

Consumers read `https://ipfs.filebase.io/ipns/k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04`
or `index.json` on `main`.

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
- **Validation is offline.** `validate <county>-<group>.car` resolves every link from inside
  the archive; a missing block is an error, never a network fetch.
- **Atlas fetches by root CID from public gateways.** An archive pinned on a provider is
  retrievable in full by its root from every major public gateway and from a cold IPFS
  node within seconds; both the `validate` check and the merge-time transfer rely on
  that. Upload to any IPFS pinning provider, or to a node that stays online and publicly
  reachable until the Atlas merge; Atlas copies the archive onto the org account on
  merge. Filebase through `--api https://rpc.filebase.io` is the worked example because
  `upload` already targets it. A local kubo behind NAT that goes offline before the merge
  cannot be registered.

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
- `gh` authenticated against an account with write access to `elephant-xyz/atlas`.
- Node 20+ for the CLI; the bundled runtime needs 22.18+.

## Evidence to keep per run, per group

- `<county>-<group>-errors.csv` empty of data rows, or the list of transform fixes that
  emptied it
- `<county>-<group>-hash.csv` and the printed `CAR written` line
- `<county>-<group>-car-errors.csv` empty, and the six per-check counts from the summary
- the archive upload summary, plus the gateway URL that served the root
- the printed `Tables written` line, the tables export summary, and the tables root
- the tables upload summary, plus the gateway URL that served the tables root
- the three Atlas page values (`cid`, `schema`, `tables`) for the group, the Atlas PR URL,
  the `validate` check state, and whether it merged (or the revert issue URL)
- the CLI commit and the manifest URL used

## Property-list runs

For a supplied list of properties across counties (for example the Open Door set): split the
list by county, build one `seed.csv` per county, run capture and transform for those rows
only, then steps 1 through 5 per county per group, and one Atlas PR per county. Each county
yields its own page; each group its own archive, root, and tables root. Do not merge
counties into one archive; the index is a county index.

## Known limits and out of scope

- The county index does not yet record the county key or the lexicon manifest CID. Record
  both in the run evidence until the CLI carries them.
- The Atlas page is written by hand until the CLI ships an entry generator.
- The existing query-table, coverage, per-county IPNS, and MCP publication keeps running as
  its skills describe; it is a separate path. Replacing it is out of scope.
- A raw IPFS node cannot discover inner blocks from the network. Consumers that need that
  must pin the archive on a node they control.
