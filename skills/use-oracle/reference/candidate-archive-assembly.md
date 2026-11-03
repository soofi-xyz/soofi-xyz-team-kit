# Assemble a county from contributor archives

Use this when a county's data already exists as lexicon archives from several contributors
(candidate assignments, internal runs) and the goal is one Atlas page with the most coverage
per data group. It reuses validated work instead of re-mining. Publication still follows
[`car-publication.md`](./car-publication.md): one archive per data group, `export-tables`
writes the page, one PR, code-owner merge, global IPNS and MCP checks.

Worked example: Travis County, TX. `county` from one contributor (441,961 properties, 10
archives combined into one) and `property_improvement` from another (1,986,694 permits on
237,540 properties, 88 archives), re-seeded so every permit lands on its parcel.

Scripts live in [`../scripts/assembly/`](../scripts/assembly/). Each takes the Elephant CLI's
`node_modules` directory as an argument (for example
`/opt/homebrew/lib/node_modules/@elephant-xyz/cli/node_modules`) so it reads CARs with the same
libraries the CLI writes them with.

| Script | Purpose |
|---|---|
| `car-index.mjs` | `property_cid,request_identifier,parcel_identifier` for every property in an archive |
| `car-to-folders.mjs` | Unpack an archive into property folders that `elephant-cli hash` reproduces byte for byte |
| `reseed-group.mjs` | Unpack a data-group archive onto another archive's Seed records |
| `pin-car.mjs` | Pin a large archive on Filebase shard by shard, then pin the root |
| `pin-tables.mjs` | Add every Parquet part of a tables directory with the recorded CIDs |
| `pin-root-check.sh` | Pin a small root CAR and confirm the recursive pin with `pin/ls` |

## 1. Inventory every contributor, per data group

List every submission for the county (candidate PRs, their releases, internal runs, open Atlas
PRs). For each one record, per data group:

- whether it is lexicon output from `elephant-cli hash` (only these can be registered; Parquet
  or DuckDB exports need a transform first);
- archive count, property count and record counts per class (from each run's manifest or
  `export-tables` output);
- whether every archive passed `elephant-cli validate`;
- where the CARs are downloadable, with sizes and SHA-256.

Then compare class by class. For Travis the two `county` candidates differed like this:

| Class | Contributor A | Contributor B |
|---|---|---|
| geometry | 434,016 | 375,037 |
| sales_history | 1,702,536 | 423,983 |
| tax, lot | none | 441,939 / 441,602 |

Pick one source per data group. Mixing classes inside one group (A's sales plus B's tax) is
possible but means building a new merged archive and re-validating it; do it as a separate,
later publication.

## 2. Check whether the groups join

Atlas links data groups for a property only through `property_cid`, which is the CID of the
property's Seed record. Atlas `validate` checks each group's archive on its own and never
checks that two groups share properties, so mismatched Seeds pass silently and never join.

```bash
NM=/opt/homebrew/lib/node_modules/@elephant-xyz/cli/node_modules
node car-index.mjs county.car  "$NM" > county-index.csv
node car-index.mjs permits.car "$NM" > permits-index.csv
```

Compare overlap twice: by `property_cid`, then by `request_identifier`. Contributors usually
build the Seed differently (another source file URL, geo id versus property id in
`parcel_identifier`, latitude and longitude present or not), so `property_cid` overlap is
often zero while the source id matches every row. Travis: 0 shared property CIDs, all 16,217
and later all 237,540 permit properties matched on the TCAD property id.

## 3. Choose the base Seed and combine its archives

Use the Seed of the richest `county` group as the base. Atlas takes one archive per group, so
combine a sharded contributor into one archive first:

```bash
for c in county-b*.car; do node car-to-folders.mjs "$c" props "$NM" expected.csv; done
elephant-cli hash props --output-zip hashed --output-csv hash.csv --output-car county.car
```

Prove the combination: every `propertyCid,dataGroupCid,dataCid` row in `hash.csv` must equal
a row of `expected.csv`, with nothing missing and nothing extra (Travis: 883,922 of 883,922).
Since every data CID is unchanged, the combined archive carries the contributor's validation;
the new CountyIndex is checked again by Atlas `validate`.

## 4. Re-seed every other group onto the base

```bash
node car-index.mjs county.car "$NM" | tail -n +2 | awk -F, '{print $2","$1}' > seed-map.csv
ls permits-*.car | xargs -P 16 -n 1 sh -c \
  'b=$(basename "$0" .car); mkdir -p out/$b; node reseed-group.mjs "$0" out/$b "$NM" seed-map.csv props exp/$b.csv unmatched.txt'
```

`props` is the base archive unpacked by step 3. The script copies the base Seed tree and
writes the other group's records unchanged, so after hashing only `property_cid` and the
Seed change; every non-Seed data CID stays the contributor's. It skips and lists any id with
no match or a duplicate. Investigate any unmatched rows before going on (Travis: 0).

The other group keeps its own `property` record. Two groups holding different `property`
records for one property is normal; they join through `property_cid`.

## 5. Validate and hash in parallel

Validation is the slow step for folders and is per property, so shard it; hashing into one
archive is a single process. Run them at the same time over hard links of the same files:

