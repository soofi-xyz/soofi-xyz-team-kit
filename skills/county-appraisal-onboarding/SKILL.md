---
name: county-appraisal-onboarding
description: "Wire a new county's appraisal scraping into the pipeline - capture plug-in or browser flow, per-county prepare and transform config, Parcel concurrency, transform packages built from Counties-trasform-scripts, and appraisal-source throughput gates. Use when onboarding a county's property appraiser site, creating browser flows, or when prepare fails for a specific county."
metadata: {"author":"elephant-xyz"}
---
# County Appraisal Onboarding

Goal: one parcel of the new county completes `Parcel.process` end to end — capture →
transform → validate → ready marker → `CountyLedger` record → eligibility.

## Per-county configuration

The services process resolves each county from files and `.env` (copy `.env.example`;
`<COUNTY>` is the slug uppercased with every non-alphanumeric run replaced by `_`, so
`palm-beach` → `PALM_BEACH`). Restart the services process after a change. Full list:
`skills/use-oracle/runtime/services/README.md`.

| Setting | Effect |
|---|---|
| `src/counties/<county>/capture.mjs` or `CAPTURE_MODULE_<COUNTY>` | Custom capture plug-in exporting `capture(input, ctx)`: `input.parcelDir` already exists; `ctx` is `{signal, timeoutMs, parcelDir}` and `signal` aborts at `CAPTURE_TIMEOUT_MS[_<COUNTY>]` (default 10 min; the step then retries) — stop work and close the browser on abort. Writes the prepared ZIP to `input.dest` (store the request as `source_http_request` with base URL + `multiValueQueryString`, never a query string in the URL), returns `{status: "captured"}` or `{status: "dead", reason}`. Wins over prepare (qPublic and other challenge-protected sources). |
| `source_url` (or `url`) seed column, or `PREPARE_URL_TEMPLATE_<COUNTY>` | Source request for the seed ZIP `prepare` runs on; the template fills `{parcel_id}` and `{source_identifier}`, and a query string moves into `multiValueQueryString`. More seed columns: `method`, `multiValueQueryString`, `json`, `body`, `headers`, `content_type`. |
| `PREPARE_METHOD_<COUNTY>`, `PREPARE_JSON_TEMPLATE_<COUNTY>`, `PREPARE_BODY_TEMPLATE_<COUNTY>`, `PREPARE_CONTENT_TYPE_<COUNTY>` | POST sources: method, JSON or form body template (same placeholders), content type (`application/json` is implied for a JSON body). The whole request reaches every group, the merged Seed group included. |
| `PREPARE_BROWSER_FLOW_ZIP_<COUNTY>`, `PREPARE_MULTI_REQUEST_FLOW_<COUNTY>`, `PREPARE_BROWSER_FLOW_<COUNTY>` | Flow for `prepare`, in that precedence; otherwise `counties/<county>/flow.json` or `flows/<county>.json` (a `requests` array means multi-request). |
| `PREPARE_USE_BROWSER_<COUNTY>`, `PREPARE_CONTINUE_BUTTON_<COUNTY>`, `PREPARE_IGNORE_CAPTCHA_<COUNTY>`, `PREPARE_PROXY_<COUNTY>` | `prepare` flags. The proxy URL may carry credentials; it is passed through, never logged. |
| `TRANSFORM_ZIP_<COUNTY>` | Handler package; default `counties/<county>/transform-v2.zip`, then `transforms/<county>/transform-v2.zip`. |
| `TRANSFORM_SCRIPTS_DIR_<COUNTY>` | Scripts directory when no package exists; default `counties/<county>/transforms`, then `transforms/<county>/scripts`. |
| `TRANSFORM_DATA_GROUP_<COUNTY>` | Data-group label passed to the transform. |
| `TRANSFORM_SEED_<COUNTY>=off` | Disable merging the CLI seed-mode output when the county transform emits no Seed root. Leave it on unless the transform emits Seed itself: `hash` needs Seed in every property. |
| `COUNTY_NAME_<COUNTY>` | Display name when the title-cased slug is wrong. |
| `CONCURRENCY_PREPARE[_<COUNTY>]`, `CONCURRENCY_TRANSFORM[_<COUNTY>]` | In-process caps (§2). |
| `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES[_<COUNTY>]` | Permit eligibility (§4). |
| `PARCEL_INACTIVITY_TIMEOUT_MS`, `PARCEL_ABORT_TIMEOUT_MS` | `Parcel` step timeouts (defaults 15 and 45 minutes). |

