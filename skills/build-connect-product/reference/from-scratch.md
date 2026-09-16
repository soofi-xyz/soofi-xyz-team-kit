# Build Connect ingestion in a new repository

Use this guide to create the product code in the user's target repository.
No runnable worker, bootstrap generator or deployable stack is bundled in this
skill. Keep the shared engineering, Lexicon, batch and requested consumer skills;
do not copy them into the product specification.

## 1. Start with minimal external facts

Use this initial request:

> Use Lapras to implement Connect ingestion here. Follow its contracts and
> Stage-derived acceptance cases. Keep shared skills. Build and verify the local
> extraction/delta/checkpoint flow first, then prepare the AWS implementation
> using the supplied environment and source registration.

Read the session/target instructions and existing code first. Ask only for
unavailable source schemas/keys/policies, approved secret/network/storage scope,
account/region, consumer identity and authorized limits. Use the synthetic local
example while external facts are missing. Never contact its example JDBC endpoint
or secret. Keep implementation defaults below unless the target's verified
contracts require a documented alternative.

## 2. Toolchain and target modules

Use Python 3.11, Java 17, PySpark 3.5.4 and Glue 5.0 for the first baseline;
use Iceberg 1.7.1 for snapshot SQL verification. This matches the principal
reference jobs and the [AWS Glue 5.0 runtime](https://docs.aws.amazon.com/glue/latest/dg/migrating-version-50.html).
Pin and verify compatible JDBC/Iceberg JARs. Do not assume a helper unit test
emulates Glue, private JDBC networking or Iceberg commits.

Use Node 22.18+ within 22.x or Node 24, TypeScript ESM, CDK v2, AWS SDK v3,
Powertools, AJV 2020 + formats, Vitest, tsx, ESLint, Prettier and esbuild for the
control plane. Use Pytest, Ruff, basedpyright and Draft 2020-12 jsonschema for the
Python data path. Pin resolved versions in lock files and verify a clean install.
Keep an existing Python orchestration deployment compatible during a separately
planned migration; do not silently replace public handlers.

Create the following in the target repository, in order:

| Step / target module | Implement | Exit check |
| --- | --- | --- |
| 1. `schemas/ingestion.schema.json`, `src/contracts.ts` | Named boundary validators/types, artifact digests and semantic policy validation | Supplied examples validate in TS/Python; bad registrations fail |
| 2. `src/store.ts`, `src/state.ts` | Local/S3 artifact storage, immutable writes, DynamoDB lease/fencing/generation adapter and a faithful local state adapter | Competing owners, stale fences, replay and incomplete generations are tested |
| 3. `src/registry.ts`, `src/plan.ts` | Exact source resolution, projection union, dependency closure, checkpoint compatibility, admission and immutable plans | Explicit same-release inputs and no silent first-run/full-scan fallback |
| 4. `glue_scripts/connect_worker.py`, `glue_scripts/readers.py` | Shared local/Glue entry point; PostgreSQL JDBC plus fixture reader, normalization, schema/scope checks and materialization | Typed full baseline with no credentials in local mode |
| 5. `glue_scripts/delta.py`, `glue_scripts/hydration.py` | Hash/index comparison, direct/bridge links, one-hop expansion, bounded context reads and cumulative partial indexes | Two-run primary fixture produces exact expected keys/counts |
| 6. `glue_scripts/observations.py` | Transition and retained-time policies, canonical queries, output-only annotations and complete candidate state | Fan-out produces no false transition; retries and source-time regressions tested |
| 7. `src/report.ts`, `src/commit.ts`, `src/handlers.ts` | Result/file verification, authenticated acknowledgement, conditional commit and recoverable receipts | Consumer failure preserves prior generation; valid same-result acknowledgement commits once |
| 8. `glue_scripts/snapshot_worker.py`, `src/snapshot.ts` | Baseline/merge/maintenance SQL, ordered discovery, global lease, drift rules and application ledger | Real Iceberg baseline/merge/failure-replay tests pass |
| 9. `src/sample.ts`, shared worker sample path | Pinned ID scope, materialized/JDBC samples and authoritative projection overrides | Newly added columns work through JDBC; scoped runs cannot commit |
| 10. `src/cli.ts`, `tests/`, `lib/connect-stack.ts`, `bin/app.ts`, CI | Local commands, acceptance harness, AWS resources/roles/workflows and deployment verification | Clean checkout can run every required command and synth assertions |

Use these interface contracts:

- `resolveSource(identity, catalog) -> verified SourceDefinition`: no source-name
  branches or implicit version fallback.
- `planRun(request, executionContext, environment) -> Plan Artifact`: reserve
  immutable identity/time and pin one complete checkpoint, lease and configuration.
- `readTyped(tablePlan, registration, session) -> DataFrame` and
  `readEntityContext(table, entityIds, plan) -> DataFrame + provenance`: share
  projection/filter rules; preserve source concurrency and bounds.
- `buildIndex / compareIndexes / mergePartialIndexes`: implement the exact
  four-column index and coverage rules in the extraction reference.
- `runPlan(planUri, planDigest, executionId) -> Result Artifact`: materialize,
  compare, hydrate, annotate, validate/write and stage a candidate, without commit.
- `verifyResult(artifact) -> Result`, `acknowledge(payload, authenticatedCaller)
  -> Commit`: independently validate bytes, consumer evidence and conditional state.
- `refreshSnapshot(resultArtifacts, settings) -> SnapshotReceipt[]`: use its own
  serialized state, never mutate the ingestion committed pointer.

Pass `--PLAN_S3_URI`, `--PLAN_SHA256`, `--EXECUTION_ID`, `--CONTRACT_SCHEMA_URI`
and `--CONTRACT_SCHEMA_SHA256` to Glue. Keep the fixed observation instant inside
the verified plan. Load local adapter settings separately; never reinterpret a
production S3 path as a local file automatically. Validate before any source query.

## 3. Command surface to implement and run

Copy the reference contract and synthetic examples into target schema/fixture
locations; write the commands below there. `environment.json` derives from the
local example. Resolve relative paths against its directory. Ignore secrets,
local environments, generated data, virtual environments and build artifacts.

| Command | Required behavior |
| --- | --- |
| `npm run fixtures -- --environment <file>` | Materialize byte-identical configuration and typed synthetic before/after tables locally |
| `npm run ingest -- --environment <file> --request <file> --execution-id <id>` | Local resolution → real Spark → verified result, no AWS calls in local mode |
| `npm run acknowledge -- --environment <file> --receipt <file>` | Verify registered consumer evidence and commit the exact candidate; local fixtures use a clearly isolated test consumer |
| `npm run acceptance` | Execute the primary two-run case, variants and failures; write an evidence JSON with expected/actual values |
| `npm run typecheck`, `lint`, `format:check`, `test` | tsc, ESLint, Prettier and Vitest respectively |
| `npm run synth`, `check-deploy`, `deploy` | Read the same `CONNECT_ENVIRONMENT`; synth without deployment; verify AWS facts before deploy |

After implementing these commands, run from the target repository:

```bash
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.lock.txt
npm ci
npm run typecheck
npm run lint
npm run format:check
npm test
.venv/bin/ruff check glue_scripts tests
.venv/bin/ruff format --check glue_scripts tests
.venv/bin/basedpyright --pythonpath .venv/bin/python
export PYSPARK_PYTHON="$PWD/.venv/bin/python"
export SPARK_LOCAL_IP=127.0.0.1
.venv/bin/python -m pytest tests/test_delta.py tests/test_hydration.py tests/test_observations.py -q
CONNECT_ICEBERG_TESTS=1 .venv/bin/python -m pytest tests/test_snapshot_iceberg.py -q
npm run fixtures -- --environment environment.json
npm run acceptance
export CONNECT_ENVIRONMENT="$PWD/environment.json"
npm run synth
```

Create a PostgreSQL integration fixture for real JDBC pushdown/projection/chunking
and verify source query bounds with a bounded explain/read test. A file-backed
fixture proves transformation semantics but does not prove JDBC behavior.
Run the same setup in a clean checkout. Lock JAR versions/checksums and document
any package-registry/Maven access needed by the tests; keep generated binaries
outside the skill and versioned fixture inputs synthetic.

## 4. Acceptance, deployment and handoff

Implement every gate in [verification](verification.md), then the exact
[AWS responsibilities](aws-workflow.md). Preserve shared telemetry/alerts,
configuration publication and consumer APIs. Activate supported features through
runtime settings; do not hide deploy-only switches in CDK context.

Return the target revision, actual toolchain, modules/contracts, command exits,
primary expected/actual outputs, negative cases and synth evidence. For AWS add
verified account/region, runtime/source settings, job/workflow/result/consumer
identities, prior and committed generations and snapshot freshness when requested.
A specification-only plugin change is complete when its references/behavior
validate; a requested product build is complete only after implementation and
its applicable execution checks. Do not confuse those two tasks.
