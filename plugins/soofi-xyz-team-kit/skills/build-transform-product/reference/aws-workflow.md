# AWS workflow, permissions and recovery

Implement this operational contract in the target repository's CDK stack and
TypeScript handlers. Use the shared engineering/deployment skills for their
existing integration and verification rules. No deployable stack ships here.

## State and payload transitions

Start a **Standard** workflow with `{ "request": <Request> }`. Use the execution
name as the immutable execution ID. Keep input data in S3, not workflow payloads.

| State | Input/action | Output/next state |
| --- | --- | --- |
| ResolvePhase → ResolvePlan | Validate request, resolve catalog, estimate work, reserve run, conditionally copy sources, write immutable plan | `$.resolved = Resolved` → CostAdmission |
| CostAdmission | Compare pinned estimate to automatic-approval threshold | ExecutePhase or ApprovalPhase |
| AwaitApproval | Send execution ID, plan and cost plus task token to encrypted approval queue | Callback payload → `$.approval`; bounded timeout |
| ValidateApproval | Require APPROVE, identical execution ID, plan digest and ceiling | ExecutePhase; invalid/rejected callback fails |
| ExecuteQueries | Pass plan URI/digest and contract URI/digest to Glue | Wait through `glue:startJobRun.sync`; write job result to `$.job` |
| VerifyResult | Read completion manifest, verify plan binding and actual objects | `$.result = Result` → return only Result |
| RecordFailure → NotifyCriticalFailure | Persist sanitized Failure and send execution-level critical event | Failed |

Set the phase before each boundary so failure records distinguish resolution,
approval, execution and reporting. Publish an execution-level alert; use workflow
failure/timeout alarms as a backstop if failure recording or alert publication
itself fails. Connect DLQ alarm and recovery notifications to the shared channel.
Use execution ID as the deduplication key in the existing alert receiver.