`CountyIngest` fails terminally before dispatch when the county has no transform or no
capture route (plug-in, flow, `source_url` column, or URL template).

## 1. Browser flow

Prepare runs `elephant-cli prepare` against the appraiser site. If plain fetch works the
flow may not need a browser; most counties need a Browser Flow v2 JSON.

Propose the experimental Elephant CLI 2 for this
([`migrate-elephant-cli-v2`](../migrate-elephant-cli-v2/SKILL.md)). Its `prepare` is
built into one binary: plain requests, multi-request flows and the Orange County fetcher
need nothing else, and browser flows start the obscura browser instead of a bundled
Chromium. What differs for flows: only `{{=it.<name>}}` is filled, the flow is passed as
`--browser-flow-file` (`--browser-flow-parameters` is gone), a Browser Flow v2 handler
gets a listed part of Puppeteer's `page`, and there is no headed mode. Use 1.x when the
user declines or a flow needs what Elephant CLI 2 leaves out.

**Challenge-protected appraisers (Cloudflare managed challenge, e.g. qPublic): `prepare`
does not work yet, in either CLI.** The challenge's first response is HTTP 403 and
`prepare --use-browser` throws on it before the challenge can clear (`--ignore-captcha`
does not skip that check); Elephant CLI 2's obscura browser never clears the challenge at
all. Check [`cookbooks/`](../use-oracle/reference/cookbooks/README.md) for the vendor:
capture with the recipe's runner (approved browser profile, session rule, readiness
condition from [`source-access.md`](../use-oracle/reference/source-access.md)) into the
capture layout `transform` expects, and use the CLI from `transform` on. Report the gap on
`elephant-xyz/elephant-cli` rather than patching around it per county.

1. Per-county flows live in `skills/use-oracle/runtime/counties/<county>/flow.json` or
   `skills/use-oracle/runtime/flows/<county>.json` (or the `PREPARE_*_<COUNTY>` paths).
   Check for an existing one; otherwise use another county's flow as a template.
2. Author the flow: navigate → fill the parcel search input (selector from discovery) →
   submit → capture detail page(s) and any media/cost-card subpages. Capture as much of
   the site's data as possible — images and secondary tabs included; the Lee run's explicit
   requirement was "extract as much data as possible".
3. Test locally against 3+ parcels of different property types:

```bash
npx elephant-cli prepare <parcel-or-url> \
  --browser-flow flows/<County>.json --browser-flow-parameters '{"parcel_id":"..."}'
```

4. Set the per-county prepare settings from the table above (read by
   `services/lib/county-config.ts`).

## 1b. Plain-HTTP counties (native fetcher) — NOT every county needs a browser flow

If the appraiser exposes a plain-HTTP JSON API (probe for this FIRST — Palm Beach and Orange
are examples), skip the browser flow. Set `PREPARE_USE_BROWSER_<COUNTY>=false`. There
are two plain-HTTP mechanisms, and they interact:

