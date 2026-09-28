# AWS workflows, permissions and runtime controls

Implement these workflows in TypeScript CDK in the target repository. Use shared
engineering/batch skills for observability, critical alerting and release checks.
Reuse verified existing resources. Do not infer resource identities from examples.

## 1. Extraction and delivery

Use Standard Step Functions. Keep plans/data/large manifests in S3 and pass only
execution identity and artifact pointers in state payloads. Start with
`{ "request": <Request> }`; obtain execution ID/start time from workflow context.

| State | Implemented action | Next/result |
| --- | --- | --- |
| `ResolveRegistration` | Validate request/source, pin configuration, determine source consistency and checkpoint compatibility | Resolved small context |
| `AdmitAndReserve` | Estimate/cap work, conditionally reserve execution and eligible source lease, pin prior generation | Immutable Plan URI/digest |
| `SelectMode` | Distinguish production delta/baseline from tables/backfill/sample | One applicable Glue job |
| `ExtractAndBundle` | `glue:startJobRun.sync` with plan/execution/schema digests; renew source lease while executing | Worker result pointer |
| `VerifyExtraction` | Validate result, files/counts/schemas, candidate manifests and eligibility | `Result` with status EXTRACTED |
| `ReturnOrAwaitDelivery` | Return scoped/extraction output; for registered production after-consumer mode enter durable delivery-pending state | Await authenticated acknowledgement |
| `VerifyAcknowledgement` | Bind configured consumer and its successful execution to this immutable result | Commit-ready context |
| `CommitGeneration` | Conditional pointer transaction with original generation and fencing token | COMMITTED receipt |
| `RecordFailure` → `NotifyCriticalFailure` → Fail | Preserve phase/partial references and pending recovery state; notify shared receiver | No checkpoint advancement |

Implement a separate commit/acknowledgement entry point so reporting/delivery can
resume without starting another Glue run. Return the extraction artifact to the
parent orchestrator before it invokes Transform/Persist. The parent can then call
the authenticated acknowledgement boundary. Do not have both workflows wait for
each other: either the parent owns downstream execution and explicit commit, or
Connect owns invoking a registered consumer and its wait, with one clear owner.
For the first build, use parent-owned downstream execution plus explicit commit.
Thus the extraction workflow ends at EXTRACTED; the commit workflow contains
VerifyAcknowledgement → CommitGeneration. Keep the same pending run/lease record
across both workflows. A delivery watchdog renews/checks that record and alerts on
stalled work; it does not auto-commit or start a fresh extraction.

Use SQS only when an actual queued ingress boundary is implemented. If a queue is
added, attach its DLQ and shared self-resolving alarm; do not claim queues are part
of the inspected reference's callback protocol. A task-token variant requires
its own expiration/replay handling and remains an explicit extension.

## 2. Snapshot workflow

Use an extraction-completed EventBridge event to start
`DiscoverPendingResults → AcquireSnapshotLease → ApplyOrderedResults(Map=1)
→ MergeOrBaseline(Glue.sync) → RecordSnapshotReceipt → ReleaseLease`.
A scheduled reconciliation path repeats discovery to recover missed events.
Snapshots consume only verified S3 results and Glue Catalog/Iceberg; they need
no JDBC secret or database connection. Provision maintenance separately and let
runtime settings enable schedules or cause handlers to perform a safe no-op.

Use per-source global exclusion in addition to Map/Glue concurrency. Keep result
watermarks and per-table application markers, and prohibit a complete receipt on
failed or awaiting-baseline tables. Alarm on refresh failures/backlog/staleness
without coupling them to ingestion delivery success.

## 3. Resources and runtime defaults

Create/import these components:

- Private encrypted, versioned artifact/data buckets, TLS enforcement and retained
  production state. Separate configuration, inputs, outputs, checkpoint and
  snapshot prefixes. Apply approved lifecycle policies that respect pinned state.
- A DynamoDB control/lease/execution table with conditional transactions,
  point-in-time recovery and retained state. Index pending delivery/recovery work;
  store only pointers and coordination data, never entire plans or datasets.
- Glue ETL jobs for extraction and snapshot refresh, plus a sample mode/job with
  a scoped configuration-read role. Default Glue 5.0, two G.2X workers, one
  concurrent execution per job, no automatic paid-work retry, 60-minute timeout.
  Use at most four JDBC connections and 5,000-key hydration batches initially;
  these are tunable starting limits, not universal throughput claims.
