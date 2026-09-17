# Worked ingestion case and acceptance gates

Implement these tests in the target repository. The skill supplies synthetic
configuration/data and expected results, not a runtime or test harness. Validate
[the contract definitions](contracts.md), then execute real Spark behavior.

## 1. Primary two-run case

Use [source.json](examples/config/source.json), its pinned projection/dependencies,
and [primary-case.json](examples/primary-case.json). Treat `before` and `after`
as the source's complete current state at two instants. Materialize registered
Spark types, including timestamp and long fields, without schema inference.

The source has four records, four contacts, two organizations, two assignments
and one initial event. A contact links directly to a record. An organization
links through the full `assignments` table. Records can name one outgoing primary
record. Contacts/events have timestamp windows; root/bridge/organization tables
are full reads. Events deliberately emit only their loaded window.

### Baseline

Run [baseline-request.json](examples/baseline-request.json) with observed time
`2026-01-01T12:00:00Z`. All 13 input records are new, all four root entities are
affected, and each table's full registered in-scope data is output. Seed the
transition policy without publishing observations. Stage, but do not commit, the
candidate until the isolated test consumer acknowledges that exact result.

Assert all table coverage entries are initialized and the committed generation
contains the 13-record index after acknowledgement. Before acknowledgement the
previous committed pointer stays unchanged. Block a new production execution
while delivery is pending.

### Delta

Change contact `C1`'s email, change organization `O1`'s name, and add event `2` for
`R3`, exactly as the `after` fixture specifies. Run
[delta-request.json](examples/delta-request.json) at `2026-01-02T12:00:00Z`.

Assert exact identities, not only counts:

| Observation | Expected result |
| --- | --- |
| Changed records | `contacts/C1`, `organizations/O1`, `events/2` — total 3 |
| Direct affected entities | `R1`, `R3` — total 2 |
| After one outgoing hop | `R1`, `R2`, `R3` — total 3 |
| Excluded entity | `R4`; do not recursively follow `R2 → R4` |
| Records output | `R1`, `R2`, `R3` |
| Contacts output | `C1`, `C2`, `C3`; unchanged C2/C3 must arrive through bounded hydration |
| Organizations output | `O1` |
| Assignments output | `A1` |
| Events output | only `2`; event `1` stays outside the loaded window despite R1 being affected |
| Total emitted rows | 9 across five separate datasets |
| Transition observations | 0; all canonical root status values are unchanged |
| Candidate index counts | records 4, contacts 4, organizations 2, assignments 2, events 2 — total 14 |

Retain C4 in the cumulative contact index without emitting it. Preserve event 1
in the cumulative event index without hydrating its history. Verify all values,
registered column types and nullable output observation timestamps. Sorting tiny
test fixtures for comparison is allowed; global output order is not guaranteed.
Keep changed, hydrated, affected and emitted counters distinct.

Fail the test consumer once: extraction artifacts remain valid, generation 1
stays committed and a fresh run is blocked. Resume delivery against the same
result; then a correct acknowledgement promotes all candidate state together.
Duplicate acknowledgement returns the same commit. Wrong result digest, consumer,
source, execution, prior generation or fencing token must fail.

## 2. Extraction and configuration cases

- Third run with no source changes: zero changed/affected/output rows, readable
  typed empty outputs, cumulative indexes remain 14 rows and empty windows do
  not cause baseline rediscovery.
- A newly registered empty table: explicit initialized coverage and zero rows;
  its next run must not infer first use from an empty index.
- A second source registration with renamed tables/entity/key columns and
  equivalent policies: identical behavior with configuration changes only.
- Another direct link and bridge with multiple memberships: changing the shared
  record affects every currently linked in-scope root. Unlinked/outside-scope
  entities remain excluded.
- Projection adds a business field: fetch it together with operational columns;
  require a compatible hash migration/baseline decision, not silent hash storms.
- Missing/empty projection, mismatched dependency revision, unknown logical table,
  invalid query/identifier, missing tracked input or unsafe exclusion: reject
  before source scans or output publication.
- Null/duplicate keys, incompatible types and corrupt schemas: fail explicitly;
  no arbitrary record deduplication or empty-string identity.
- SQL uses native key bounds under chunking, preserves source predicates, and
  never drops them above a driver threshold. Actual concurrent JDBC reads stay
  under the configured source connection budget. Partition stride bounds do not
  substitute for source WHERE bounds.
- Empty incremental window preserves history; first table read is complete;
  backfill boundaries include the lower instant and exclude the upper instant.
