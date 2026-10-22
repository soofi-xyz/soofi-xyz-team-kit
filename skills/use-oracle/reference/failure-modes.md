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

## HOA web enrichment

See [`hoa-web-ingestion.md`](./hoa-web-ingestion.md) for the full playbook.

**Snippet ≠ evidence.** A search snippet can choose which link to open. It never
supplies a name or fee. Open the page and quote it.

**JavaScript-rendered fee section.** Zillow markdown usually lacks the HOA section;
realtor.com and redfin.com often list no fee. A full-content rescrape
(`onlyMainContent: false` plus `waitFor`) revealed nothing in 16 of 16 tests. Prefer
another host over a rescrape.

**Carousel cut removes the fee.** Cutting at every "Similar homes" mention removed
the HOA section from Compass pages. Cut only at short heading-like lines.

**Glued and split numbers.** `$376/moHOA Fees` needs a space before `HOA`. An amount
pattern without a required thousands group read `1350.0` as 135 and
`1029 Quarterly` as 9. Match four-digit amounts whole and re-read structured fields.

**Labels that look like fees.** `Association #2` read as $2; `Secondary Association
Fee` is not the primary fee; rental estimates, internet, pool, septic, CDD, taxes,
one-time/transfer/capital fees, a year read as an amount, and `Calculated Total
Monthly Association Fees: 0` are not HOA dues.

**Badge ≠ conflict.** A rounded monthly badge beside an annual structured fee is the
same fee (175 of 210 measured conflicts). A larger listing figure can be master plus
sub-association. A monthly figure about 3× another is a quarterly amount mislabelled
monthly. Adjudicate these patterns instead of reporting a conflict.

**IDX widget periods.** `HOA Fees $X/ann` is a monthly equivalent billed annually.
Convert at low confidence; never read it as $X per year.

**Wrong unit, building page.** A property was matched to pages for three different
units. A page listing three or more units is building-level. Require the unit, and
cap condo confidence when the page shows only the street address.

**City-only community.** A community that is only the city or a place name (Palm
Coast sections) validated "<City> Homeowners Association" for 117 rows before the
rule was added. Do not validate community-level names for such rows.

**Placeholder propagation.** One HOA name stamped across many unrelated communities
is a placeholder for every row whose own community it does not match.

**Out-of-area registration.** An ACTIVE Sunbiz name match registered outside the
property's ZIP3 and city may be a same-name association elsewhere. Keep it low; keep
several matches `not_unique`.

**Rate limit at the plan cap.** At 50 concurrent requests the provider's 500
requests/minute limit returns 429. Use the adaptive limiter and back off; do not
retry 429 in a tight loop.

**Duplicate runs and stale checkpoints.** A trial run twice in parallel doubles spend
and interleaves checkpoints. Hold an exclusive lock file. Bump the parser version
when logic changes so stale checkpoint rows are recomputed from cache.

## Credentials and environments

**Runtime secrets inject at process start.** Adding AWS or upload-node credentials does not
patch an already-running process (`environment: null` is proof). Start a new job/runner
after secret injection, or use the documented OIDC assume-role path. Never paste keys into
chat.

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

**Local capture ≠ Query DB load ≠ publication.** Completed artifacts on disk are not
reconciled. Loaded Query DB rows are internal and never become Donphan's source. Public
visibility requires validated CARs and CLI-exported tables, upload readback, an Atlas merge,
global Atlas IPNS, and MCP SQL synchronization.

**Staging storage ≠ Atlas.** AWS or local Parquet/JSON staging is private. Never configure
MCP to read it. At intake, verify upload-node credentials and Atlas repository access;
request missing access immediately. Move frozen CAR/table artifacts, not live checkpoints
or browser sessions, to the upload step.

**Never mutate a published snapshot.** Later loads produce new validated group output and a
new CAR/table root. Compare loaded and published watermarks continuously. Publish changes
through a replacement Atlas group entry; only the global Atlas workflow moves its IPNS.

**Unsupported access must not look like zero.** If a county/data group/table is absent from
the synchronized Atlas index, report it as unpublished. Do not represent it as an empty
dataset.

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

HOA web rows use the diagnostics in `hoa-web-ingestion.md` (`confirmed_match`,
`partial_match`, `source_conflict`, `insufficient_evidence`, `fetch_error`, and the
others listed there) rather than these county statuses.
