# Checkpoint generations and observed changes

Implement these requirements in the target product. The reference service uses
staged index directories and parent-driven promotion; the atomic generation
protocol below is a deliberate generalization, not a claim about that deployment.

## 1. Commit one generation

Use a DynamoDB control item keyed by tenant/environment/source ID. Store only
small references and control fields: committed generation ID + artifact,
pending execution ID, owner/fencing token, lease expiry and delivery state.
Store complete plans, file manifests and checkpoints in S3. Do not use S3 prefix
ordering as the source of truth for committed state.

Implement this protocol:

1. Validate registration, scope and limits, then conditionally reserve the
   execution's request digest and stable `observedAt`. The same execution/digest
   resumes its existing state; different input under that ID fails.
2. For a checkpoint-eligible run, atomically set the pending execution and lease
   only if no other unresolved production execution owns the stream. Pin the
   committed generation in that same control operation. Renew the lease during
   long Glue/delivery work. Carry a monotonically changing fencing token so a
   stale worker cannot publish after a recovery owner takes over.
3. Read only the pinned committed generation; verify its identity, complete file
   manifests, table coverage and compatible schema/hash/policy configuration.
   If it is absent on verified first use, initialize; if it is corrupt or
   inaccessible, fail. Never mix separately discovered record and status indexes.
4. Write candidate record indexes, tracked-state datasets, exact file manifests
   and per-table coverage under a new immutable generation. Verify all counts
   and required outputs, then write its complete `Checkpoint` manifest last.
   No reader sees it merely because the objects exist.
5. Publish `Result.status=EXTRACTED` with a candidate reference. For
   `after_consumer`, remain in `DELIVERY_PENDING` until verified acknowledgement.
   For registered `after_extract`, the successful result is the delivery boundary.
   Samples, subsets and backfills return no production candidate.
6. Authenticate the acknowledgement principal against the configured consumer;
   validate its result URI/digest, source/version, execution ID and successful
   consumer execution evidence. Read/verify the registered consumer's evidence
   interface. Never trust an arbitrary callback object's success flag alone.
   Canonicalize the validated acknowledgement using the request JSON rules and
   write those exact UTF-8 bytes as an immutable artifact. Key acknowledgement
   idempotency by `(tenant, environment, source.id, executionId, consumerId)`;
   do not include the result digest in the key, since changing the result must
   conflict with the existing acknowledgement. Conditionally record its digest
   and artifact only after evidence verification. An identical digest resumes
   or returns the prior commit; different payload bytes after canonicalization
   under the same key fail with `AcknowledgementMismatch`. This binds the result,
   source version, consumer execution and evidence to one verified success.
7. In one conditional DynamoDB transaction, require the expected prior generation,
   pending execution, current fencing token and recorded acknowledgement digest
   for `after_consumer`; set the committed pointer to the
   verified candidate, mark this execution committed and clear its pending lease.
   Publish the `Commit` receipt idempotently. A retry after the transaction repairs
   a missing receipt from the committed control record; it does not rerun extraction.
   Derive the expected generation/candidate from the pending execution record,
   never from callback fields. Preserve the original commit time and acknowledgement
   artifact in the control record for receipt repair. For `after_extract`, require
   the verified result boundary and emit `acknowledgement: null`.

Candidate objects remain immutable; rollback of consumer work is a separate
consumer operation. Do not roll the committed pointer backwards to retry a run.
A failure before commit leaves the old pointer intact and blocks a fresh run
until the pending execution is safely resumed or explicitly abandoned with
consumer effects reconciled. Lease expiry permits recovery of that execution,
not silently skipping its unresolved delivery. TTL cleanup is not a locking rule.

Fence writes through the committer's control-plane identity. Give Spark permission
to write only execution/candidate prefixes, never the committed control pointer.
A scoped test run needs no production lease but must still use unique immutable
paths. Keep lease duration/renewal and job/callback timeouts consistent.

## 2. Coverage and watermark correctness

Track every enabled table in `Checkpoint.coverage`, including an initialized
empty table. Persist record count, schema/projection/hash identities, whether the
latest read was complete and its committed cursor. Preserve cumulative indexes
for incremental windows even when they contain zero current rows.