Use the documented [Glue synchronous integration](https://docs.aws.amazon.com/step-functions/latest/dg/connect-glue.html).
The job has zero automatic retries. Retry only the idempotent
reporting boundary on selected Lambda service/throttle failures, twice with
2-second exponential backoff. Do not add a broad `States.ALL` retry around Glue.

## Cost and capacity

For G.1X, one worker contributes one DPU. The estimator must calculate:

```text
estimatedSeconds = max(60, ceil(startupSeconds
  + inputBytes × expansionFactor × complexityFactor
    / (bytesPerDpuSecond × workerCount)))
estimatedUsd = round_up_to_cent(estimatedSeconds × workerCount × dpuHourUsd / 3600)
maxRuntimeUsd = round_up_to_cent(timeoutMinutes × 60 × workerCount × dpuHourUsd / 3600)
```

Reject estimates above the request/deployed ceiling or configured job timeout.
Require callback approval above `autoApproveUsd`; approvals never increase the
ceiling. The estimate is an admission model, not a guaranteed billing cap.
Report its assumptions and maximum modeled job-runtime cost. Actual charges also
include storage, requests, orchestration, logging and any transfer charges.

The default limits are 1,000 objects, 10 GiB total, 1 GiB per object, a 4 MiB plan,
two G.1X workers, one concurrent run, 30-minute job timeout and one-hour approval
timeout. These are configured baseline limits, not universal Transform restrictions.
Calibrate throughput/expansion on representative data before increasing them.
Oversized work fails explicitly; partition it into separately registered requests
or implement a reviewed scalable planning/copy mechanism. Never truncate lists.

## Resource and IAM responsibilities

| Principal | Required scope |
| --- | --- |
| Authorized caller | Start/describe the selected workflow; approved input/output scope is also validated by the resolver |
| Control Lambda | Read the Lexicon publication prefix; list/read approved input prefixes; write/read `runs/*`; read/list `results/*` |
| Glue role | Read the deployed script/contracts, Lexicon publication prefix and `runs/*`; write/read/list `results/*`; job logs/metrics |
| Workflow role | Invoke control Lambda, start/poll/stop the selected Glue job, send approval messages and publish critical events |
| Approval operator/service | Read/delete messages from the selected approval queue and submit task success/failure under the verified account |
| Lexicon publisher | Publish immutable artifacts/catalog through its existing governed configuration release flow |

S3 buckets block public access, require TLS and retain versioned data on stack
removal. Scope object grants to prefixes and separate input/configuration/output
permissions. Keep credentials in the SDK/CLI provider chain. Review generated IAM
with `cdk diff`; the synchronous Glue integration may require service-specific
wildcard permissions as described by AWS. Do not replace all IAM with `*` grants.

A catalog and all definition/SQL artifacts it references must be inside the configured
Lexicon publication prefix for the baseline IAM policy. Different publication
locations require explicit reviewed prefix grants, not unrestricted bucket access.
Deployments using customer-managed KMS keys must add the matching decrypt/encrypt
grants through the shared engineering flow before a pilot.

## Publish a development fixture and start a run

After implementing the CLI and deploying to a development environment, prepare
a local fixture environment using the real artifact
bucket name and `mode: local`, with the catalog URI below that bucket's `config/`.
Keep it separate from production configuration. Generate the fixture in that
local object root, then upload its config/source subtrees to the approved bucket:

```bash
npm run fixtures -- --environment environment.fixture.json
aws s3 sync "$FIXTURE_OBJECT_ROOT/$ARTIFACT_BUCKET/config/" "s3://$ARTIFACT_BUCKET/config/" --region "$AWS_REGION"
aws s3 sync "$FIXTURE_OBJECT_ROOT/$ARTIFACT_BUCKET/source/" "s3://$ARTIFACT_BUCKET/source/" --region "$AWS_REGION"
```

Set those variables from the validated fixture environment; never infer a bucket
from a sample name. Use the shared Lexicon release flow instead for live customer
mappings. Verify published digests before enabling the catalog.

Wrap `.local/request.json` as `{ "request": ... }` in `workflow-input.json`.
Obtain `STATE_MACHINE_ARN` from stack outputs and choose a new `EXECUTION_ID`:

```bash
aws stepfunctions start-execution --state-machine-arn "$STATE_MACHINE_ARN" --name "$EXECUTION_ID" --input file://workflow-input.json --region "$AWS_REGION"
```

Read `EXECUTION_ARN` from the returned `executionArn`, then inspect it:

```bash
aws stepfunctions describe-execution --execution-arn "$EXECUTION_ARN" --region "$AWS_REGION"
```

An approval callback is exactly:

```json
{
  "decision": "APPROVE",
  "executionId": "run-example",
  "planSha256": "<digest from the approval message>",
  "ceilingUsd": 10
}
```

Read the actual values from the selected message, validate the plan and the spend
authorization, then write the decision to `approval.json`. The task token authorizes a workflow callback: keep it out of files committed to Git, logs, PRs and reports. Use the
shared approved callback tool or AWS SDK with that token and the JSON payload.
`SendTaskSuccess` only delivers the decision; the following validation state
determines whether execution can proceed. Reject/timeout ends the run without Glue.

## Recovery and evidence

- Resolution failure: retain the reservation/snapshots for diagnosis; retry with
  a fresh execution ID. A complete existing plan can be reused only for the same
  canonical request. Do not delete evidence to make a conflicting request fit.
- Approval failure: inspect the decision/expiry and existing authorization; create
  a new execution rather than refreshing aliases in an already approved plan.
- Glue failure/partial output: no completion marker is produced. Inspect the job
  and artifacts, fix the configuration/code, then execute under a new run prefix.
- Reporting failure after valid output: call the reporting action with the same
  `Resolved` value. It verifies existing data and uses a write-once metrics receipt.
  Document that the custom completion metric is at-most-once and can be missed if the process
  fails after the receipt; use workflow/native metrics and manifests for audit.
- Rollback: redeploy the previous code revision and restore the prior enabled
  catalog pointer through Lexicon. Keep immutable configurations and results.

For a live pilot, record workflow/job IDs, account/region, deployed script/contract
digests, plan, output manifest, actual object counts and decoded values. Verify
an invalid mapping, rejected approval and a broken endpoint fail at the documented
phase. A successful local suite or synthesis does not establish these live results.

## CDK implementation checklist

Create these resources in the target repository, adapting names to the stage:

- A private versioned artifact bucket with TLS enforcement, encryption and retain
  removal policy. Import the configured Lexicon publication and source scopes;
  grant source read/config read/output write separately. Add lifecycle policies
  only from an explicit retention requirement.
- A Glue 5.1 Spark ETL job, Python 3.11 script asset, G.1X workers and environment
  limits. Deploy the contract schema as a separately hashed asset. Pass all five
  URI/digest/identity arguments from the build guide. Pin Python additions such
  as `jsonschema==4.25.1` and `sqlglot==27.27.0`; use Glue's bundled Spark/boto3
  where compatible. Package/install dependencies reproducibly and run their
  import checks under the selected Glue runtime before a live pilot.
- TypeScript Lambda handlers on Node 22, default 1,024 MiB memory and a ten-minute
  resolver timeout. Pass the same validated environment configuration to every
  handler. Enable structured Powertools logging, tracing and registered metrics;
  instrument the actual SDK clients used by resolution and reporting.
- An encrypted approval SQS queue and DLQ, one-hour callback timeout by default,
  and message retention longer than that timeout. Put only plan pointers,
  execution identity, cost and the secret task token in the message. Restrict
  consumers; delete processed messages and handle expired tokens explicitly.
- A Standard Step Functions state machine with a two-hour execution timeout for
  the default limits. Validate that configured approval + job + resolver/report
  timeouts fit the workflow timeout when changing limits. Write the current
  phase before resolve, approval, execute and report boundaries. Catch terminal
  task errors into the Failure handler, then notify the existing critical-alert
  receiver and enter Fail. Catch callback timeout/rejection as approval failure.
- Workflow failed/timed-out and nonempty-DLQ alarms, with the shared receiver on
  ALARM and OK transitions. Use workflow alarms to cover failures that cannot run
  the failure handler. Preserve the shared deduplication/recovery behavior.
- Outputs for artifact bucket, catalog URI, Glue job, approval queue, state
  machine and contract/script asset identities. Publish
  `/transform/<stage>/state-machine-arn` through SSM. Discover live resources
  through outputs instead of hardcoded account/resource names.

Use `$.request` only for resolution. Set `$.resolved` to the small `Resolved`
object, `$.approval` to the callback object, `$.job` to the Glue integration result
and `$.result` to the validated `Result`. Discard SDK envelope metadata at these
boundaries and return only `$.result` on success. Keep the plan, catalog and input
lists in S3 so even the largest permitted plan stays outside Step Functions payloads.

Before deployment, run `aws sts get-caller-identity` with the selected profile,
compare its Account to `environment.accountId`, and pass `environment.region`
explicitly to AWS/CDK. Require the SNS topic's account/region to match the approved
integration scope. Verify regional Glue pricing and `priceAsOf` (within 30 days,
not future-dated) both at deployment and admission. Check positive estimates,
`autoApproveUsd <= defaultCeilingUsd <= maximumCeilingUsd`, valid object/plan
limits and supported worker settings. Treat the example price as synthetic.