```bash
mkdir -p all && for d in out/*; do cp -al "$d"/. all/ & done; wait
ls -d out/* | xargs -P 14 -n 1 sh -c 'elephant-cli validate "$0" --output-csv "$0.errors.csv"' &
elephant-cli hash all --output-zip hashed --output-csv hash.csv --output-car permits.car
wait
```

Require zero error rows. Then check `hash.csv` against `exp/*.csv` exactly as in step 3, and
check that every property CID of this group exists in the base archive's index. Do not export
tables or write the page until both checks pass.

## 6. Tables and the Atlas page

Run `export-tables --atlas-page` once per group against the same page file
(`counties/<ST>/<county>.json`, with `--fips`). Each run adds its group and keeps the others.
Open one PR for the page with every group, and close older PRs for that county that it
replaces.

## 7. Pin on the org account, one bucket per county

Pin with `elephant-cli upload --api https://rpc.filebase.io` on the org Filebase account, in
a bucket named `elephant-oracle-open-data-<county>` (IPFS network). Never upload into
`elephant-atlas`; the Atlas `publish` workflow owns it and imports merged roots there itself.
Pinning on the same account as `elephant-atlas` lets `publish` import the blocks; Filebase
does not serve a bucket's inner blocks to other accounts.

Keep credentials in a mode-600 file outside Git (`~/.config/elephant/filebase.env` with
`FILEBASE_ACCESS_KEY`, `FILEBASE_SECRET_KEY`, `FILEBASE_BUCKET`) and load them only for the
upload. In zsh, prompt for a secret with `read -rs "SK?Secret: "`; `read -p` is a bash form
and fails in zsh.

`elephant-cli upload` sends a whole CAR, or a whole Parquet part, as one request through
Node's `fetch`, which gives up when the server sends no response headers for 300 seconds.
Filebase answers only after it has processed the request, so a multi-gigabyte archive (and a
large part during a busy upload) fails with a bare `fetch failed`. Use it for small archives;
for a full county use the piecewise uploaders, which call `curl`:

```bash
set -a; . ~/.config/elephant/filebase.env; set +a
DONE_FILE=county.done node --max-old-space-size=24576 pin-car.mjs county.car "$NM" 6
node pin-tables.mjs county-tables "$NM" --parts-only 4
pin-root-check.sh county-tables/tables.car <tables root>     # after the archive is pinned
```

- `pin-car.mjs` imports each shard's subtree as its own CAR, then the root with
  `pin-roots=true`, requiring every import to report exactly the blocks sent. Import shards
  before the root: Filebase hung for more than 9 minutes on a root block whose links it did not
  hold yet. Travis: 89 shards, 11,327,260 blocks, about 12 minutes at 6 in parallel.
- The final pinned import makes Filebase walk the whole DAG; on 11 million blocks the
  connection dropped after 27 minutes while the pin still completed. Confirm with `pin/ls`
  (`pin-root-check.sh` does this) instead of trusting the import response.
- `pin-tables.mjs` adds every part with the CLI's exact parameters (`cid-version=1`,
  `raw-leaves=true`, `chunker=size-262144`) and requires the CID the tables index records.
  The `tables.car` root links to the county archive, so pin it only after the archive.
- Give Node a large heap for `pin-car.mjs`; with the default heap it ran out of memory after
  22 shards of a 4 GB archive.

## 8. Register, merge, verify

Follow [`car-publication.md`](./car-publication.md) from "Register in Atlas". Facts measured
while doing it:

- `validate` and `publish` fetch every archive through `ATLAS_GATEWAYS` first, then
  `ipfs.filebase.io` and `trustless-gateway.link`. Without a dedicated gateway in that secret,
  archives over a few megabytes time out after 20 minutes, and `publish` reverts a merge it
  cannot fetch. Set it before registering a full county.
- `elephant-cli validate` on a CAR runs at about 60 properties per second on an 18-core Mac;
  a 442,000-property archive takes about 2 hours locally and longer on a hosted runner.
- The `main` ruleset requires branches to be up to date, so approved PRs merge one at a time:
  update the branch, wait for `validate`, merge. A merge queue (`merge_group` trigger on
  `validate.yml`) removes the manual loop.
- `publish` runs with `concurrency: publish`, which keeps only one pending run. After merging
  several PRs close together, dispatch `publish` with `transfer_all: true`.
- After a re-run, the PR's check list keeps showing the failed run until the new attempt
  starts. Compare the run's attempt number before counting another failure.

## Shell pitfalls on macOS

- `xargs -I{}` with a long command fails with "command line cannot be assembled". Put the
  work in a small script and use `xargs -n 1 bash script.sh`.
- `elephant-cli validate` does not follow symbolic links. Use real directories or hard links.
- `ls` on a directory with hundreds of thousands of entries is slow. Count from the
  generator's or reseed's own summary instead.
- Stop a long pipeline on the first failure (`set -euo pipefail` and explicit count checks),
  so an empty archive never reaches `export-tables --atlas-page`.

## Evidence to keep

Per county: the contributor inventory and the class-by-class comparison, `expected.csv` and
`hash.csv` match counts for every combined or re-seeded archive, the unmatched list, the
join check, validation error counts, archive and tables roots, upload summaries, the Atlas PR,
the global index CID after merge and the MCP `getAtlasDatasetInfo` result per group.
