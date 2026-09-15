# Product and boundaries

## Product contract

Build Rule Filter as a reusable evaluator over an explicitly selected population.
Require an **entity-selection query** in every filter definition. Execute or reuse
its materialized result to establish the entities that the rules will evaluate.
Keep selection, evaluation and output projection identifiable so a caller can
explain where an entity came from, why it passed, and which metadata was returned.

```text
Governed entity model + entity-selection query + rule artifacts + run context
  → selected entity IDs (optionally materialized and reused)
  → bounded rule evaluation against source facts
  → accepted entities + requested metadata + reports
  → downstream workflow, solver or optional result publisher
```

Use Debt as an example of the entity at the center of this flow. An entity may
have related candidates, but the product must also support entity-only filtering.
Do not require phone, email, a particular campaign, or a particular predicate in
the generic contract. Read [entity selection](entity-selection.md) before designing
an integration and the [implementation baseline](implementation/PRD.md) before
invoking the existing service.

## Ownership

| Owner | Responsibility |
| --- | --- |
| Gallade / Rule Filter | Selection contract and execution, rule compilation/evaluation, projection, snapshots, admission, artifacts, decision evidence and optional publication orchestration |
| Lexicon / model owner | Entity vocabulary, relationships, rule definitions and versions, mapping artifacts and approval/publication of those artifacts |
| Translate / ingestion workflows | Execute source mappings and deliver data; report completion and source identity |
| Persist | Validate, store and query graph facts; own storage access, graph identity and data-ready evidence |
| Caller / downstream consumer | Choose the intended population and policy, consume results, and set freshness requirements for its action |
| Solver / communication runtime | Score, prioritize, allocate resources and schedule or execute downstream actions |

Read [Lexicon ownership](../../build-lexicon-product/reference/PRD.md#11-mission)
for shared schema/mapping artifacts. Use Persist's public interface for graph reads
and writes. Keep rule authoring/governance in Lexicon; this documentation describes
the evaluation mechanism and contains no catalog of specific business rules.

## Agent coordination

- Use Conkeldurr for separate Persist/Lexicon/platform changes.
- Use Machamp for batch execution, recovery and load management.
- Use Porygon for metric definitions and reconciliation.
- Use Xatu and Oranguru for communication audience and runtime handoffs; use Abra
  for solver design. See [consumer boundaries](performance-and-consumers.md).
- Use Regigigas for marketplace packaging and tenant installation.
- Start with Arceus when product ownership is unknown. Keep newly learned generic
  contracts here; keep customer configuration in its owning repository.

## Reuse and invocation

Expose batch and direct single-entity contracts through authorized service
interfaces. Reuse the same selection identity, rule versions, evaluation semantics
and projection definition across both modes. An IAM-protected workflow/function
is a valid interface; a generic product does not require a public REST API.

Return point-in-time eligibility and evidence. Passing does not mean an entity was
scheduled, delivered, written back or acted on. Explicitly identify any additional
publication stage and its independent outcome. Never turn an evaluation request
into permission to execute the consumer's action.
