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
- Atlas publication readiness: upload-node credential availability, Atlas repository
  access, county-page path, PR state, global index CID, and last published watermark;
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

- Intake launches source/jurisdiction enumeration, adapter determination/build,
  identity-registry route proof, execution and internal-destination proof, upload-node and
  Atlas-PR readiness, and blocker routing in parallel. Adapter build is not permit harvest.
- After appraisal/transform readiness, enqueue identity-baseline load. Sunbiz comes
  first: stamp each company with a GET of `search.sunbiz.org` by document number, not
  the bulk download page. Then enqueue `dbpr-license-ingest`. A printed permit license
  number, person name, and company name are DBPR search keys only. Persist company,
  person, and license from the DBPR license-detail record. If DBPR returns no match,
  write no contractor, person, or license. Do not persist those records copied from
  the permit. Map a match with `property_improvement_has_contractor`
  (`property_improvement` → `company`), `contractor_has_license` (`company` →
  `license`, `license_identifier` on class `license`), and `contractor_has_person`
  (`company` → `person`, `first_name` and `last_name`; no license field on the
  person). Relationship objects are only `from` and `to`. Do not enqueue `PermitFeed`
  for historical qualification of permits that omit a license number until the
  public-records relationship extract is adequate. That extract does not block
  reading permits that already print a license number. Schema gaps after loading
  supported tables do not skip acquisition.
- Readiness `PASS` enqueues the next dependency-ready seed/pilot/run stages automatically.
- A capture handoff enqueues transform/validation; a valid transform handoff enqueues
  idempotent load/match; a reconciled load advances the loaded watermark and enqueues the
  CAR/table/Atlas-PR preparation sequence.
- A readiness block prevents seed, pilots, adapter scale-out, and full ingestion, but keeps
  bounded enumeration, adapter implementation/fixtures, access remediation, records-request
  preparation, and publication readiness active.
- Public publication requires the authorized Atlas scope and any required privacy approval.
  Once authorized, continue through CLI upload/readback, Atlas PR, merge wait, global IPNS,
  and MCP sync without inventing a second publisher.

## Completion and snapshot drift

Set `COMPLETE` only when the requested scope has:

1. terminal source enumeration and capture checkpoints;
2. reconciled, idempotently loaded Neon rows with linked and valid-unlinked counts;
3. validated lexicon groups and one validated CAR per data group;
4. CLI-exported normalized table roots;
5. archive/table upload with remote CID readback;
6. merged Atlas county page and verified global Atlas IPNS; and
7. successful MCP sync, `listAtlasCounties`, `getAtlasDatasetInfo`, and representative
   scoped `queryAtlas` checks.

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
