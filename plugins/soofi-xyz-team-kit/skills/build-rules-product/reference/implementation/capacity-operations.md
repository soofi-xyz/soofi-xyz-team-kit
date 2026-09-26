# Shared capacity operations

Read [the baseline](PRD.md#evidence-baseline) and Filter's maintained
`docs/capacity-controller.md` before operating a deployed controller.

## Admission contract

Every normal batch start reaches `AcquireCapacity` before graph work. When busy,
its execution remains RUNNING while waiting for a callback. Keep the single-debt
synchronous evaluator outside the batch queue.

- One weight unit represents one ProcessFile worker, currently up to 20 concurrent
  Gremlin requests. Weight S3 work by `min(max(fileCount, 1), 4)` when measurable;
  charge full-graph/unknown work weight 4.
- Reserve P0 capacity for daily operational workloads. P0 may use reserved and
  general pools; P1–P3 cannot use the reserve. Aging never promotes into P0.
- Require a stable `rule_context.consumer` for new integrations and register its
  policy. Unknown consumers receive conservative P2/weight-4 treatment.
- Treat consumer metadata as declared workload metadata, not authenticated identity.
  Normal execution input cannot override priority, weight or admission.

## Runtime configuration and operator access

Read `/filter/capacity/runtime-config`. The create-only bootstrap initializes a
safe disabled config and does not overwrite runtime edits on deployment. The
checked-in production snapshot is `ops/capacity/prod-capacity.json`; inspect the
live value before assuming the snapshot is active.

Reuse the previously verified AWS profile/account/region. Read-only examples:

```bash
AWS_PROFILE=<selected-profile> pnpm capacity status
AWS_PROFILE=<selected-profile> pnpm capacity leases
AWS_PROFILE=<selected-profile> pnpm capacity config show
AWS_PROFILE=<selected-profile> pnpm capacity config validate --file ops/capacity/prod-capacity.json
```

Use the supported `pnpm capacity config publish`, `promote`, `cancel`, and
`force-admit` workflows only when the corresponding operation is in the user's
scope. Preserve reason/audit records and IAM operator separation. Never publish
configuration as a side effect of status inspection. Use force admission only
under the documented incident procedure; it can exceed the budget.

Disabled mode admits tracked PASSTHROUGH leases and drains waiting callbacks;
release and reconciliation remain active. Re-enabling includes active passthrough
weight. Lowering quota pauses admission without preempting active executions.

## Lease lifecycle and failure handling

Preserve `QUEUED → GRANTING → ACTIVE → RELEASED`, plus PASSTHROUGH and
CANCELLED/EXPIRED terminal states. Count GRANTING against capacity before sending
the callback because DynamoDB and Step Functions cannot commit atomically.
Retain ambiguous callback capacity until reconciliation establishes terminal state.

Release on the success path. Let failures remain at the actual failing state;
do not wrap the pipeline in a catch-all that routes everything to a final Fail
state. Failed, timed-out and aborted executions are released by terminal-status
EventBridge cleanup and the five-minute reconciler. Dispatch is release-triggered
through FIFO SQS with a one-minute scheduled backstop and alarmed DLQs.

## Native redrive limitation

Native redrive resumes the failed state, including only unsuccessful Map children.
It does not replay the already-successful AcquireCapacity task. The original lease
may already be released, so redriven work is untracked load. Check headroom first
and account for that workload until it finishes. Do not claim controller-enforced
capacity on redrives until the gap is fixed and tested. Preserve successful work;
restarting the entire execution is not equivalent to native redrive.

## Rollout and verification

Provision disabled, drain executions predating the gate, verify passthrough
accounting, then validate DEV overlaps before enabling runtime quotas. The
conservative documented policy starts at total weight 8 with P0 reserve 4; inspect
current approved policy rather than applying those numbers blindly.

Monitor queue age/depth, active weight, lease cleanup, callback failures, invariants,
Persist 503/504 and adaptive-concurrency reductions. The local capacity dashboard
and PagerDuty path exist; shared Lexicon metric registration/Main Dashboard
integration require separate evidence. See [verification](verification.md).

Source anchors: `src/capacity/{config,classifier,scheduler,repository,handlers}.ts`,
`scripts/capacity-controller.ts`, `lib/filter-stack.ts`, `test/capacity-controller.test.ts`.
