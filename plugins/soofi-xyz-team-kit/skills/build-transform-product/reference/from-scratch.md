# Recreate Transform in a target repository

Use this guide to **write the product implementation in the user's target
repository**. This skill supplies instructions, contracts and examples. Create
and test the modules described below in that repository; no product runtime,
bootstrap generator or deployable stack ships with this skill.

## 1. Intake and shared dependencies

Use this initial instruction:

> Use Kecleon to implement Transform in this empty repository. Follow its build
> guide, contracts and acceptance cases. Keep the shared skills. Implement and
> verify the local data flow first, then prepare the AWS stack using the supplied
> environment facts and existing authorization.

Reuse the session's target directory and constraints. Choose the baseline below
for routine engineering decisions. Ask only for unavailable business or deployment
facts: source/target schemas and rules, account/region/stage, storage scopes,
Lexicon catalog, budget/pricing and alert/metrics integrations. Continue local
implementation with the example configuration while external facts are missing.
Do not infer real business rules from a language's name.

Read these existing shared skills; keep them shared:

| Dependency | Apply it to | Environment boundary |
| --- | --- | --- |
| [Engineering](../../apply-engineering-guidelines/SKILL.md) | TypeScript services/CDK, Python Spark jobs, quality checks, Powertools, metrics and critical/DLQ alerts | Resolve account, region, registered metrics and alert receiver from the selected environment |
| [Lexicon](../../build-lexicon-product/SKILL.md) | Language definitions (the schema), SQL publication, immutable versions and catalog discovery | Reuse its discovered publication flow and S3/SSM outputs |
| [Persist](../../build-persist-service/SKILL.md) | Requested graph loading and consumer readback | Load only when delivery to a graph store is part of the task |

Read the shared rule files needed for the operation. Treat reference deployment
identities as examples, not authorization to use that environment. Preserve
existing session authorization. Do not copy or rewrite shared skills into Transform.

## 2. Toolchain and configuration