- A private JDBC Glue connection with source security-group rules, Secrets Manager
  credential access and required S3/SSM/Secrets endpoints or approved egress.
  Capture source grants/network tests before a live pilot.
- TypeScript Node 22 handlers for resolution, reporting, commit and snapshot
  planning/receipts; default 1 GiB memory and five-minute timeout. Use Powertools
  Logger/Tracer/Metrics, instrument real SDK clients and redact sensitive inputs.
- Standard state machines, EventBridge triggers/reconciliation schedules and a
  watchdog for stalled pending deliveries/expired leases. Set workflow timeouts
  above their job/handler budgets; configure delivery expiry independently.
- The configured critical-alert integration, failure/timeout, pending-delivery,
  snapshot-lag and any DLQ alarms, with recovery notifications. Register every
  business metric through the shared Lexicon/dashboard flow.

Provision features in a safe inactive state and activate through validated
`Environment.activation` settings stored through SSM/AppConfig and source
registration. The local example enables test modes; a new AWS installation starts
inactive. Preserve explicitly configured activation on subsequent releases. Never
require a CDK context
flag or another deployment merely to run a supported mode or enable refresh.

Publish stack outputs and environment-specific discovery parameters for the
extraction state machine, commit boundary, sample workflow, snapshot workflow,
source catalog, data bucket, control table and current dataset descriptor. Treat
those parameter names as a new deployment contract; discover existing names
when integrating, rather than assuming generic pointers already exist.

## 4. IAM boundaries

| Principal | Scope |
| --- | --- |
| Resolver | Read approved catalog/config/schema prefixes, read committed state, transact execution/lease metadata and write immutable plans |
| Extraction job | Read selected source secret/connection/config, network to that source, read pinned checkpoints, write its run and candidate prefixes; renew its fenced lease through a narrow control boundary |
| Sample job | Read approved candidate projection locations and permitted inputs/source; write only sample namespaces; no production commit permissions |
| Reporter | Read result/output/candidate manifests, count/check objects, publish registered telemetry |
| Committer | Read verified result/candidate/consumer evidence, authenticate configured caller, conditionally update the control pointer |
| Snapshot job | Read completed S3 source results, write source-specific Iceberg warehouse/catalog and application markers; no JDBC credentials |
| Workflow/event roles | Invoke named handlers/jobs/workflows and alert receiver; minimal integration-specific permissions |

Restrict both bucket listing prefixes and object ARNs. Add KMS decrypt/encrypt
permissions for the actual keys in scope. Do not copy broad wildcard S3 read
grants from a reference implementation. Validate runtime URI scopes before the
job's privileged reads. Review synthesized IAM and allowed/denied paths.

## 5. Cost, retries and operations

Verify current regional pricing and record its date; the example's price is
synthetic. Model worker count × DPUs per worker × runtime × regional DPU-hour
rate, plus separately disclosed request/storage/orchestration estimates. Reject
plans whose modeled worst configured job runtime exceeds the authorized ceiling;
record real job duration/DPU usage after execution as modeled compute spend,
not a final invoice. A scoped sample must still pass limits/admission.

Retry read-only metadata/service throttles at most three attempts with bounded
exponential backoff and jitter. Do not broadly retry paid Glue runs or consumer
writes. A classified failure can resume from its pinned artifacts under an
attempt-specific write prefix, retaining the original execution/observation time.
Conditionally publish the winning result; partial attempts never become committed.
Retrying a generation commit is safe only with the same expected state and receipt.

Before deployment, reuse `AWS_PROFILE=<selected-profile>`, call
`aws sts get-caller-identity`, compare account and explicit region to the environment,
verify secret/network/configuration/consumer access, run CDK synth/diff and use the
shared deployment flow. Publish configuration before enabling consumers. Verify
actual script/contract digests, workflow definitions, runtime settings and one
bounded live extraction/delivery/commit before reporting readiness.

Record workflow/job IDs, source/config digests, prior/candidate/committed generation,
result and acknowledgement identities, table counts, bounded read evidence and
snapshot receipt/freshness. Keep local Spark, synthesized AWS resources and live
observations as separate evidence levels.
