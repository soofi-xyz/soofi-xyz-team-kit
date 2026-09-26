# Direct single-entity evaluation

Use the same model, population definition, predicate interpretation and projection
as batch evaluation. Accept an entity ID and a compatible versioned filter
definition; bind the selector to that ID. Do not let direct invocation silently
widen the selected population or skip required candidate checks.

## Execution and response

Resolve selection/rules/projection artifacts through authorized discovery. Load
compiled artifacts from a version-aware cache, bind the run's evaluation instant,
perform bounded source reads and return the decision plus requested metadata.
Keep direct evaluation outside the batch admission queue while enforcing its own
rate/concurrency and source-load budget. Do not launch full-population preparation
for a single ID or claim it is cheap merely because the input has one identifier.

Return entity/filter identity, evaluation instant, completion timestamp, accepted
status, reason category, latency and optional per-predicate/candidate evidence.
Distinguish missing source entities, entities outside the selector, predicate
rejection and missing required candidates wherever the data interface supports
that distinction. Treat invalid artifacts, non-unique identity, timeout and source
errors as execution errors, not negative business decisions.

Keep accepted candidates separate from all candidates shown in an audit response.
Make projection nullability explicit. Explain whether requested audit output
changes the query or only the response fields.

## Freshness, latency and equivalence

Cache by immutable artifact/model/compiler identity and scope-relevant bindings.
Define invalidation and maximum staleness. Bind time after loading cached compiled
artifacts. Do not cache an eligibility decision indefinitely merely because the
rule code is unchanged; source facts can change.

Set a measured end-to-end budget covering discovery/cache, compilation, source
reads, classification and serialization. Record warm/cold and cache-hit/miss
measurements separately; provisioned concurrency is not evidence of an SLO.
Return errors without letting telemetry failure replace a valid decision.

Verify batch/report and direct responses against the same entity, artifacts,
evaluation instant and controlled source facts. Record source drift where the
service cannot provide snapshot-isolated reads.

## Existing service

The [current evaluator](implementation/single-entity.md) accepts a Debt identifier,
uses phone-oriented classification and has narrower ruleset-selection semantics.
Its `ruleset_id` can be a label rather than a catalog selector. The generic
selector, arbitrary entity type and response fields described here are extension
requirements; do not send them to the existing alias as if already supported.
