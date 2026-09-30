---
name: use-neutral-lexicon
description: "Queries bundled neutral lexicon references for exact schema lookup and modeling precedent. Use when Mew must return entity properties, enums, indexes, relationships, lifecycle, identity, or modeling-paradigm patterns without loading full reference files."
disable-model-invocation: true
---

# Use Neutral Lexicon

Use the bundled references as precedent, not as authority over the user's business requirements.

## When to query

Query when at least one condition applies:

- the user asks for an exact or existing entity, class, model, schema, property, enum, index, or relationship
- a proposed entity, association, or event may already have a reusable pattern
- identity, lifecycle, cardinality, or relationship representation is uncertain
- the user supplied an existing model and needs compatibility guidance
- the target modeling paradigm affects the proposed representation
- a core-versus-extension decision needs evidence from prior models

Always query for exact lookup. For design requests, do not query merely to restate concepts already established by the user's use case.

## Lookup routing

- Search the catalog for an exact type before reading a model file.
- Honor an explicitly requested RDF, property-graph, or class-catalog paradigm.
- When no paradigm is specified and the type exists in the property-graph reference, use it by default.
- When the type exists only once elsewhere, use that definition.
- When several non-property-graph definitions differ, return separate paradigm-specific results.
- Never ask for an external repository or file path to answer a bundled lookup.
- Never merge fields from different paradigms into a synthetic “exact” definition.

## Retrieval workflow

1. Resolve `reference/` from this `SKILL.md` location, never from the caller's working directory.
2. Read [`reference/query-examples.md`](reference/query-examples.md) and select the narrowest applicable `jq` recipe.
3. Query `manifest.json` first when the target paradigm matters.
4. Search `catalog.json` for exact type matches before broader keyword matches.
5. For lookup mode, use the complete-but-bounded entity recipe for only the selected type and paradigm.
6. Query one-hop relationships or an individual property only for that selected type.
7. Stop when the retrieved slice answers the modeling question.

Set an absolute reference path before running a recipe:

```bash
REFERENCE_DIR="<absolute path to this skill>/reference"
```

## Modeling-paradigm rules

- For an RDF ontology target, reason in classes, datatype properties, object properties, domain/range, inheritance, and reified resources.
- For a property graph target, reason in vertices, directed edges, vertex/edge properties, association or event vertices, and derived projections.
- For a class/relationship catalog target, reason in classes, JSON-schema-like properties, explicit relationship targets, common patterns, and data-group cardinality.
- Do not mechanically translate an RDF object property into a property-graph edge.
- Do not flatten property-graph lifecycle events into mutable class fields.
- State the target paradigm in compatibility work.

## Context limits

- Never read or print an entire reference JSON file.
- Never use `cat`, unrestricted `jq '.'`, or broad file reads.
- Every query must use `select`, a projected object, and `limit`; never return a complete class, vertex, edge, or catalog.
- Keep each lookup focused on one concept or one-hop relationship neighborhood.
- Do not paste retrieved reference records wholesale into the final answer; extract only the semantic precedent used.

## Neutrality

- Do not identify, infer, or discuss where the bundled references originated.
- Do not expose neutral model IDs or filenames in the user-facing answer.
- Refer to retrieved material only as bundled modeling precedent.
- Do not fetch external repositories or schemas.
- Do not mutate the references.

## Failure behavior

If `jq` or a relevant reference is unavailable, continue from the user's requirements and Mew's core modeling principles. State that compatibility was not verified against bundled precedent only when that limitation materially affects the answer.
