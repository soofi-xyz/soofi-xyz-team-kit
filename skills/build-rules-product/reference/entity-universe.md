# Selected entity universes and freshness

## Why materialize a population

Execute the [entity-selection query](entity-selection.md), normalize its stable
IDs, and materialize bounded partitions when repeated runs would otherwise repeat
expensive discovery. Several consumers may reuse a compatible population while
applying different rules. Cache the selected IDs separately from evaluated facts
and decisions; population reuse does not make eligibility results current forever.

Record immutable query/version/bindings, entity/model/adapter version, authorized
scope, source-cycle identity, selected count, generation time and expiry in the
manifest. Include every value that changes membership or visibility in its cache
key. Never reuse across tenants/scopes or changed selectors because entity types
happen to match.

## Refresh contract

Define readiness using the source owner's authoritative data-ready event/revision.
Support eager generation after readiness and lazy generation on first consumption.
Record the actual signal and observed time; do not bake in “overnight,” “daily,”
or a fixed local clock as a product invariant. Debt's daily graph update is one
possible deployment pattern.

Reuse only a complete, unexpired generation that matches the current required
source/selection identity. Recheck identity when publishing and consuming it.
If the source or selector advances during generation, supersede the old result
and regenerate. A storage-retention period does not authorize stale consumption.
If intraday membership may change, configure event-driven invalidation or an
explicit maximum-staleness policy; do not assume new entities cannot arrive.

Read current facts during evaluation unless the data interface explicitly offers
a pinned snapshot. Reusing IDs does not freeze relationship/status metadata, and
pinning a graph-cycle label does not prove transactionally consistent reads.
Document the required source visibility for repeatable decisions.

## Concurrency and recovery

Use a single generation lease per population identity, heartbeat it, and let
concurrent consumers wait for the same generation. Publish a completion marker
only after every partition and manifest is valid. Recover abandoned leases using
bounded timeout and ownership checks. Distinguish lease loss, supersession and
transient infrastructure failure so valid generations are not falsely failed.

Keep generation prefixes immutable and retries idempotent. Bound waiting and
regeneration; return explicit unavailable/incomplete state after exhaustion.
Provision safe defaults and runtime-operable activation with rollback. Record
effective settings rather than inferring them from CI configuration.

The [current Debt snapshot implementation](implementation/debt-universe.md)
implements several of these lifecycle safeguards, but its identity and activation
remain domain-specific. A generic selector requires a generalized cache identity
and provenance contract; it cannot safely reuse that singleton unchanged.