1. **Native county-specific fetcher** — hardcoded fetch logic in `@elephant-xyz/cli`
   (`src/lib/county-specific-prepare/<county>.ts`, e.g. `orange.ts`), auto-triggered by
   `county_jurisdiction`. Use this when the fetch needs logic a static flow can't express:
   response chaining (resolve a canonical id, then fetch by it), id normalization
   (e.g. zero-pad a stripped-leading-zero parcel id to the API's width), or retry-on-empty
   (APIs that intermittently return `[]` for a valid id). Changes here are a
   `@elephant-xyz/cli` PR + a pin bump in `skills/use-oracle/runtime`. The CLI is SHARED across
   counties: before bumping the pin, prove the dependency delta is scoped to the intended
   county's fetcher, and after bumping, re-verify one parcel for each other onboarded
   county.
2. **Multi-request flow** — a static list of independent templated requests (templated on
   `{{=it.request_identifier}}`), kept as `counties/<county>/flow.json` or
   `PREPARE_MULTI_REQUEST_FLOW_<COUNTY>`. Good
   for simple "fetch N endpoints by id" APIs.

⚠️ **A multi-request flow file OVERRIDES the native fetcher** (prepare precedence). If a
county already has a native `<county>.ts` fetcher, do NOT add a flow file — it silently
bypasses the native logic and produces a shape the transform cannot read. Pick one path.

## 2. Per-county concurrency

Each county's portal tolerance is tuned independently as a concurrency cap on the `Parcel`
service. Gates are per-stage: `CONCURRENCY_PREPARE`, `CONCURRENCY_TRANSFORM`,
`CONCURRENCY_PERMIT_<ADAPTER>`. Independent per-county tuning means county-scoped
env (e.g. `CONCURRENCY_PREPARE_LEE`, `CONCURRENCY_TRANSFORM_LEE`) when counties run
concurrently; the bare
`CONCURRENCY_PREPARE` applies when one county runs at a time. Caps are NOT tunable in the Restate UI
(server-side flow control is only a 1.7 preview behind experimental flags) — they are
enforced as in-process semaphores in the services process, with limits from env vars. To
change a cap, edit
`.env` and restart the services process — safe mid-run, because in-flight invocations
resume from their journals. Start low, then ramp while WATCHING error rates in the Web UI
(`http://localhost:9070`); the UI observes, it does not tune. Lee sustained 50+, but only
after burn-in. See `durable-workflow-builder` pattern 2 (the gate helper).

Before scaling beyond smoke tests, use the `county-discovery` source-feasibility estimate
or pilot timings from `county-ingest-run`. If the full appraisal download is estimated
above 48 hours, ask the operator whether to continue the scrape, ingest an official bulk
export or records extract as artifact files instead of scraping, or move this source to
runtime retrieval in an owning app.

## 3. Transform scripts (reuse first)

County transform scripts live in `github.com/elephant-xyz/Counties-trasform-scripts`
under `<county>/scripts/` (`data_extractor.js` + mapping modules). Sync them into the
runtime and prefer BUILDING the county's v2 handler package
`counties/<county>/transform-v2.zip` (root `handler.js`; see `build-county-transform`
for authoring and for wrapping legacy `data_extractor.js` modules), or point
`TRANSFORM_ZIP_<COUNTY>` at it. Without a package, the `Parcel` transform zips the
scripts directory (`counties/<county>/transforms`, `transforms/<county>/scripts`, or
`TRANSFORM_SCRIPTS_DIR_<COUNTY>`). The transform version is the package (or scripts)
digest plus the data-group and Seed settings, recorded in `transformed.meta.json`: a
changed package regenerates output from the stored capture and an unchanged one is
skipped. Re-package after every sync.

1. If the county folder EXISTS: do not trust it blindly. Run the `build-county-transform`
   skill against fresh prepare captures covering data variability. Fix gaps before scaling.
2. If it does NOT exist: author a transform v2 handler package — use the
   `build-county-transform` skill — then validate the same way. New or changed scripts must
   be committed on a branch and PR'd to `Counties-trasform-scripts` (`gh pr create`) —
   never left only in your local `transforms/` copy.
3. The transform must emit `data/property.json` with `property_usage_type`; the
   post-transform permit-eligibility step reads it.

   ⚠️ **Unmapped DOR use-code → warn + flag per record, NEVER throw-abort the parcel.**
   County DOR/usage codes map to lexicon enum values; a code the mapping doesn't know
   must **emit a per-record warning and flag the field** (preserve the raw code in
   `source_payload`), and let the rest of the parcel transform through. A transform that
   `throw`s `Unknown enum value` on an unmapped code **aborts the WHOLE parcel** — and
   because one code often covers a whole class (e.g. a single condo use-code), a throw
   silently dropped **entire condo complexes** from the county. Collect the warned/unmapped
   codes from a validation run and add the missing mappings before scaling; the run must
   never abort a parcel over one code. (This is the skip-and-warn rule the transform
   handlers must follow — see `build-county-transform`.)
4. ⚠️ **The runtime copy of the transform can be STALE vs `Counties-trasform-scripts` main — there is
   no auto-sync.** Sync it (`git pull` in `Counties-trasform-scripts`, copy/link into
   the runtime) before every run — the old pipeline shipped stale copies more than once,
   silently running old (possibly broken) extraction logic while repo-main worked. When in
   doubt, compare `sha256sum` of the runtime `data_extractor.js` against the
   repo copy — a line count can match while content differs.

## 4. Usage-type eligibility

Collect the county's usage-type labels (from transform output, not from the portal UI) and
decide the eligible set for property-first permit harvest. The services process is SHARED
across counties, so resolution is county-scoped first:
`PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_<COUNTY>` (uppercase county), falling back to
the bare `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES` ONLY for explicitly single-county
operation — changing the bare variable mid-redrive leaks into every concurrent county.
The value is a CSV of eligible transformed `property_usage_type` values, with two
sentinels: `__ALL__` makes every parcel eligible (full permit coverage); `__NONE__` makes
it an appraisal-only run (no permit harvesting). **Unset means `__NONE__`**: no portal
traffic on a guessed policy, but also no permits. Set it explicitly for every county so
the run harvests what you intend.

Eligibility is computed **from the transformed output, not the seed row** — the usage
type only exists after transform (`data/property.json` →
`property_usage_type`). Concretely, the `Parcel` service's eligibility step reads the
transformed artifact and persists `{eligible, usageType, policyFingerprint}`, which is
why it runs post-transform and why
`eligibility.json` appears alongside the transform outputs in the smoke test.

## 5. Smoke test

Run ONE parcel through the `Parcel` service via the Restate ingress. Use `send` (not
`call`): `Parcel.process` includes capture + transform and can run long (400-file
parcels), so a synchronous `call` would sit blocked on the curl.

```bash
curl localhost:8080/Parcel/process/send --json '{"county":"<county>","jobId":"smoke-1","parcel_id":"..."}'
```

Note the invocation id from the response, then check completion in the Web UI
(`localhost:9070`) or block until done with
`curl localhost:8080/restate/invocation/<id>/attach` before walking the artifact
checklist below.

Verify in order: `capture.zip` → `transformed.zip` + `transformed.meta.json` (Seed
merged when the county transform emits none) → validation pass (`validate-findings.csv`)
→ `ready.json` (with `dataGroups`) → `eligibility.json` under
`data/artifacts/appraisal/<county>/smoke-1/<parcelKey>/` (`ls` or `find`; `<parcelKey>` is
the parcel id or its filesystem-safe form). A `dead.json`, `invalid.json`, or
`failed.json` instead carries the reason. Then check the parcel's ledger record
(`parcel.status: "ready"`):

```bash
curl localhost:8080/CountyLedger/<county>-smoke-1/get --json '{"parcel_id":"..."}'
```

Debug via the invocation journal in the Web UI (`localhost:9070`) and the services
process logs.

## Local repair loop

Iterate on flows and transforms directly with elephant-cli before touching the service:
`elephant-cli prepare` on the parcel, then `elephant-cli transform --transform-version 2`
on the captured zip (see `build-county-transform` for the full loop). Only re-run
`Parcel.process` once the local loop passes. With Elephant CLI 2 both commands come from
one binary and need no Node, so the loop also runs in CI or a container as it is.

## Deploying a fix

Edit the code; in dev the services process restarts automatically (`npm run dev` runs
`node --watch services/app.ts`), and `npm run register -- --force` is fine while
iterating. During a live run there is
no "new deployment version" to hide behind — the pipeline is a single services process on
one endpoint — so freeze the code. If a fix is unavoidable and replay-compatible (no
journaled steps added/removed/reordered), apply it in place and
`npm run register -- --force`;
otherwise cancel the affected invocations and re-run them as a redrive pass on the new
code — see `durable-workflow-builder` authoring rule 2.

## Gotchas

- Heavy parcels (400+ files) can exhaust file descriptors — `@elephant-xyz/cli` fans out
  `fs.promises` reads with unbounded `Promise.all`, and macOS's default fd soft-limit is
  256; raise it (`ulimit -n 4096`) in the shell that runs the services process
  (`graceful-fs` cannot patch `fs.promises`). For heavy counties, also semaphore-wrap the
  `fs.promises` fan-out (~128 in-flight) in the fetcher/CLI usage — at prepare
  concurrency ~50 with 400-file parcels, even 4096 fds can exhaust.
- Egress: some county portals refuse datacenter/hosting IPs at TCP level even from the US;
  classify the failure with
  [`source-access.md`](../use-oracle/reference/source-access.md#1-classify-what-you-see)
  (fast refusal vs challenge vs geo-block) before debugging the scrape. Proxy rotation is
  supported via `PROXY_FILE`/proxy config on the fetcher and was needed intermittently for
  Lee; WARP proxy mode and Mullvad setup are in
  [`operating-in-vm.md`](../use-oracle/reference/operating-in-vm.md).
- A killed first run of Elephant CLI 1.x on Linux can leave a truncated `/tmp/chromium`
  (`@sparticuz/chromium`); every later `prepare --use-browser` then fails with
  `Failed to launch the browser process`. Delete the file and rerun.
- A transform-script county-name mismatch can silently produce wrong-county labels in
  output (the "Columbia county" incident) — verify `county_jurisdiction` in transformed
  output equals the expected county.
- Parcel-id format mismatch = silent empty county: an appraiser API given a wrong-width id
  (e.g. a leading zero stripped by numeric storage) returns `[]` with no error, so the whole
  county comes back empty. Validate the seed `parcel_id` width/format up front and fail loud
  on a zero-result lookup — see `county-seed-data`.
