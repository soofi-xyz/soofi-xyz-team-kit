# Entity model, relationships and versions

## Model and data ownership

Use the governed model to define entity types, stable identifiers, relationship
labels/directions, property types and candidate cardinality. Lexicon publishes
model and source-mapping artifacts; ingestion/Translate execute those mappings;
Persist validates and stores facts. Rule Filter selects and evaluates entities
through Persist without taking ownership of source transformation or storage.

As a structural example, a Debt entity can relate to a Person, which can relate to
several contact candidates. The actual query must use the published edge directions
and labels; a diagram's reading order does not establish traversal direction.
Preserve whether a fact belongs to an entity, a candidate, or their relationship.
A candidate shared by two entities may have different relationship-scoped facts.

For a new entity type, require an adapter defining:

- the root and stable identity lookup used by its selection and evaluation queries;
- allowed relationships, candidate scopes and their quantifiers;
- current/historical status resolution, ordering and missing-data semantics;
- supported predicate syntax and output projection;
- model compatibility and version selection.

Reject ambiguous identity or unsupported traversal shapes. Do not infer arbitrary
entity support from the ability to parse a query string.

## Immutable facts and changing state

Preserve historical facts through the data service's event/version model. Derive
current state using its documented effective time, revision and tie-breaking rules.
Do not equate the most recently ingested record with the latest effective fact
unless the model defines that equivalence.

A corrected graph representation may use a new version while retaining older
entities or events. Queries must select the intended representation and prevent
double counting. A version suffix by itself does not explain why a correction was
needed; read its model change/migration record before claiming that history.
Keep tenant-specific migration stories outside the generic product contract.

| Version or identity | Meaning |
| --- | --- |
| Model/schema version | Meaning of labels, relationships, identity and properties |
| Entity/fact version | A particular representation or observation under that model |
| Source/graph cycle | Data readiness or visibility boundary |
| Selection query version | Definition of the input population |
| Ruleset and compiler versions | Predicates selected and how they are executed |
| Snapshot generation | A materialized population for a selection/data identity |

Carry these identities separately. A new ruleset version does not imply new source
data, and a refreshed ID snapshot does not guarantee historical fact isolation.

## Derived indexes

Use governed derived properties/indexes to avoid repeated expensive traversal
where they preserve semantics. Record their source facts, refresh trigger,
effective-time meaning and lag policy. An index is an acceleration mechanism;
its presence does not change the intended predicate.

Verify indexed and traversal-based evaluation on the same fixtures, including
missing, stale, multi-version and out-of-order data. Coordinate index changes with
the model/Persist owners and measure the affected query before claiming a speedup.
See [performance](performance-and-consumers.md) and
[Lexicon's model principles](../../build-lexicon-product/reference/PRD.md#20-architectural-principles).
