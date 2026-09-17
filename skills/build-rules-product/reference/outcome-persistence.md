# Durable Filter outcomes

Every new Filter/Rules implementation must retain a durable, record-level
evaluation outcome. This is an audit and traceability contract, not a metrics
substitute and not permission to mutate source facts.

## Outcome model

Persist one immutable outcome per evaluated entity or candidate. The outcome must
contain:

- a stable outcome identity and idempotency key;
- subject type and stable subject identity;
- logical run/evaluation identity, attempt, evaluation time and adapter/model
  version;
- terminal decision using the vocabulary and semantics defined by the
  implementation's rule/product contract, and a result-artifact reference;
- the effective ruleset and rule artifact versions; and
- for a subject filtered out by rule logic, the concrete filtering rule
  identifier(s) and sufficient bounded evidence to distinguish that outcome from
  unavailable source data or an execution failure.

Do not overwrite an entity, candidate or source mapping to add a rule “stamp.”
Represent the stamp as an immutable outcome/fact linked by stable identifiers.
An input can have one or many applicable failing rules. Persist the full set of
failing rule identifiers for that input; do not invent a primary rule.

Expose a supported read path that can trace a subject outcome to its run,
effective ruleset and filtering rule artifact. Store sensitive evidence only in
authorized artifacts; do not place it in logs or unbounded metric dimensions.

## Fire-and-forget delivery

Keep Filter evaluation and outcome persistence separate:

1. Write the immutable result artifact and a versioned outcome manifest.
2. Fire-and-forget an `outcomes-ready` event that identifies that manifest.
3. Route the event through the approved Event → Queue path.
4. Have a bounded queue worker persist outcomes in batches through the supported
   persistence interface.

The Filter producer must not wait for queue admission or persistence completion,
and it does not keep an outbox or dispatch-reconciliation state. Make worker
writes idempotent across duplicate events, retries and redrives. The downstream
queue and worker own retry, DLQ and redrive handling.

Return evaluation status separately from outcome-persistence status. A successful
Filter evaluation does not prove persistence has finished. Report planned,
queued, persisted, duplicate, failed and DLQ counts, and only claim traceability
after the persisted outcome can be read back.

## Performance and verification

Do not synchronously persist one outcome per record in the Filter critical path.
The event/manifest handoff must be bounded, and persistence must batch in the
asynchronous worker. Before release, compare representative equivalent Filter
runs before and after the change, including decision equivalence, Filter phase
latency, throughput, data size/fan-out and cache state. Attribute asynchronous
queue and persistence time separately; define the no-regression threshold before
testing and reject a Filter-phase regression beyond its measurement tolerance.

Verify at least:

1. Subjects spanning the implementation's defined decision values each produce
   durable outcomes.
2. A subject filtered out by rule logic reads back with its exact filtering rule
   identifier and artifact version.
3. Source-unavailable and execution-failure cases do not acquire false rule
   attribution.
4. Duplicate event delivery and replay do not duplicate logical outcomes.
5. Queue, worker and DLQ failures remain observable and recover through the
   documented downstream path.
