# Continuous ingestion control contract

Use this contract so county ingestion progresses without repeated operator nudges. The
conversation is not the workflow engine. Start or reuse a durable run coordinator that
persists state, advances eligible stages, supervises workers, and survives agent/session
exit.

## Run-until-terminal rule

After every stage event, atomically update the run state, recalculate ready work, and enqueue
the next eligible stage. Do not wait for “go ahead” between successful, reversible,
already-authorized stages.

Use explicit states:

- `DISCOVERING`
- `READINESS_BLOCKED`
- `READY`
- `RUNNING`
- `COOLING_DOWN`
- `WAITING_HUMAN`
- `PUBLISHING`
- `VERIFYING`
- `COMPLETE`
- `FAILED_EXHAUSTED`

A stage success, status report, pilot completion, capture completion, load completion, or
agent-session boundary is not a terminal condition. Stop advancing only when:

- the requested scope is `COMPLETE`;
- a policy, privacy, payment, CAPTCHA, or credential action genuinely requires a human,
  while every independent safe track has been advanced as far as possible; or
- bounded retries are exhausted and the failure is durably classified with an owner and
  exact recovery action.

Long-running work must be owned by a durable scheduler/supervisor. Do not depend on the user
returning to the chat to resume it.

## Durable run manifest

Create the run manifest at intake and store revisioned updates in durable orchestration
storage. Never use chat text, a local path, a PID, or a dashboard count as the source of
truth.

Record:

- run ID, county/scope, selected ingestion stack, stage dependency graph, and source-catalog
  URI plus digest;
- repository identity, branch, commit SHA, clean-tree or tree/patch digest, installed skill
  version, runtime image digest, and redacted configuration/registry/schema digests;
- independently proven Neon destination identifiers;
- AWS BBB execution proof: approved AWS account/region, remote runtime identity, US egress,
  `operator_machine: false`, and secret references/availability—not secret values;
- Filebase publication readiness: credential reference/availability, bucket, IPNS owner,
  approval state, and last published watermark;
- stage state, attempt count, heartbeat, lease expiry, fencing token, checkpoint URI and
  signature, artifact manifest URI, source/captured/loaded/published counts, and blocker
  owner/action.

Before remote dispatch, validate the recorded repository commit/tree, runtime image,
configuration, registry, schema, and source-catalog digests. Never silently run a different
branch, stale skill copy, dirty worktree, or mismatched configuration.

## Cross-environment handoffs

Every producer writes an immutable handoff manifest before marking a stage complete. Include:

- run, source, partition, producer, and intended consumer;
- artifact URI, byte/content digest, schema version, row/count reconciliation, and privacy
  classification;
- terminal checkpoint and all configuration/registry/schema signatures;
- destination proof reference and next eligible stage.

The consumer verifies the manifest and artifact digest, then records an idempotency receipt
before processing. Reject incompatible or mutable handoffs. Never copy hardcoded counts from
chat, poll for unnamed “latest” files, or pass live browser sessions/checkpoints between
environments.

Use the pipeline's durable event/queue mechanism to wake the consumer. If only a bounded
poller exists, poll the exact manifest key with a deadline and backoff; do not require an
operator message to continue.

## Worker supervision and recovery

Every worker must hold a renewable lease and fencing token and emit heartbeats plus committed
checkpoint progress. Record `nextAttemptAt` for deliberate cooldowns.

Classify a worker as stale only when its lease/heartbeat deadline expires and it is not in a
valid cooldown. Recover automatically only when:

- no unexpired lease or advisory lock remains;
- the source, registry, configuration, schema, and checkpoint signatures match;
- the retry budget remains; and
- the resume command targets pending work without resetting completed units.

Reacquire the lease atomically with a higher fencing token, then resume idempotently from the
last committed checkpoint. Never start a competing writer. Use bounded retries with backoff
and jitter; after exhaustion, set `FAILED_EXHAUSTED`, retain evidence, name the owner and
recovery action, and continue independent workstreams.

## Automatic stage transitions

- Intake launches source/jurisdiction enumeration, adapter determination/build, execution and
  destination proof, Filebase/IPNS readiness, and blocker routing in parallel.
- Readiness `PASS` enqueues the next dependency-ready seed/pilot/run stages automatically.
- A capture handoff enqueues transform/validation; a valid transform handoff enqueues
  idempotent load/match; a reconciled load advances the loaded watermark and enqueues publish
  preparation.
- A readiness block prevents seed, pilots, adapter scale-out, and full ingestion, but keeps
  bounded enumeration, adapter implementation/fixtures, access remediation, records-request
  preparation, and publication readiness active.
- PII publication waits for the durable human approval only. Once approved, `Publish.tick`
  uploads and the controller continues through verification without another prompt.

## Completion and snapshot drift

Set `COMPLETE` only when the requested scope has:

1. terminal source enumeration and capture checkpoints;
2. reconciled, idempotently loaded Neon rows with linked and valid-unlinked counts;
3. a frozen privacy-approved artifact manifest and watermark;
4. immutable Filebase/IPFS upload and CID;
5. remote digest/count readback;
6. IPNS/catalog/MCP registration; and
7. successful `listPublishedCounties`, `getOracleDatasetInfo`, and representative Donphan
   smoke checks.

Capture is not load. Load is not publication. Publication is not MCP visibility.

After freezing a snapshot, compare every later loaded manifest/watermark to the published
one. If loaded data advances, mark publication stale and automatically enqueue a **new**
immutable snapshot. Never mutate the old prefix or CID. Report partial coverage honestly
while the new snapshot is pending.

## Required continuous status

Every status report must include the run state/revision, provenance digest, stage dependency
states, heartbeat/lease/checkpoint freshness, retry budget, exact next automatic transition,
human blockers and owners, loaded versus published watermark, and whether end-to-end
completion is established.
