---
name: use-oracle
description: "Operate Oracle county mining and Atlas publication, improve HOA name/fee/frequency accuracy against NetSuite-paid truth, or return one property's raw official response without transformation."
---

# Use Oracle

Drive the bundled ingestion runtime and the Elephant CLI. Keep ingestion,
reconciliation, and publication boundaries explicit.

## Elephant CLI 2 (experimental)

Before the first Elephant CLI command of a task, propose the experimental Elephant CLI 2
as described in [`../migrate-elephant-cli-v2/SKILL.md`](../migrate-elephant-cli-v2/SKILL.md):
one native binary, no Node or npm install, with `transform` and `prepare` built in. The
publication commands below are the same in both. From Elephant CLI 2 build `94db3af` on,
`hash` packs each data group of a property into one block; publish that layout, and read
"Packed and linked archives" in
[`reference/car-publication.md`](reference/car-publication.md) before the first packed
publication. Use it when the user accepts and 1.x when they decline. Hash, export, upload
and register one data group with one CLI: the data CIDs of a packed archive and the
tables root of `export-tables` differ between them. Neither CLI's `prepare` captures a
source behind a Cloudflare managed challenge (qPublic and similar); capture those with the
vendor recipe in [`reference/cookbooks/`](reference/cookbooks/README.md).

## Public boundary

Use exactly one public path:

```text
validate group
  → hash one CAR per county/data group
  → validate CAR
  → export normalized tables and Atlas page
  → upload CAR and tables with readback
  → Atlas county-page PR
  → merge
  → verify global Atlas IPNS
  → synchronize MCP 2.0 SQL
```

Do not publish run state, run manifests, working artifacts, per-county pointers,
coverage objects, overlays, or environment maps. Restate holds run state only; files
hold data; publication reads validated group directories. Atlas archives and
CLI-exported tables are the MCP/public source.

## Collection policy

[`reference/collection-policy.md`](./reference/collection-policy.md) is the single source
of truth for what Oracle collects, ignores, works around, escalates, and never takes, and
for the field rules (keep records as filed with their source URL; Vermont owner name and
mailing address blank; no Connecticut person profiles; protected addresses tagged for
takedown). It overrides any other access or terms rule in these references. We collect only
by scraping and never file a records request. Terms, login, and click-through gates follow
[`reference/access-escalation.md`](./reference/access-escalation.md).

## Read first

Read the collection policy above first, then:

1. [`reference/car-publication.md`](./reference/car-publication.md)
2. [`reference/readiness-and-completeness.md`](./reference/readiness-and-completeness.md)
3. [`reference/permit-evidence-preflight.md`](./reference/permit-evidence-preflight.md)
4. [`reference/roof-age-and-identity-reingest.md`](./reference/roof-age-and-identity-reingest.md)
5. [`reference/hoa-property-management.md`](./reference/hoa-property-management.md)
6. [`reference/hoa-web-ingestion.md`](./reference/hoa-web-ingestion.md)
7. [`reference/self-contained-ingestion.md`](./reference/self-contained-ingestion.md)
8. [`reference/raw-property-capture.md`](./reference/raw-property-capture.md)
9. [`reference/failure-modes.md`](./reference/failure-modes.md)
10. [`reference/durable-orchestration.md`](./reference/durable-orchestration.md)
11. [`reference/source-access.md`](./reference/source-access.md) and the vendor recipes in
    [`reference/cookbooks/`](./reference/cookbooks/README.md), before probing or sizing any
    source
12. [`reference/operating-in-vm.md`](./reference/operating-in-vm.md) when running on a
    cloud VM or runner
13. [`reference/pipeline-reporting.md`](./reference/pipeline-reporting.md) for the team's
    six pipeline stages, the Asana claim, and Console coverage reporting

## Choose the ingestion stack

Select one bundled runtime mode before capture:

- **Local:** Restate only (`skills/use-oracle/runtime/docker-compose.yml`) plus the
  services process (`npm run services`, `services/app.ts`) registered with
  `npm run register`; see `bootstrap-oracle-infra` and `runtime/services/README.md`.
  There is no SQL database.
- **AWS:** the bundled AWS batch/queue modules and the selected, verified AWS profile.

Do not require a sibling source checkout. Do not mix local Restate handlers with AWS
workers. Stack choice affects capture and run tracking only; publication always uses
the Atlas sequence above.

## Raw single-property response

When the user asks for the full/direct web output for one property and says not to
transform it, use
[`reference/raw-property-capture.md`](./reference/raw-property-capture.md). This is a
bounded diagnostic route, not an ingest or publication run.

- Resolve the address to one official county parcel/request identifier. Never guess.
- Require readiness PASS and an adapter that explicitly supports raw capture.
- Run `elephant-county capture-raw` with exactly one seed row and a temporary or
  gitignored scratch directory.
- Preserve and return the HTTP body byte-for-byte. Keep URL, timestamp, status,
  digest, and parcel-validation result in the separate receipt.
