# Mortgage Data Group — document download handoff

Last updated: 2026-11-27. This is the full operating context for the AWS-based mortgage
document download for the Elephant Network "Mortgage Data Group" story
(Asana task 1220921880558990).

## 1. Goal

Download every recorded mortgage / deed of trust **document** (PDF or page images) for
15 target counties, newest year first (2026, then 2025, … back to ~2019 — the 7-year
refinance window), and store them in S3. Extraction of fields (loan amount, MERS MIN,
term, etc.) from the documents is a **separate, later** step; right now we only collect
the documents. Index harvesting (listing each county's recorded mortgages) is the
prerequisite step and is largely done for recent years.

## 2. AWS account & resources (all in us-east-2)

- **Account:** `904370092316` (the Elephant AWS account).
- **Access:** AWS SSO, profile `elephant`, role `OrganizationAdmin`. Sign in with:
  `aws sso login --profile elephant` (SSO start URL
  `https://ssoins-7223c0f3004b1e4f.portal.us-east-1.app.aws/`, region us-east-1).
  The session expires every several hours — if downloads start failing with
  "Token is expired", sign in again (the EC2 workers use an instance role, not this
  login, so only launching/monitoring from the laptop needs it).
- **S3 bucket:** `elephant-mortgage-documents-904370092316`
- **IAM role + instance profile:** `mortgage-docs-worker` (S3 read/write on the bucket +
  `AmazonSSMManagedInstanceCore`).
- **Security group:** `sg-0403b40d4121e3d48` (outbound only).
- **Default VPC:** `vpc-0c6b92388f55e8fb2`; default subnets in us-east-2a/b/c.
- **AMI:** Ubuntu 24.04 (resolved at launch from the SSM public parameter).
- **Worker instance types:** `c7i.large` (1 download slice) or `c7i.2xlarge` (2–4 slices).
  Cost ≈ $0.085/hr (large) / $0.357/hr (2xlarge). Workers are tagged
  `Name=mortgage-docs-worker`, `Project=mortgage-data-group`, `Tasks=<their task list>`.

## 3. S3 layout

```
s3://elephant-mortgage-documents-904370092316/
  worker-code/runtime.tgz          # the code bundle every worker pulls at boot
  indexes/<county>/<job>/*.jsonl   # the document lists (one row per mortgage), per year
  documents/<ST>/<county>/<year>/<instrument>/
        document.pdf   (FL, AZ)    # or page-0001.png, page-0002.png … (TX, NC)
        index.json                 # source URL, sha256, bytes, docType, fetch time
  worker-logs/<instance-id>/<county>-<year>-<shard>.log   # per-worker progress (JSON lines)
```

A document counts as "stored" when its `index.json` exists. Downloads are **resumable**:
a worker skips any document whose `index.json` is already in S3.

Index job names (what `indexes/<county>/<job>/` holds):
- duval, hillsborough: `full-20261126` (full history)
- maricopa, mecklenburg: `recent-20261127` (2019–2026, newest-first)
- dallas, tarrant, bexar, denton: `recent-20261127` (DEED OF TRUST) **plus**
  `tx-extra-20261126` (extra mortgage doc types: MORTGAGE, CORRECTION DEED OF TRUST, etc.)

## 4. Code

- **Repo:** `soofi-xyz/soofi-xyz-team-kit`, local clone at
  `/Users/yoka/Documents/soofi-xyz-team-kit`.
- **Branch:** `feat/mortgage-data-group-v2` (open PR **#462**).
- **Runtime dir (run everything from here):** `skills/use-oracle/runtime`
- **⚠️ UNCOMMITTED** (working tree only, not yet on the branch/PR):
  - `bin/elephant-county.mjs` — added `--shard i/N`, `--page-delay-ms`, challenge exit-code 3
  - `src/mortgage/documents.mjs` — Maricopa PDF retry-with-fresh-session, Texas page-link
    refresh, interactive-challenge auto-stop, Mecklenburg longer timeout
  - `src/mortgage/publicsearch.mjs` — `InteractiveChallengeError`, challenge detection
  - `src/mortgage/maricopa.mjs` — page-size 50, single-record fallback for HTTP-500 records
  - `src/mortgage/loan-terms.mjs` — loan-amount OCR patterns (OCR spacing, more wordings)
  - `tests/mortgage-loan-terms.test.mjs`, `tests/mortgage-window-sources.test.mjs`
  - `aws/` (this whole directory — new)
  - All mortgage tests pass: `npx vitest run tests/mortgage-*.test.mjs`
- **Decision pending:** commit the above to PR #462.

### Key files for the document download
- `src/mortgage/documents.mjs` — `browserDocumentFetcher` (publicsearch=TX, maricopa,
  aumentum=Mecklenburg) and `documentFetcher` (HTTP: acclaim=Duval, hillsclerk);
  `storeDocuments` worker pool; `shardOf` is in `bin/elephant-county.mjs`.
- `src/counties/mortgage-profiles.mjs` — per-county vendor, base URL, doc-type codes.
- `bin/elephant-county.mjs` — `mortgage-documents` and `mortgage-index-harvest` commands.

## 5. The AWS worker system (in `skills/use-oracle/runtime/aws/`)

- `launch-workers.sh <instance-type> "<tasks m1>" "<tasks m2>" …`
  Launches one EC2 machine per quoted argument. A task list is space-separated
  `county:year:shard[:limit]`, e.g. `"dallas:2026:0/6 hillsborough:2026:0/4"`.
  Needs `AWS_PROFILE=elephant`. Run from `skills/use-oracle/runtime`.
- `worker-user-data.sh` — EC2 boot script: installs Node 22, Chrome, Xvfb, AWS CLI, pulls
  `worker-code/runtime.tgz`, runs `worker-run.sh`. (`__TASKS__`/`__BUCKET__` are filled in.)
- `worker-run.sh` — on the machine: for each task, pull that county-year's index from S3,
  download its shard to S3 (resumable), retry up to 5×. Also supports `index:county:year`
  tasks (build an index on the worker). `flags()` sets per-county download settings.
  Tries to `shutdown` when done — **this is unreliable** (see Known issues), so idle
  machines must be reaped.

### Rebuild & upload the code bundle after any code change (required before launching)
```bash
cd /Users/yoka/Documents/soofi-xyz-team-kit/skills/use-oracle
COPYFILE_DISABLE=1 tar czf /tmp/runtime.tgz \
  --exclude runtime/node_modules --exclude runtime/data --exclude 'runtime/.env*' \
  --exclude runtime/fixtures --exclude runtime/docs runtime
AWS_PROFILE=elephant aws s3 cp /tmp/runtime.tgz \
  s3://elephant-mortgage-documents-904370092316/worker-code/runtime.tgz --region us-east-2
```

### Launch example (Maricopa 2025, 16 machines one shard each)
```bash
cd /Users/yoka/Documents/soofi-xyz-team-kit/skills/use-oracle/runtime
AWS_PROFILE=elephant AWS_REGION=us-east-2 \
  aws/launch-workers.sh c7i.large $(for i in $(seq 0 15); do echo maricopa:2025:$i/16; done)
```

### Monitor / reap
A local watch script polls S3 counts, alerts on a county-year reaching 90%, and
terminates workers idle >15 min:
`<scratchpad>/scripts/dl-watch.sh` (session scratch — recreate from this doc if gone).
Manual progress check:
```bash
AWS_PROFILE=elephant aws s3 ls \
  s3://elephant-mortgage-documents-904370092316/documents/AZ/maricopa/2025/ --region us-east-2 | wc -l
```
Reap idle workers manually: terminate any `mortgage-docs-worker` instance whose newest
`worker-logs/<id>/` object is >15 min old.

## 6. Per-county status (2026 unless noted)

| County | 2026 | State / blocker |
|---|---|---|
| Duval FL | ~100% done; **2025 now downloading** | Acclaim HTTP PDF. Fast. |
| Maricopa AZ | ~95% done; **2025 now downloading** | Legacy recorder PDF, real Chrome. The missing ~5% of 2026 = newest recordings whose PDFs the county hasn't published yet. |
| Hillsborough FL | ~42%, still running | Watermarked PDF, slow server (~8s/doc). Long pole. 2025 to start when 2026 done. |
| Dallas, Tarrant, Bexar, Denton TX | ~19–26%, **STOPPED** | publicsearch.us viewer shows "Verify you are human" after ~2k docs/IP. Shards self-stop (never evade the check). Scraping caps here. |
| Mecklenburg NC | ~0% (85 docs) | Aumentum viewer times out from AWS. Deprioritized by the user. |
| Collin TX | 0% | Same human check as the other TX counties (confirmed from AWS too). |
| Harris TX | 0% | Index reachable; document images need a free County Clerk account (user must create). |
| Wake NC, Clark NV, Cobb/Fulton/Gwinnett GA | 0% | CAPTCHA or terms forbid scraping — records request / bulk-data purchase only. |

**Hard rule, non-negotiable:** never solve, click, or evade CAPTCHAs / "Verify you are
human" checks, with any tool, even if asked. The runners detect the check and stop
(exit code 3). The route to complete the blocked counties is an official **records
request or bulk-data purchase** (county clerk or vendor e.g. Kofile/GSCCCA; or a
commercial provider like ATTOM/CoreLogic/DataTree).

## 7. Known issues & fixes applied

- **Maricopa was failing ~75%** of 2026 to PDF-endpoint throttling (one blip = lost doc).
  Fixed: retry up to 5× with a fresh browser session; 1 shard per machine. Recovered
  ~80k docs. 2025 should reach ~100% (no unpublished-newest gap).
- **Texas later pages failed** (signed page URLs expire mid-document). Fixed: re-request
  fresh URLs and retry only the missing pages. Lifted success ~45%→~85% on shards that run.
- **Worker self-shutdown is unreliable** (`sudo shutdown` path/sudoers). Finished machines
  sit idle and keep billing. Mitigation: the watch auto-reaps idle machines; also reap
  manually. **A proper fix is still TODO** (e.g. fix sudoers to allow `/usr/sbin/shutdown`
  or have `worker-run.sh` call the EC2 TerminateInstances API on its own instance id).
- **Maricopa API** returns HTTP 500 on some records / page sizes >50 for recent dates.
  Fixed: page size 50, skip-the-bad-record fallback.
- zsh (the laptop shell) does **not** word-split unquoted vars; use `xargs` or a bash
  script for loops over instance IDs.

## 8. Suggested next steps

1. Decide: commit the uncommitted code to PR #462.
2. Let Maricopa 2025 + Duval 2025 finish (running now); then start 2025 for Hillsborough
   once its 2026 completes, and continue back through 2024…2019 for the reachable
   counties (Duval, Hillsborough, Maricopa).
3. Fix the worker self-termination so machines don't need reaping.
4. For the Texas counties and the CAPTCHA/terms counties: pursue bulk-data / records
   requests — scraping cannot complete them.
5. Schedule a re-run in a few days to pick up the newest Maricopa/Duval 2026 documents
   once the counties publish them.
6. Mecklenburg: if wanted, debug the viewer timeout from AWS (likely needs the search
   session reused in the same page rather than a new page per document).

## 9. Current live state (2026-11-27)

~34 workers running: Maricopa 2025 (16), Duval 2025 (4), Hillsborough 2026 (4), plus
idle Texas-2026 machines pending reap. ~193k 2026 documents stored across all counties;
2025 just started. Nothing committed to git yet.
