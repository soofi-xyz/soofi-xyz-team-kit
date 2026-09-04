---
name: county-appraisal-onboarding
description: "Wire a new county's appraisal scraping into the pipeline - browser flow JSON in skills/use-oracle/runtime/flows/, per-county prepare config and Parcel concurrency, transform scripts synced from Counties-trasform-scripts, and appraisal-source throughput gates. Use when onboarding a county's property appraiser site, creating browser flows, or when prepare fails for a specific county."
metadata: {"author":"elephant-xyz"}
---
# County Appraisal Onboarding

Goal: one parcel of the new county completes `Parcel.process` end to end — Prepare →
Transform → Validate → Store.

## 1. Browser flow

Prepare runs `elephant-cli prepare` against the appraiser site. If plain fetch works the
flow may not need a browser; most counties need a Browser Flow v2 JSON.

1. Per-county flows live in `skills/use-oracle/runtime/flows/<County>.json`. Check for an existing
   one; otherwise use another county's flow as a template.
2. Author the flow: navigate → fill the parcel search input (selector from discovery) →
   submit → capture detail page(s) and any media/cost-card subpages. Capture as much of
   the site's data as possible — images and secondary tabs included; the Lee run's explicit
   requirement was "extract as much data as possible".
3. Test locally against 3+ parcels of different property types:

```bash
npx elephant-cli prepare <parcel-or-url> \
  --browser-flow flows/<County>.json --browser-flow-parameters '{"parcel_id":"..."}'
```

4. Per-county prepare settings are plain config/env on the services process (read by
   `services/parcel.ts`): `PREPARE_USE_BROWSER_<County>`, the county's flow file path,
   continue-button selector, captcha flags. For every county-scoped env var in this
   skill (`..._<COUNTY>` — prepare flags, concurrency caps, eligibility lists), the
   `<COUNTY>` segment is the county slug uppercased with every non-alphanumeric run
   replaced by `_` (`palm-beach` → `PALM_BEACH`) — the same `envPart()` rule as
   `durable-workflow-builder` pattern 2.

## 1b. Plain-HTTP counties (native fetcher) — NOT every county needs a browser flow

If the appraiser exposes a plain-HTTP JSON API (probe for this FIRST — Palm Beach and Orange
are examples), skip the browser flow. Set `PREPARE_USE_BROWSER_<County>=false`. There
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
   `{{=it.request_identifier}}`), kept as a flow file in `skills/use-oracle/runtime/flows/`. Good
   for simple "fetch N endpoints by id" APIs.

⚠️ **A multi-request flow file OVERRIDES the native fetcher** (prepare precedence). If a
county already has a native `<county>.ts` fetcher, do NOT add a flow file — it silently
bypasses the native logic and produces a shape the transform cannot read. Pick one path.

## 2. Per-county concurrency

Each county's portal tolerance is tuned independently as a concurrency cap on the `Parcel`
service. Gates are per-stage: `CONCURRENCY_PREPARE`, `CONCURRENCY_TRANSFORM`,
`CONCURRENCY_PERMIT_<VENDOR>`. Independent per-county tuning means county-scoped gate
names/env (e.g. `CONCURRENCY_PREPARE_LEE`) when counties run concurrently; the bare
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
above 48 hours, ask the operator whether to continue the scrape, ingest records into
the query DB, or move this source to runtime retrieval in an owning app.

## 3. Transform scripts (reuse first)

County transform scripts live in `github.com/elephant-xyz/Counties-trasform-scripts`
under `<county>/scripts/` (`data_extractor.js` + mapping modules) and are synced into
`skills/use-oracle/runtime/transforms/<county>/`. The synced sources are then BUILT into the
county's v2 handler package `transforms/<county>/transform-v2.zip` (root `handler.js`;
see `transform-v2-builder` for authoring and for wrapping legacy `data_extractor.js`
modules), and the `Parcel` service's transform step resolves that package by county —
it does not run the loose scripts. Re-package after every sync: the package hash
recorded in `transformed.meta.json` is what triggers regeneration.

1. If the county folder EXISTS: do not trust it blindly. Run the `validate-county-transform`
   skill against fresh prepare captures covering data variability. Fix gaps before scaling.
2. If it does NOT exist: author a transform v2 handler package — use the
   `transform-v2-builder` skill — then validate the same way. New or changed scripts must
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
   handlers must follow — see `transform-v2-builder`.)