- Get around a bot check or CAPTCHA and log it (`reference/collection-policy.md`). Stop on
  content still challenged after the work-around, an unapproved acceptance gate,
  unsuccessful HTTP status, or parcel mismatch.
- Do not transform, reconcile, hash, export, register, or publish.

The command calls the selected county adapter directly and does not start local Restate
handlers or AWS workers. Identify the configured stack as usual, but do not mix either
orchestration path into this diagnostic.

## Ingest and reconcile

Run these stages in order:

1. **Intake and readiness:** `onboard-county`, `county-discovery`,
   `county-readiness-preflight`.
2. **Parcel backbone:** `county-seed-data`, `county-appraisal-onboarding`,
   `build-county-transform`.
3. **Official identity baseline:** corporate registry, then licensing authority. In
   Florida run `sunbiz-corporate-ingest`, then `dbpr-license-ingest`. Stamp each
   Sunbiz company with a GET of `search.sunbiz.org` by document number
   (`sunbiz:<documentNumber>:company`). Do not write
   `https://dos.fl.gov/sunbiz/other-services/data-downloads/` onto the company.
4. **Permits:** `county-permit-adapter`, `county-ingest-run`, then permit evidence
   preflight. When a permit prints a license number, use that license number, the
   person name, and the company name only as search keys for the official DBPR
   license-detail lookup. Persist company, person, and license from the DBPR
   record. If DBPR returns no match, write no contractor, person, or license. Do
   not persist a contractor copied from the permit. Do not wait for a statewide
   relationship extract before reading permits that already carry a license.
   Require that extract only for historical qualification when the permit has no
   license number. Map a DBPR match with `property_improvement_has_contractor`
   (`property_improvement` → `company`), `contractor_has_license`
   (`company` → `license`; `license_identifier` on class `license`), and
   `contractor_has_person` (`company` → `person`; `first_name` and `last_name`;
   no license field on the person). Relationship objects are only `from` and `to`.
   `source_http_request.url` on those records is the official DBPR license-detail
   URL, not the permit page and not the Sunbiz download page. If the live manifest
   lacks those edges or the license source fields, record the gap and do not
   substitute another edge.
5. **Reconciliation:** `county-ingest-run` §6. Run
   `npm run reconcile -- --county <slug> --job <jobId> --strict` from
   `skills/use-oracle/runtime`; it writes `data/runs/<county>/<jobId>/manifest.json`.
6. **Enrichment:** For HOA names, fees, and frequencies, run the playbook in
   `reference/hoa-web-ingestion.md`: freeze the cohort and gap fields, pilot
   8–12 rows, then pass 1 (exact-address search, open the top 2–4 ranked links,
   period query matrix only when no fee is found), offline adjudication, pass 2
   for gap rows only (unopened pass-1 links, address variants on host-targeted
   queries, Sunbiz ACTIVE exact base, validated association pages, neighbour
   listings for names only), re-adjudication, verification, and a new versioned
   output. Accept fees only from tier-2 exact-property pages (address, unit, and
   city or ZIP agree), keep raw receipts and every explicit tuple, keep master and
   sub-association fees separate, and keep CTMH/Sunbiz identity separate from web
   observations. Use the runtime's `hoa-web-*` rules, the adaptive limiter, and
   resumable checkpoints. Treat NetSuite `-unit_holding_hoa_dues_cost` as
   paid-cost truth; never use `actual_dip`. Require the full-cohort shadow run to
   improve both coverage and NetSuite error before publishing through Atlas. Run
   BBB, places, AVM, and roof age as applicable.

Preserve these run contracts:

- Key parcels by folio/request identifier, never a digits-only parcel normalization;
  no duplicate parcel keys.
- Record per-parcel status only through `CountyLedger` (`<county>-<jobId>`), the single
  writer; make every step idempotent with deterministic paths.
- Scope artifacts by county/job and assemble groups only from fail-closed ready
  markers whose hash covers the current validated output.
- Exclude tombstoned parcels (ready, then dead/invalid) from group directories.
- Require `seed = ready + dead + invalid` and zero ledger-vs-file mismatches.
- Preserve raw source payloads and valid unlinked permits with their reasons.
- Link permits to the targeted parcel evidence; never trust a portal's displayed related
  parcel without reconciliation.
- Emit company edges only as lexicon relationship files from official, versioned,
  temporally valid identity evidence.
- Preserve unresolved, ambiguous, and conflicting contacts as unlinked.
- Compute roof age from accepted lifecycle evidence and retain confidence/coverage
  caveats.
- Keep reputation and places separate from legal identity.
- Never stamp an HOA name, fee, or frequency from a search snippet or a
  same-community/different-property page. Never validate a name for a city-only
  community, a placeholder, a manager, or an out-of-area source.
- Never default a missing fee frequency to monthly. Preserve master and
  sub-association observations separately unless exact-property evidence proves
  both apply.
- Never publish HOA web enrichment without immutable raw receipts, the
  adjudicated regression set, and a full-cohort shadow run that improves
  coverage and NetSuite paid-HOA MAE/RMSE.

