# Failure modes (ingest and enrichment)

Treat these as **modes**, not county names. Use them whenever a source, dashboard,
credential, or publication path fails the same way.

## Source contracts

**Advertised total is not harvestable inventory.** Listing pages can advertise thousands of
results while exposing a hard page cap (commonly about 15 pages). Walking empty extra pages
does not unlock the remainder. Never store the advertised total as `expected_count` unless
the catalog also records `listing_page_cap` and `cap_acknowledged: true`.

**Result cap without a partition.** Date-window or type search returns a full page and no
total, or a one-day window exceeds the vendor cap. Fail closed as `source_cap`. Do not mark
the window complete. Split by a **source-exposed** filter only. Guessed folio/address
partitions are not completeness.

**Item-level cap deferral.** One capped address or type must not pause the jurisdiction.
Record the item in a private ledger (hash, query index, cap/count, attempts, next retry).
Never count it terminal. Retry on a long cooldown with a hard attempt limit.

**Disappearing export.** CSV download times out, the export control vanishes, or the list
cannot prove pagination. Rebuild the session, fall back to a reconciled list only when
every page identity is stable, otherwise pause. Do not invent rows from a partial file.

**Missing visible link ≠ missing record.** Temporary Accela rows can contribute to a total
without a clickable permit number. Recover hidden stable identifiers (for example a
three-part RecordId) when the page exposes them. Reconcile totals from those IDs.

**Parser vs page.** If the grid shows N linked rows and the parser keeps fewer, inspect
identifier charset (spaces, punctuation) before treating the gap as source-missing.

**Session / control drift.** ASP.NET and similar portals lose date controls, replace the
result page with a detail view, or expire ViewState. Rebuild the browser session. Never
submit a query whose required controls are absent.

**Stalled worker vs healthy cooldown.** A live PID with an unchanged checkpoint is not proof
of health. A process sleeping until a durable `nextAttemptAt` after a classified source error
is healthy. Treat work as stale only after its heartbeat/lease deadline expires. Reacquire
atomically with a higher fencing token, an absent advisory lock, matching signatures, and a
remaining retry budget. Resume only pending work. Do not duplicate a valid writer.

**Watchdog.** Persist heartbeat, lease expiry, fencing token, advisory lock, checkpoint
signature, attempt budget, and `nextAttemptAt` in the durable run manifest. Resume the
identical command with no reset. Never use `--start-row` on a hash-backed pipeline. Exhausted
work becomes `FAILED_EXHAUSTED` with an owner and exact recovery action while independent
tracks continue.

**Vendor terms.** Login or a “public user” role is authentication, not permission to
automate. If terms prohibit harvesting, stop and file a records request
(`reference/request-routing.md`).

**CAPTCHA is a lease.** Never solve, OCR, or bypass CAPTCHA. Never persist cookies or
tokens. A human-completed challenge authorizes only that browser session. Reloading often
clears pager state; resume needs the original result session, not a fresh checkbox.

## Enrichment (BBB and similar directories)

**Official API vs public site.** The documented API needs a bearer token and approved use.
Public category pages are a different source (`bbb-public-browser` or equivalent). Do not
claim API coverage for a site scrape.

**Cloudflare vs operator laptop.** Plain HTTP from a cloud IP often gets 403. Run the
existing headless-browser harvester on approved **AWS-managed remote compute** with US
egress; never open or drive the browser on the operator's machine. The execution target can
be a job, container, or other approved AWS runner and does not need to be a VM. It is not
an official API and not a completeness proof.

**Do not operationalize anti-bot evasion** (navigator.webdriver spoofing, challenge
solvers). Wait/reload on a real browser session is the existing harvester contract; stop
if the challenge never clears.

**Category office ≠ county.** A Fort Lauderdale (or other bureau) category mixes in-county
and out-of-county addresses. Report in-county vs other separately. Do not set county
`expected_count` from the category advertisement.

**Trade sample ≠ all-category census.** A colleague harvest that finished “all BBB” in days
may have meant a small contractor set (for example roofing, HVAC, and solar only). All
leaf categories on a bureau index can be thousands of slugs and many days. Match the
declared scope.

**Skip lists.** When adding categories, skip profile URLs already harvested so later loads
dedupe instead of overwriting.

## Credentials and environments

**Runtime Secrets inject at process start.** Adding `AWS_*` or Filebase keys does not patch
an already-running process (`environment: null` is proof). Start a new AWS job/runner after
secret injection, or use the documented OIDC assume-role path. Never paste keys into chat.

**Child jobs do not inherit late secret changes.** Verify required secret names before
starting remote work. If one is missing, request it at intake and start a fresh job after it
is available rather than waiting for the harvest or publish stage to fail.

**AWS profile names are environment-specific.** Do not hardcode a developer profile in
skills. Use the verified selected profile. Remote AWS compute will not see the operator
laptop's `~/.aws`; use injected secrets or OIDC.

**Branch/worktree drift.** A remote job based on another branch, an old skill install, or a
temporary dirty worktree is a different runtime. Before dispatch, freeze repository
identity, branch, commit/tree digest, runtime image, and redacted configuration/registry/schema
digests in the run manifest. Reject mismatches instead of silently continuing.

## Load, dashboard, publication

**Local capture ≠ Neon load ≠ publication.** Completed JSONL on disk is not queryable.
Loaded Neon rows are not in Donphan until immutable artifacts are uploaded and read back.

**Staging S3 ≠ Filebase/IPNS.** AWS staging of Parquet/JSON is private. Public Donphan
needs Filebase upload, IPNS update, catalog/MCP maps, and remote hash/count readback.
There is no credential-free upload path. At intake, verify that the eventual publish runtime
has the Filebase secret, correct bucket, and IPNS ownership; request missing access
immediately. Move **frozen artifacts**, not live checkpoints or browser sessions, to that
runtime.

**Never mutate a published snapshot.** Later loads produce a **new** versioned prefix.
Compare loaded and published manifest watermarks continuously. Later loads automatically
enqueue a **new** versioned prefix; IPNS labels move only after CID and remote readback
verification.

**Unsupported access must not look like zero.** If the county is absent from the catalog,
Donphan zeros mean unsupported, not empty. Coverage-only BBB publication must keep
`propertyDatasetAvailable: false` and null property/permit table URLs until those tables
exist.

**Dashboard.** Do not rescan large tables per `/api/status`. Use durable rollups, a
reconnecting pool, query deadlines, and a last-good snapshot. `ERR_CONNECTION_REFUSED` is
often a missing port forward, not a dead writer.

**Lexicon gaps.** Do not invent required facts the source lacks (for example monthly tax
amount on an assessment roll). Document the gap; keep `county_complete` false.

**Denominators.** GIS feature count, unique folio count, and certified tax-roll count are
different populations. Geometry-less assessed units stay valid properties with null
geometry. Do not use the easiest geometry feed as the canonical census.

## Status vocabulary

Keep these distinct: `pilot`, `enumerating`, `running`, `cooling_down`, `paused`,
`source_cap`, `source_missing`, `checkpoint_stale`, `manual_captcha_required`,
`login_required`, `no_anonymous_search`, `custodian_only`, `software_transport`,
`captured_complete`, `loaded_complete`, `supported_partial`, `supported_full`.