- Timestamp baseline, including an empty one, seeds the cursor with the pinned
  observation instant. Each window uses prior cursor minus overlap through the
  new observation instant with an exclusive upper boundary; empty windows still
  advance on commit. Reject missing initialized cursors and nonadvancing bounds.
- Source row deletion: no deletion event in this contract. A verified full
  snapshot baseline removes the row; do not claim incremental delete support.

Use a real PostgreSQL test database for JDBC projection/predicate/linkage tests,
with an isolated synthetic schema and source-query evidence. File-backed Spark
fixtures alone cannot certify JDBC pushdown, snapshot consistency or credentials.

## 3. Observation and checkpoint cases

- Unrelated row update and fan-out-only presence create no transition observation.
- With a committed status baseline, R1 changes OPEN → CLOSED → OPEN across two
  separate runs: publish two distinct nonnull observed instants. Same execution
  retry reproduces the same instant. A collapsed between-read change is not
  claimed as detected.
- Bootstrap seeds without events; authoritative initial mode deliberately emits
  all initial observations. Add observation-only rows before advancing their state.
- Retained-value unchanged → keep its prior `changed_at`; changed source value →
  require a later source timestamp. Reject null/equal/backward times on change.
- Hydrated current retained values reconcile before annotation; generated output
  columns never alter ordinary hashes. Reserved-column collisions fail.
- Sample, subset and date-backfill runs cannot move shared cursors/tracked state.
  A policy whose state cannot advance blocks shared generation advancement.
- Incomplete newest generation, wrong file digest/count, checkpoint-read failure
  and incompatible hash/projection version fail; none means “first run”.
- Two concurrent production starts have one owner. Expired/stale owners cannot
  commit; recovery retains the pending execution rather than skipping delivery.
- Failure after candidate write, after consumer success, during conditional
  commit and after commit-before-receipt all recover without mixed generations
  or duplicate extraction/consumer effects.
- Reordered acknowledgement object keys produce the same canonical digest and
  commit. Changed result/evidence/consumer execution under the same idempotency
  key fails. Duplicate JSON object keys fail parsing. Receipt repair preserves
  the original acknowledgement artifact and commit time.

## 4. Context, samples and Iceberg

- Register a latest-context policy with two categories. Load many historical rows
  and assert at most one deterministic latest row per category/entity, plus only
  explicitly allowed current events. Never replay all history through hydration.
- An exact complete snapshot/ledger match uses the pinned snapshot ID. Missing or
  incompatible provenance uses bounded JDBC; access/corruption failures surface.
- Materialized sample preserves its old projection and reports unavailable new
  fields. A live JDBC sample exercises added candidate fields using the same
  exclusions and operational columns as normal extraction.
- Explicit invalid/null/blank/unreadable projection override fails without a
  fallback. A valid override records its real digest. Sampling IDs are fixed on
  retry; requests above the bound fail before a full scan.
- Samples cannot authorize a production commit, replace a full snapshot or be
  misreported as observed production transitions.
- Against real Iceberg, verify baseline, empty-baseline replacement, nonempty and
  empty delta, deterministic duplicate handling, older-run version guard,
  compatible additive schema change and incompatible narrowing rejection.
- Verify an omitted delta field preserves the old matched value, a delta cannot
  create an uninitialized table, missed events replay, and concurrent refresh
  workflows respect the global lease.
- Failure after one table commit but before final receipt must replay safely.
  Required-table failures/awaiting-baseline cannot publish a complete receipt or
  advance the complete-result watermark. Preserve snapshots pinned by readers.

## 5. Infrastructure and evidence

Assert synthesized Standard workflows and the exact plan/schema/digest arguments,
separate extraction and commit entry points, scoped roles, conditional state
updates, bounded source/job concurrency, no automatic paid-work replay and runtime
activation controls. Assert snapshot jobs have no JDBC secret/network grants.
Verify failure/timeout/delivery-lag/snapshot-lag and applicable DLQ alarm/recovery
wiring through the shared observability contracts.

Record target revision and toolchain; command exits; request/config/plan/result
digests; exact expected/actual identities and counts; previous/candidate/committed
generations; rejected-case error codes/phases; and decoded output comparisons.
Store test data/evidence in the target test workspace, not this plugin's skill.

For a live bounded pilot, also record verified account/region, deployed job/script
identity, actual source read scope and plan, workflow/job IDs, consumer execution
and acknowledgement, committed generation and snapshot receipt when requested.
Check an intentional consumer failure before the successful commit. Report source
consistency limits explicitly. Local tests and CDK synthesis are separate claims
from live execution and downstream readback.
