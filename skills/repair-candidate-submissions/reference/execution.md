# Execution runbook

Run this once per county, in the order set in [`scope-of-work.md`](./scope-of-work.md).
Every step writes into the county's working directory `repair/<state>-<county>/` (outside
this repo) and appends to its `ledger.json`. Stop at any failed gate and report.

## 0. Prerequisites

- `gh` authenticated with read access to `prismteam-ai` and write access to a branch of
  `elephant-xyz/atlas`.
- `elephant-cli` build that supports CAR validation, `export-tables --atlas-page`, single-file
  `car` upload, and CAR upload readback. Record its version.
- Filebase bucket for the county (`elephant-oracle-open-data-<county>`) and its keys in the
  environment, never in files.
- The dedicated IPFS gateway and token (`ATLAS_GATEWAYS`, `ATLAS_GATEWAY_TOKEN`) for bulk
  fetches. Use public gateways only for the two-gateway retrievability check.
- Node 22.18+ for the MCP; `deploy-open-data-mcp` for sync.

## 1. Inventory

```bash
county=chester-county-pa      # repo slug suffix
repo=prismteam-ai/oracle-property-intelligence-platform-pipeline-$county
mkdir -p repair/$county && cd repair/$county
gh pr list -R $repo --state all --limit 100 \
  --json number,title,state,author,headRepository,headRepositoryOwner,headRefName,url > prs.json
gh api repos/$repo/forks --jq '.[].full_name' > forks.txt
```

Also list `prismteam-ai/oracle-property-intelligence-platform-pipeline-completion` PRs whose
title or README names the county. Add each PR and each fork without a PR as one
`submissions[]` entry in `ledger.json`:
`{repo, pr, author, state, head, kind: "pr"|"fork"}`.

## 2. Harvest

For every submission, from its head ref:

- list changed files (`gh pr view <n> -R $repo --json files`) and fetch artifact manifests,
  run histories, CAR listings, and result docs (`gh api repos/<owner>/<repo>/contents/<path>?ref=<head>`);
- read the PR body for claimed counts, CIDs, IPNS names;
- write `artifacts[]` with `{submission, cid, name, size, digest, codec, kind, claimed_records}`.

Do not clone candidate repos with Git LFS pulls or run their code.

## 3. Fetch and verify

For each artifact: `curl -sI https://ipfs.filebase.io/ipfs/<cid>` (retrievability), then
the full download through the dedicated gateway, then size and digest against the
manifest. Mark `verified`, `mismatch`, or `lost`. `ipfs.io` and `dweb.link` answer 429 to
bulk checks; use them only for a spaced spot check. For `lost`, look for the same files
committed in the submission's Git tree (Brevard ships its Parquet there).

## 4. Classify and validate

```bash
elephant-cli validate ./inputs/<submission>/<group>-outputs --output-csv <submission>-<group>-errors.csv
elephant-cli validate ./inputs/<submission>/<group>.car     --output-csv <submission>-<group>-car-errors.csv
```

Classify each artifact (`lexicon-car`, `lexicon-zip`, `custom-with-provenance`,
`custom-no-provenance`, `unusable`). For custom tables, sample 50 rows and check every row
carries an official parcel id and a source request URL; one missing URL in the sample
classifies the table `custom-no-provenance` until a full scan proves otherwise.

Read the generator code behind every table before counting it. Rows from mock generators
(`Math.random`, fake seed ids such as `RE0001001`) or tagged synthetic are `unusable`.
Record each table's source licence.

## 5. Seed basis

Get the denominator from the official assessed roll (count from the county assessor or the
state roll file) and record its source URL and date. For each validated `county` input
count distinct official parcel ids. The basis is the highest count; ties go to the input
with fewer validation errors, then the later source fetch.

## 6. Convert custom inputs

For each `custom-with-provenance` table, write or reuse the county transform with
`build-county-transform`, feeding the candidate's source responses where they were captured
or re-fetching the exact recorded request when they were not. The output must validate and
carry the original request URL. Record converted row counts per input.

## 7. Combine per group

Apply [`candidate-archive-assembly.md`](../../use-oracle/reference/candidate-archive-assembly.md):

1. Re-seed every non-basis property onto the basis Seed by official parcel id.
2. Union every input's property outputs for the group into one directory.
3. Resolve overlaps per record by the assembly table; write `overlaps.csv`
   (`key, winner_submission, loser_submission, reason`).
4. Prove the union: every input row is either in the combined set or in `overlaps.csv` /
   `excluded.csv` with a reason. Zero unaccounted rows.

## 8. Fill gaps

Compute coverage against the acceptance denominators: parcels, permits per jurisdiction,
classes present. For each gap above the acceptance tolerance, open a re-mine slice through
`onboard-county` (`county-readiness-preflight` first), then return to step 7 with the new
output as another input.

## 9. Publish

Follow [`car-publication.md`](../../use-oracle/reference/car-publication.md) exactly, one group
at a time:

```bash
elephant-cli validate ./$county-$group-outputs --output-csv $county-$group-errors.csv
elephant-cli hash ./$county-$group-outputs --output-zip ./$county-$group-hashed \
  --output-csv $county-$group-hash.csv --output-car $county-$group.car
elephant-cli validate $county-$group.car --output-csv $county-$group-car-errors.csv
elephant-cli export-tables $county-$group.car --output ./$county-$group-tables \
  --part-size 1g --output-json $county-$group-tables-export.json \
  --atlas-page ./atlas/counties/$STATE/$name.json --county $name --state $STATE --fips $fips
elephant-cli upload $county-$group.car --api https://rpc.filebase.io --output-json $county-$group-upload.json
elephant-cli upload ./$county-$group-tables --api https://rpc.filebase.io --output-json $county-$group-tables-upload.json
```

Open the Atlas PR (`publish/<state>-<county>`, title `Publish <STATE> <county> <group>`).
Body: the table of contributing submissions (repo, PR, author, records contributed), Seed
basis and denominator, union and overlap counts, archive/tables/schema CIDs, readback URLs.
Ask a code owner to merge; do not self-merge. When the county already has an open
Oracle-built PR for the same group, supersede it with the combined archive and say so in
both PRs.

## 10. Verify in the MCP

After merge and a green `publish` run:

1. Resolve global Atlas IPNS; confirm the index lists the county with the new group CIDs.
2. Run the MCP sync (`deploy-open-data-mcp`) and record the accepted index CID.
3. `listAtlasCounties` → county and groups present.
4. `getAtlasDatasetInfo` per group → `source` CIDs equal the Atlas page; row counts equal the
   `export-tables` counts.
5. Run the county's acceptance queries from
   [`acceptance-criteria.md`](./acceptance-criteria.md) through `queryAtlas` and record each
   answer next to its target.
6. Ask the county's natural-language test questions through the `donphan` agent and record
   that each answer cites the Atlas `source`.

## 11. Close

Write the per-county report from `SKILL.md`, attach `ledger.json`, `overlaps.csv`,
`excluded.csv`, and the acceptance query results, and mark the county delivered only when
every gate in its acceptance table passes.