Run state never becomes the publication source. A strict reconcile gates completion and
its manifest provides diagnostics; CAR inputs remain validated group directories
assembled from verified ready parcels (`reconcile-county.mjs --assemble <group>`; each
archive keeps the group plus its Seed root, and `seed` is rejected as a group).

`PublishGroup` (workflow keyed `<county>-<group>-<jobId>`) may run validate → hash →
validate CAR → export-tables durably, then wait in phase `awaiting-approval`. Read
`status()` for the `groupDigest`, then call `approve({approvedBy, groupDigest})` (a
supplied digest must match) or `reject({reason})`; both are refused in any other phase.
Before approval, `export-tables --atlas-page` writes only a STAGED copy of the county
page (`status().atlasPage.staged`, under `data/publish/<county>/<jobId>/<group>/atlas/`);
the given Atlas checkout is untouched. After approval it uploads with readback, then
copies the staged page onto `atlasPage` — and fails if that checkout page changed after
export (rerun under a new key). It rejects group `seed`. It stops before the Atlas PR;
open the PR yourself as below. Today only the County group (or another
appraisal-transform group) is publishable this way: no Restate stage yet turns permit
artifacts into a `property_improvement` group, nor emits official identity edges.

```bash
curl localhost:8080/PublishGroup/<county>-<group>-<jobId>/run/send --json \
  '{"county":"<county>","jobId":"<jobId>","group":"<group>","groupDir":"groups/<county>/<jobId>/<group>",
    "atlasPage":"/abs/atlas/counties/<ST>/<county>.json","state":"<ST>","fips":"<fips>"}'
curl -X POST localhost:8080/PublishGroup/<county>-<group>-<jobId>/status
curl localhost:8080/PublishGroup/<county>-<group>-<jobId>/approve \
  --json '{"approvedBy":"<name>","groupDigest":"<from status>"}'
```

## Publish each data group

Repeat for `county`, `property_improvement`, `hoa`, `corporate_registry`, `places`, or
each other group actually produced.

```bash
elephant-cli validate <group-dir> --output-csv <group-errors.csv>

elephant-cli hash <group-dir> \
  --output-zip <hashed-dir> \
  --output-csv <hash.csv> \
  --output-car <county>-<group>.car

elephant-cli validate <county>-<group>.car \
  --output-csv <car-errors.csv>

elephant-cli export-tables <county>-<group>.car \
  --output <tables-dir> \
  --output-json <tables-export.json> \
  --atlas-page <atlas>/counties/<STATE>/<county>.json \
  --county <county> --state <STATE> --fips <fips>

elephant-cli upload <county>-<group>.car \
  --output-json <archive-upload.json>

elephant-cli upload <tables-dir> \
  --output-json <tables-upload.json>
```

Read `<group-dir>` from `data/groups/<county>/<jobId>/<group>/` and write the hashed zip,
`hash.csv`, CAR, tables, and upload JSON under `data/publish/<county>/<jobId>/<group>/`.

Use a public, durable IPFS node for a registrable run. Filebase Kubo RPC is the worked
example. A local node is acceptable only for development unless it remains publicly
reachable through Atlas merge. Require archive-root and tables-root readback before the
PR.

## Register and verify

1. Confirm only `counties/<STATE>/<county>.json` changed in the Atlas clone.
2. Open branch `publish/<state>-<county>`.
3. Create one PR per county, request review from the code owners, link it in the
   county's Asana story, and wait for `validate`.
4. One code-owner approval is enough; the miner merges once `validate` is green. Do not
   merge it yourself ([`pipeline-reporting.md`](./reference/pipeline-reporting.md)).
5. If automation reverts the merge, treat publication as failed, restore public
   availability, and open a new PR.
6. Resolve global Atlas IPNS
   `k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04`
   through the configured gateway order.
7. Verify the accepted index CID and county/group entries reflect the merge.
8. Run MCP 2.0 `sync` (`npx -y @elephant-xyz/mcp@2 sync`), then call
   `listAtlasCounties` and `getAtlasDatasetInfo` with explicit `state`, `county`, and
   `dataGroup`.

Do not report publication from a green PR alone. Require the merged global IPNS and the
synchronized MCP snapshot.

## CLI and credentials

- Use a CLI build that supports CAR validation, `export-tables --atlas-page`, and CAR
  upload. Record its version or commit.
- Require the live lexicon manifest and schema gateways during validation.
- Keep upload credentials outside Git and command output.
- Require authenticated `gh` access to Atlas only when opening the registration PR.
- Never invent credentials or run a live upload just to test documentation.

## Property-list and legacy runs

Split a supplied property list by county. Build one seed file per county and one CAR per
county/data group. Never combine counties in one archive.

Re-mine pre-lexicon records from source. Do not backfill missing provenance into legacy
rows.

## Completion report

Use the required report in `agents/oracle.md`. Include the run manifest and gate results
without exposing private rows or credentials, and include global Atlas IPNS plus MCP
sync evidence for every public claim.
