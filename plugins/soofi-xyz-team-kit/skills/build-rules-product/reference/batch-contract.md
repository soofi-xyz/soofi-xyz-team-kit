# Generic batch contract

Treat the fields below as conceptual requirements. Translate them through a
supported adapter; use the [current Filter inputs](implementation/batch-contract.md)
when invoking the existing service.

## Run inputs

| Input | Required meaning |
| --- | --- |
| Entity definition | Type, stable identity and compatible model/adapter version |
| Entity selection | Versioned query plus validated bindings and authorized data scope |
| Population source | Execute selection, reuse a valid materialization, or restrict it with supplied IDs |
| Rule selection | Explicit governed artifacts or catalog/context resolution; pin the effective versions |
| Candidate requirements | Optional related scopes and their pass/absence semantics |
| Evaluation context | One evaluation instant, applicable timezone and declared consumer metadata |
| Projection | Requested entity/candidate metadata with type and nullability definitions |
| Report mode | Decision-only filtering or complete per-predicate evidence |
| Execution policy | Bounded partitions, admission, retry and partial-result policy |
| Publication | Explicit optional output-consumer contract; default to producing result artifacts |
| Outcome persistence | Required immutable per-record outcomes, effective rule attribution, versioned manifest and asynchronous Event → Queue delivery contract |

Reject invalid selection, incompatible scopes or unresolved rule artifacts before
costly population evaluation. Partition normalized unique IDs and preserve run
identity across retries. A supplied population does not replace the selection
definition; follow [entity selection](entity-selection.md) for provenance checks.

## Result envelope and projection

Return a run identifier, selection/rules/model identities, evaluation context,
completion status, counts and locations of immutable result/report artifacts.
Return accepted entities with their stable IDs and configured metadata. For
candidate scopes, return only passing candidates; keep rejected candidates in
audit output where requested. Document nullability and source provenance.

An illustrative result shape, not a deployed API:

```json
{
  "entity_id": "E1",
  "accepted": true,
  "attributes": {},
  "candidates": { "related_scope": [{ "candidate_id": "C1", "attributes": {} }] }
}
```

Debt can be an example projection containing its identifier and additional
entity/relationship metadata. Make those fields adapter choices. Do not restrict
the product's output to IDs, bake in consumer scores, or require a communication
data shape. An ID-only CSV and richer JSON can be separate explicit projections.

Keep returned artifact URIs authoritative; consumers must not reconstruct storage
keys. Carry output-schema version, result completeness and freshness evidence to
the consumer. An accepted result is not proof of a downstream action.

Every evaluated entity or candidate must also have a durable outcome that can be
traced to its effective rule artifacts. Keep the outcome-record contract,
asynchronous delivery status and replay semantics separate from the result
projection; see [outcome persistence](outcome-persistence.md).

## Counts and report interpretation

Expose raw selected rows, normalized unique IDs, duplicates, processed IDs,
accepted, rejected, source-missing, execution-error and unfinished counts where
observable. Reconcile unique selected entities into disjoint terminal categories;
never count a transport/query failure as a business rejection.

Report mode must distinguish an entity absent from the source from one rejected
by predicates/candidate requirements. If fast filter mode removes those rows
before it can distinguish reasons, explicitly mark the explanation unavailable.
Do not report unmeasured reasons as zero.

Per-predicate failure counts may overlap. State whether each count concerns entity
failures, failed candidates, or entities for which every candidate fails a given
predicate. Those are different measures and need not sum to rejected entities.
An entity can be rejected because no candidate passes all predicates even though
no single predicate fails every candidate. See the
[worked verification case](verification.md#worked-example-with-abstract-predicates).

## Completion and retries

Track each partition's status and artifact identity. Aggregate only complete,
validated parts and expose failed/unfinished partition counts. If tolerated failures
allow workflow success, report the population as partial. Do not let a downstream
consumer interpret success status alone as a complete selection.

Make partition writes and aggregation idempotent under replay. Retain successful
parts on a failed-partition retry, account for redriven capacity, and distinguish
result creation from any asynchronous publication result. See
[operations](execution-and-operations.md).
