---
name: repair-candidate-submissions
description: "Repair county data that candidates already mined in the prismteam-ai Oracle assignment repos and publish it through Atlas so the Elephant MCP serves it. Combines every submission for a county into one archive per data group for maximum coverage, and re-mines from source only the slices no submission can supply. Use when asked to publish, repair, rescue, or combine candidate county submissions, or to raise a county's coverage in the Elephant MCP from submitted work."
---

# Repair Candidate Submissions

Candidates in the `prismteam-ai/oracle-property-intelligence-platform-pipeline-<county>`
assignment repos mined real county data: parcels, permits, owners, sales, contractors,
coordinates. The repair job turns that work into Atlas publications so the Elephant MCP
serves it. **The goal is maximum coverage per county in the Elephant MCP**, built by
combining every usable submission, not by picking one winner.

Repair, do not re-scrape. Re-mine from source only for a slice that no submission can
supply in publishable form, and record why.

## Read first

1. [`reference/scope-of-work.md`](./reference/scope-of-work.md): counties, submissions,
   current Atlas state, and what each repair delivers.
2. [`reference/execution.md`](./reference/execution.md): the step-by-step runbook.
3. [`reference/acceptance-criteria.md`](./reference/acceptance-criteria.md): numeric gates
   per county and for the whole job.
4. [`../use-oracle/reference/candidate-archive-assembly.md`](../use-oracle/reference/candidate-archive-assembly.md):
   Seed basis, re-seeding, batch combination, and overlap rules.
5. [`../use-oracle/reference/car-publication.md`](../use-oracle/reference/car-publication.md):
   the only public publication path.

## Boundary

- **Public path:** lexicon archive → `validate` → `hash` → CAR `validate` →
  `export-tables --atlas-page` → upload with readback → one Atlas county-page PR → merge →
  global Atlas IPNS → MCP sync. Nothing else is published.
- **Read-only on candidate repos.** Never push, comment, approve, merge, or close a
  candidate PR. Submissions are evidence of hiring work; leave them as they are.
- **No private data.** Publish only what the lexicon allows. Do not publish candidate
  DuckDB files, Query DB exports, or raw captures.
- **Credentials stay out of Git and output.** Filebase keys, gateway tokens, and candidate
  node addresses that embed keys are never printed or committed.
- **Do not grade candidates.** Coverage and quality numbers here are for publication, not
  for hiring decisions; use `evaluate-candidate-*` skills for that.

## The repair loop (per county)

1. **Inventory.** List every submission for the county: all PRs in any state (closed PRs
   still carry data) on the county repo and on `...-pipeline-completion` when it targets the
   same county, plus forks with no PR. Record repo, PR, author, head ref.
2. **Harvest.** From each submission collect artifact manifests, CIDs, IPNS names, CARs,
   lexicon outputs, and claimed counts into the county's repair ledger
   (`repair/<state>-<county>/ledger.json` in the working directory, never in this repo).
3. **Fetch and verify.** Fetch each artifact by CID (see Gateways) and check bytes
   against the manifest size and digest. Unretrievable artifacts are `lost`; ask in the
   hiring channel for the candidate's CAR before re-mining.
4. **Classify** each artifact: `lexicon-car`, `lexicon-zip`, `custom-with-provenance`,
   `custom-no-provenance`, or `unusable` (see the assembly reference).
5. **Validate** every lexicon input with `elephant-cli validate` against the live lexicon
   manifest. Record pass/fail and error classes per input.
6. **Pick the Seed basis**: the `county` input with the most validated parcels against the
   official assessed-roll denominator.
7. **Convert** `custom-with-provenance` inputs to lexicon with `build-county-transform`,
   keyed to the official parcel id. Never convert `custom-no-provenance`.
8. **Combine** per data group: re-seed every input onto the basis Seed, union across
   submissions, one winner per record by the assembly rules. Every submission that adds a
   parcel, permit, jurisdiction, contractor, or class the others lack is used.
9. **Fill gaps.** Compare the combined coverage with the denominators in the acceptance
   criteria. Re-mine from source only the missing slices (a jurisdiction, a parcel range, a
   class), through the normal `onboard-county` stages, then combine again.
10. **Publish** each group through `car-publication.md`: `county` first, then
    `property_improvement`, then any other group, one PR per group when validate time
    requires it. List every contributing submission in the PR body.
11. **Verify in the MCP.** After merge, resolve global Atlas IPNS, run the MCP sync, and run
    the per-county acceptance queries. A county is delivered only when the MCP answers them.

## Multi-submission rules (summary)

- Union first, then resolve overlaps per record; never merge fields from two records.
- Official identifiers only for joins (parcel id, permit number + jurisdiction, license or
  registry id). Never join on address or name.
- Prefer, in order: passes validation, has a source request URL, later source fetch, more
  populated lexicon fields.
- Complementary coverage (another jurisdiction's permits, a class one submission skipped,
  parcels missing from the basis) is always kept.
- Record every overlap decision and every excluded record with its reason in the ledger.
- Exclude fabricated rows: anything a mock generator produced (`Math.random`, fake seed
  ids) and anything tagged synthetic (`provenance_tier='synthetic'`). Read the submission's
  code before trusting a count.
- Record the source licence for every group. A non-redistributable licence (for example
  CC BY-NC-SA with a consent clause) blocks that group until a written decision exists.

## Gateways

Public gateways (`ipfs.io`, `dweb.link`) rate-limit bulk fetches. Fetch candidate CIDs
through the dedicated gateway and `ipfs.filebase.io`. A CID no gateway serves is `lost`:
recover the bytes from the submission's Git copy when committed, else ask for the CAR.

## Required report (per county)

- Submissions found, harvested, retrievable, validated, used, and excluded, with reasons.
- Seed basis input and the denominator it was measured against.
- Per data group: contribution counts per submission, overlap decisions, final record and
  property counts, coverage % against the denominator, and re-mined slices.
- Archive root, tables root, schema CID, upload readback, Atlas PR URL, validate result,
  merge state.
- Global index CID after merge, MCP sync result, and each acceptance query with its answer.
- Remaining gaps, blocked inputs, and the next human action.
