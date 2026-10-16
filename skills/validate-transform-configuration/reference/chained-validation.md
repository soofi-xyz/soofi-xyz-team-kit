# Chained validation (N mapping steps with a DEV Persist load and export)

`test quiq to interprose for sms` or `test sms end to end` (`validate`/`check` are the same) resolves the SMS chain of
`reference/chains.json`: real PROD Quiq lifecycle events (read-only) → staged to DEV → DEV forward mapping (graph CSV) →
DEV Persist load → bounded DEV Persist export of exactly this run's elements (Parquet graph tables plus hydrated message
bodies) → DEV projection to the target's SMS log → comparison with the source events. The chain catalog names each
step's mapping and default version (the forward mapping's latest version, the projection pinned to the version that
introduces the compared output); `<mapping-id>@x.y.z` pins one step, a bare `@x.y.z` the last transform step. Any chain is
data: `steps` of kind `source-events`, `transform`, `persist-load`, `persist-export` and `compare` (profiles may declare the
same shape as `validationChain`). The PROD source, its exact read method, the normalization rules, the quarantine reasons
and the sensitive fields live in `reference/chain-sources.json`.

Run it in this order, every step's canary first:

1. `resolve-transform-intent.py discover` (status `RESOLVED`, `kind: chain`), then `chain_runs.py plan --intent --day
   --dev-bucket` (the day: `source_events.py days` → `source_window.py data-days`, or the owner's most recent full UTC day).
2. Source: `source_events.py build --stage canary` (stops with `LOOKUP_ROWS_REQUIRED`; run the printed key-bounded read,
   then rerun with `--lookup-rows`), `stage_evidence_package.py manifest/upload` to the plan's `stagingPrefix`.
3. Forward and projection steps: `transform_runs.py spec-from-intent --mapping <step mapping> --bind <name>=<prefix>
   --run-id <plan runId> --output-root <plan outputRoot> --stage canary [--outputs <compared output>]`, `cards`, `start`,
   `capture`, `cost` (each step its own run directory and digest checks).
4. Persist: `chain_runs.py persist-card --forward-run-dir`, `persist-load --wait` (approval per digest or
   `devPersistWrites`), `persist-export` (rooted at the forward output's keys; scope check against the forward
   metadata), then stage the export package like step 2 and run the projection on it.
5. Compare: `source_events.py expect`, `compare_datasets.py source-baseline`.
6. `chain_runs.py gate` over every canary step (`PRE_APPROVED` only with the owner's pre-approval; otherwise ask, then
   `transform_runs.py approve-full`), repeat steps 2–5 with `--stage full` (`start --canary-gate`, `persist-load
   --canary-gate`), then `chain_runs.py summary`, `evaluate_run.py` (transform run directories as `sms=RUN`, the source
   build as `--canary-sample`, the expect baseline as `--prod-actuals`, the comparisons, the gate, `--chain-step` for each
   Persist record) and `build_run_package.py --chain-summary --chain-step`.

An unattended run states every decision up front, for example: `test quiq to interprose for sms; approve all DEV writes;
allow DEV Persist writes; use the most recent full UTC day with real data; if the canary passes, run the full day; stage
real phone numbers and message bodies to DEV; accept Transform product changes as out of scope; cost ceiling $10 per job`.
DEV Persist is shared: loaded elements remain as residue (no delete-by-id exists) and are reported with their counts.