Do not advance any shared cursor while a required retained-state dataset cannot
advance safely. Never move the normal watermark for a sample, selected-table
read or bounded backfill. An explicitly designed per-table checkpoint mode would
need a separate versioned contract and dependency proof; it is not implicit here.

A source/projection/hash/policy migration requires a compatibility decision:
reuse proven compatible state, migrate it with verified evidence, or perform an
authorized full baseline. New or materially changed extraction/hash columns must
not silently compare against incompatible old hashes and claim ordinary deltas.
Retain enough generations and source-result references to investigate/replay.

## 3. Two different observation policies

A row can appear in an entity bundle because another table changed. Derive
observations from the registered canonical value and its own previous state,
never from output membership, the ordinary row hash or the affected-entity flag.
Canonical queries return the record key columns and `tracked_value`; source-time
policies read the configured timestamp from that same source row. Validate one
canonical result per key. Pin the canonical SQL version and its input columns.

Frame null explicitly when hashing canonical values, so a null value is a known
state and differs from a missing prior record. Store hashes, not unnecessary
business values. Required policy inputs cannot disappear through projection;
missing inputs fail instead of becoming synthetic nulls.

### Transition observation

Store `(record_key:string, value_hash:string)` per policy. Compare with an
explicit prior-row-presence flag. Append a nullable timestamp column to outputs:

| Situation | Output observation |
| --- | --- |
| First baseline, `initialMode=seed` | null; seed state without a fleet-wide event |
| First baseline with registered/requested authoritative initial mode | this run's `observedAt` for every current record |
| Prior state exists; new identity or changed canonical hash | this run's `observedAt` |
| Unchanged value or a row present only through fan-out | null |
| A scoped run that cannot commit its comparison state | null / suppressed |

Use the same `observedAt` across retries of the same execution. Separate runs
that observe A → B → A produce two distinct transition instants. A change that
leaves and returns to A entirely between reads is not detectable from snapshots;
do not claim event-stream completeness.

If a transition-only row is absent from the ordinary affected set, add that
tracked table's row to its output without automatically adding all companions.
Before writing candidate state, assert every promised observation was published.
This prevents a checkpoint from acknowledging an event that never reached a consumer.

### Retained last-change timestamp

Store `(record_key:string, value_hash:string, changed_at:timestamp)` cumulatively.
An unchanged canonical value keeps the prior timestamp even when unrelated
columns change or the row arrives through hydration. A new/changed value uses the
registered source timestamp, or execution time only for a policy explicitly
registered that way. Source-time updates must be nonnull and strictly later than
the prior `changed_at`; a changed value with equal/backward time fails.

Keep identities absent from the current incremental window. Reconcile accepted
hydrated current rows before annotating outputs so new status context cannot
carry a stale retained timestamp. Keep this policy's cumulative state distinct
from the ordinary row index and its extraction-only advancement rules. If
hydration exposes a newer source value, persist that policy state only within
the same successful generation and retain its provenance.

Append the retained timestamp only to the final output projection. Reject a
case-insensitive collision with any reserved output column; never hash a generated
timestamp into the ordinary source row, which would create perpetual changes.
Runtime-disable a supported policy through registration/settings; do not deploy
code merely to turn it on. Enable it with an explicit complete seed/migration and
acceptance evidence, not a hidden reset of existing state.

## 4. Handoff and recovery

Use `Result.datasets[].table/s3Prefix/sparkSchema` to construct Transform's named
inputs. Set Transform `from`/`fromVersion` from `Result.sourceLanguage.id/version`
and select a registered target mapping. Require that source-language schemas
accept the actual output, including registered observation columns. Pin that
consumer request to the immutable Connect result.

On Transform or Persist failure, preserve Connect's result/candidate and old
committed generation. Retry the failed consumer against the same result; do not
rerun JDBC just to repair delivery. Commit only after the configured final
consumer's verified success. If Persist was requested, its completion is distinct
from successful Transform files. A maintained Iceberg snapshot or its refresh
receipt cannot substitute for this consumer acknowledgement.

Classify recovery by phase: resume incomplete materialization only when its
identity can be proven; rerun Spark with pinned inputs under an attempt-specific
output path; retry result reporting without paid data work; retry commit against
the original expected generation. Reject conflicts and stale acknowledgements.