Use Python **3.11**, Java **17**, PySpark **3.5.6**, Glue **5.1**, Node **22.18+
within 22.x or 24.x**, and npm. This pins a reproducible Spark baseline. Verify
[AWS's runtime matrix](https://docs.aws.amazon.com/glue/latest/dg/release-notes.html)
when changing it; update local Spark and Glue together. Set `JAVA_HOME` to Java 17
and verify actual binary versions before debugging Spark startup.

Create a strict TypeScript ESM project with CDK v2, constructs, AWS SDK v3 clients
for S3/SSM/SQS/Step Functions, Powertools, AJV 2020 + format validators, Vitest,
ESLint, Prettier, tsx and esbuild. Pin compatible resolved versions in
`package-lock.json`. Create Python dependency pins for PySpark, boto3, jsonschema,
a Spark-dialect SQL parser, Pytest, Ruff and basedpyright. Commit a lock file and
verify a clean install. Do not choose a new library during each implementation
step when these tools already cover the task.

Copy the declarative [contract schema](contracts/contracts.schema.json) into the
target repository's `schemas/`. Generate or maintain TypeScript types with parity
checks against that schema. Use AJV in TypeScript and Draft 2020-12 validation in
Python; compile named `$defs`, not the unconstrained root document. Add the
semantic checks in [contracts and defaults](contracts-and-defaults.md).

Create `environment.json` from [the local example](examples/environment.local.json).
Resolve relative paths against the environment file's directory. Keep secrets
in the credential provider chain and ignore local environments, data, build
outputs and dependency directories in Git. The local example's prices and AWS
identities are fixture values. Local execution must require no cloud credentials.

## 3. Implement in this order

Use these paths for a new repository. In an existing product, map the same
responsibilities to its modules before editing.

| Step / module to create | Implement | Exit check |
| --- | --- | --- |
| 1. `schemas/contracts.schema.json`, `src/contracts.ts` | Named-schema validation, typed boundary objects, artifact SHA-256, canonical request digest and semantic validation | Accept the worked example; reject unknown fields and invalid combinations in both runtimes |
| 2. `src/store.ts` | Local object-store adapter and scoped S3 adapter; bounded reads/listing, immutable writes, conditional snapshot copies | Local and S3 contract tests prove missing-object, overflow, conflict and digest errors |
| 3. `src/fixtures.ts`, `tests/fixtures/` | Materialize the declarative example; produce all source encodings from the definition-derived types; publish fixtures locally | Real-byte digests match catalog, language definitions and SQL references |
| 4. `src/control.ts` | Exact pair resolution, semantic validation, cost admission, input snapshots, immutable plans and result verification | Direction/ambiguity/alias-change/scope/replay tests pass without calling Glue |
| 5. `glue_scripts/transform_worker.py` | Local Spark/Glue entry points, readers, SQL DAG, distributed validation, graph adapters and writers | CSV → SQL → typed Parquet → readback passes with actual Spark |
| 6. `src/cli.ts`, `tests/acceptance.ts` | Local commands invoking the same resolver/worker/reporter as AWS; full acceptance matrix | All format, graph, reverse and failure cases pass |
| 7. `src/handler.ts` | Typed resolve/approval/report/failure actions, Powertools logging/tracing/metrics | Adapter tests preserve payloads and sanitize terminal errors |
| 8. `lib/transform-stack.ts`, `bin/app.ts` | CDK resources, Standard workflow, IAM, callbacks and failure paths from the AWS reference | Typecheck, CDK assertions and synth pass |
| 9. `.github/workflows/verify.yml`, operating docs | Clean install, all quality/runtime checks, synth and evidence upload | A fresh checkout runs the same commands successfully |

Use these module boundaries; implement the behavior, not just empty signatures:

- `validate<T>(definition, unknownValue) -> T`: return only fully validated data.
- `Store.readArtifact(Artifact) -> bytes`: enforce scope/size then verify digest.
  `listInput(uri) -> ObjectIdentity[]`: paginate completely within limits.
  `putImmutable(uri, bytes) -> Artifact`: identical replay succeeds; different
  existing bytes fail. `snapshot(object, runUri) -> PinnedInputObject`: copy the
  enumerated identity conditionally; fail if the source changed.
- `resolve(request, executionId, environment, store) -> Resolved`: perform the
  ordered algorithm in the contract reference and persist its plan before returning.
- `run_plan(plan_uri, plan_sha256, execution_id, contract_uri, contract_sha256)
  -> Result`: share one Python pipeline between `SparkSession` locally and
  `GlueContext` in AWS. Treat injected store/session adapters as infrastructure,
  never as different transformation logic.
- `validateApproval(approval, resolved) -> void`: require the exact approved plan,
  execution and ceiling. `report(resolved, store) -> Result`: validate completed
  output without rerunning SQL. `recordFailure(context, error) -> Failure`: retain
  phase and safe classification plus run-specific diagnostic pointers.

Pass Python `--EXECUTION_PLAN_S3_URI`, `--EXECUTION_PLAN_SHA256`, `--EXECUTION_ID`,
`--CONTRACT_SCHEMA_URI` and `--CONTRACT_SCHEMA_SHA256` in both modes. Supply local
object-root configuration separately; never reinterpret an AWS URI as a local
path in AWS mode. Keep datasets out of Lambda/workflow payloads.

## 4. Command and test interface to implement

Create the commands below **in the target repository** before running them.
Define `typecheck`, `lint`, `format:check` and `test` as the appropriate tsc,
ESLint, Prettier and Vitest commands. Define the CLI interfaces as follows:

| Command | Contract |
| --- | --- |
| `npm run fixtures -- --environment <file>` | Materialize the local example and register reverse/identity/graph cases; never write AWS resources |
| `npm run transform -- --environment <file> --request <file> --execution-id <id>` | Require local mode, resolve → invoke Python → report; exit nonzero on any failure |
| `npm run acceptance -- --environment <file>` | Generate format variants, execute the matrix, reread outputs, write `.local/acceptance-evidence.json` |
| `npm run synth` | Synthesize CDK using `TRANSFORM_ENVIRONMENT`; do not call deployment |
| `npm run check-deploy` | Validate AWS environment, selected identity, region, price freshness and required integrations |
| `npm run deploy` | Run check-deploy then CDK deploy with the same environment; write local stack outputs |

After implementation, run from the target repository:

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
.venv/bin/python -m pytest tests/test_worker.py -q
npm run fixtures -- --environment environment.json
npm run acceptance -- --environment environment.json
export TRANSFORM_ENVIRONMENT="$PWD/environment.json"
npm run synth
```

Implement the [worked example and exact acceptance assertions](worked-example.md)
and [failure matrix](operations-and-verification.md). Run real Spark; a mocked
`spark.sql()` call does not validate SQL, types or serializer behavior. Then repeat
setup and checks in a clean checkout with no generated data or sibling repositories.

## 5. AWS and completion

Read [AWS workflow](aws-workflow.md) before writing the stack or deploying. Reuse
`AWS_PROFILE=<selected-profile>` and verify the account/region. Create an AWS
configuration with actual approved resource identities, current regional pricing
and authorized limits. Resolve shared telemetry/alerts and publish configuration
through Lexicon before activation. Keep consumer-specific loading in Persist.

Return the target repository/revision, created modules, toolchain, commands,
acceptance assertions/results and synth evidence. For deployed work, add actual
account/region, deployed code/contract digests, workflow/job IDs, pinned plan and
validated output. Keep **local implementation verified**, **stack synthesized**
and **live deployment verified** as distinct claims. Never report a runtime as
implemented or tested merely because this specification exists.