4. ⚠️ **`transforms/<county>/` can be STALE vs `Counties-trasform-scripts` main — there is
   no auto-sync.** Sync it (`git pull` in `Counties-trasform-scripts`, copy/link into
   `transforms/`) before every run — the old pipeline shipped stale copies more than once,
   silently running old (possibly broken) extraction logic while repo-main worked. When in
   doubt, compare `sha256sum transforms/<county>/scripts/data_extractor.js` against the
   repo copy — a line count can match while content differs.

## 4. Usage-type eligibility

Collect the county's usage-type labels (from transform output, not from the portal UI) and
decide the eligible set for property-first permit harvest. The services process is SHARED
across counties, so resolution is county-scoped first:
`PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES_<COUNTY>` (uppercase county), falling back to
the bare `PROPERTY_FIRST_PERMIT_ELIGIBLE_USAGE_TYPES` ONLY for explicitly single-county
operation — changing the bare variable mid-redrive leaks into every concurrent county.
Configure the env (CSV) on the services process; the
defaults are keyed to LEE vocabulary — a new county almost certainly needs an override.
The value is a CSV of eligible usage types, with two sentinels: `__ALL__` makes every
parcel eligible (full permit coverage); `__NONE__` makes it an appraisal-only run (no
permit harvesting). **Empty/unset silently falls back to the commercial default list —
always set it explicitly.**

Eligibility is computed **from the transformed output, not the seed row** — the usage
type only exists after transform (`data/property.json` →
`property_usage_type`). Concretely, the `Parcel` workflow's `writeEligibility` step reads
the transformed artifact and persists `{eligible, usageType, policyFingerprint}` (the
lib contract in `durable-workflow-builder`), which is why it runs post-transform and why
`eligibility.json` appears alongside the transform outputs in the smoke test.

## 5. Smoke test

Run ONE parcel through the `Parcel` service via the Restate ingress. Use `send` (not
`call`): `Parcel.process` includes capture + transform and can run long (400-file
parcels), so a synchronous `call` would sit blocked on the curl.

```bash
curl localhost:8080/restate/send/Parcel/process --json '{"county":"<county>","jobId":"smoke-1","parcel_id":"..."}'
```

Note the invocation id from the response, then check completion in the Web UI
(`localhost:9070`) or block until done with
`curl localhost:8080/restate/invocation/<id>/attach` before walking the artifact
checklist below.

Verify in order: `capture.zip` → `transformed.zip` → validation pass → DB row →
`eligibility.json` under `data/artifacts/appraisal/<county>/smoke-1/<folio>/` (`ls` or
`find`). Debug via the invocation journal in the Web UI (`localhost:9070`)
and the services process logs.

## Local repair loop

Iterate on flows and transforms directly with elephant-cli before touching the service:
`elephant-cli prepare` on the parcel, then `elephant-cli transform --transform-version 2`
on the captured zip (see `transform-v2-builder` for the full loop). Only re-run
`Parcel.process` once the local loop passes.

## Deploying a fix

Edit the code; in dev the services process restarts automatically (`npm run dev` runs tsx
watch), and `--force` re-registration is fine while iterating. During a live run there is
no "new deployment version" to hide behind — the pipeline is a single services process on
one endpoint — so freeze the code. If a fix is unavoidable and replay-compatible (no
journaled steps added/removed/reordered), apply it in place and `--force` re-register;
otherwise cancel the affected invocations and re-run them as a redrive pass on the new
code — see `durable-workflow-builder` authoring rule 2.

## Gotchas

- Heavy parcels (400+ files) can exhaust file descriptors — `@elephant-xyz/cli` fans out
  `fs.promises` reads with unbounded `Promise.all`, and macOS's default fd soft-limit is
  256; raise it (`ulimit -n 4096`) in the shell that runs the services process
  (`graceful-fs` cannot patch `fs.promises`). For heavy counties, also semaphore-wrap the
  `fs.promises` fan-out (~128 in-flight) in the fetcher/CLI usage — at prepare
  concurrency ~50 with 400-file parcels, even 4096 fds can exhaust.
- Geo-blocking: some county portals block datacenter IPs; proxy rotation is supported via
  `PROXY_FILE`/proxy config on the fetcher and was needed intermittently for Lee. Check
  `curl -s ipinfo.io/country` returns `US` before debugging any scrape failure.
- A transform-script county-name mismatch can silently produce wrong-county labels in
  output (the "Columbia county" incident) — verify `county_jurisdiction` in transformed
  output equals the expected county.
- Parcel-id format mismatch = silent empty county: an appraiser API given a wrong-width id
  (e.g. a leading zero stripped by numeric storage) returns `[]` with no error, so the whole
  county comes back empty. Validate the seed `parcel_id` width/format up front and fail loud
  on a zero-result lookup — see `county-seed-data`.
