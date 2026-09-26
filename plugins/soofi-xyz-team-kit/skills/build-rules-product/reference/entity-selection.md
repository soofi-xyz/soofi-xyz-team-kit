# Entity-selection query

## Required definition

Require a query that selects **the entities to be filtered**. Define the entity
type, stable identifier, query artifact/version, bound parameters and authorized
data scope before loading evaluation rules. Population selection answers “which
entities enter this run?”; rule evaluation answers “which selected entities pass?”
Output projection answers “what data should accompany those results?”

Use a versioned query reference plus validated bindings, or a reviewed query body
whose digest is recorded. These are alternative representations of the same
required selector. Do not rely on an implicit scan of a particular entity type.

Conceptual configuration, not the existing service's request schema:

```json
{
  "entity_type": "example_entity",
  "identity_field": "entity_id",
  "selection": {
    "query_ref": "<authorized-query-artifact>",
    "query_version": "<immutable-version>",
    "bindings": {}
  },
  "ruleset_refs": ["<authorized-ruleset-artifact>"],
  "projection_ref": "<output-projection-artifact>"
}
```

As an example, a Debt adapter can select identifiers with this read-only Gremlin
query through Persist:

```groovy
g.V().hasLabel('debt').values('debt_identifier').dedup()
```

This selects a population; it is not a business rule. Other entity types require
their own model, identifier and supported adapter/query. Never change only the
label and assume the existing compiler supports that type.

## Query result contract

- Return stable, non-blank identifiers for the declared entity type; normalize
  them into `entity_id` at the generic boundary. Preserve identity types without
  lossy coercion and reject ambiguous or cross-type matches.
- Deduplicate identifiers before partitioning and record raw/duplicate counts.
  Ensure pagination/sharding produces a complete population without omissions or
  duplicate evaluation. Use stable pagination or a materialized query result.
- Bound execution time, result size, page size and concurrency. Treat a truncated
  query result or failed page as incomplete, not a successful smaller population.
- Record selector version/digest, normalized bindings, entity/model version,
  authorized scope, data-ready/source identity, selected count and selection time.
- Accept a successfully completed empty selection as a valid zero-entity run.
  Distinguish it from a missing query, malformed response, timeout or access error.

Execute only read operations through the authorized data interface. Bind and
escape values through its supported query builder; do not concatenate identifiers
or grant broader data access because a caller supplied a query. Validate query
compatibility with the selected adapter before any full-population work.

## Materialized and caller-supplied populations

Allow a snapshot or caller artifact to carry a materialized selector result.
Require provenance tying it to the selection definition and scope, and apply the
[freshness contract](entity-universe.md). Reusing it skips query execution, not the
requirement to define what population it represents.

Allow an explicit ID list to restrict the selected population. Validate membership
or require trusted materialization evidence; a supplied list must not silently
enlarge the selector's authorized domain. For direct evaluation, constrain the
same selector by the requested ID and distinguish absent entities from existing
entities outside the selected population when the data contract supports that.

## Existing implementation boundary

The inspected Filter service has a hardcoded all-Debt discovery query and accepts
CSV/Parquet `debt_id` populations through `input_s3_uri`. It does not expose the
generic selection fields above, validate generic selector provenance for those
legacy inputs, or support arbitrary entity roots. Its discovery query also does
not contain the illustrative `dedup()` above. Preserve the legacy input contract
while implementing selector configuration, identity normalization, deduplication,
membership/provenance checks and adapters as a compatible extension.

See the [current batch contract](implementation/batch-contract.md) and
[generalization gaps](implementation/known-gaps.md#generic-product-extension).
