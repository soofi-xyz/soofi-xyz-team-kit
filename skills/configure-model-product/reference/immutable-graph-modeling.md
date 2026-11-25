# Modeling for Persist's immutable graph

Persist never changes a vertex or edge (prismteam-ai/persist `3fe715f`, #528,
2026-11-23; its `AGENTS.md` "Graph immutability"):

- A vertex id is a hash of its label and every property; an edge id is a hash of
  its label, endpoints and properties. Resending identical content creates
  nothing. Any different property value is a new vertex beside the old one.
- Writes only create. Ingest never replaces or drops a property.
- Applying a lexicon refuses any `identity` other than
  `{"strategy": "contentHash"}`.
- Every ingest needs at least two vertices joined by a declared edge. A vertex
  sent alone is refused (`IsolatedVertex`), write-guarded labels included.

Apply every rule below to each vertex and edge type you propose, review or
return. If a requested change needs an in-place update, a key or a lone vertex,
reject or rewrite it and say which rule it breaks.

## Rules

1. **Roots hold identity only.** A root vertex has only its stable identifier,
   plus its parent's identifier when it has one. Every property is required and
   none of them ever changes. The writer resends the root unchanged with every
   change, and it hashes to the same vertex. Keep PII out of roots and out of
   identifiers.
2. **Everything that changes goes on append-only version or event vertices.**
   Use `<root>_version` when the writer publishes the subject's whole state,
   and `<root>_event` with an `event_type` and only the new values when it
   publishes one change. Repeat the root's identifier on each version or
   event, so two subjects with identical states never hash to one vertex.
   Write each one once and never edit it.
3. **Status changes, renames and deletions are new facts.** A status change or
   rename is a new version or event. A removal is a version with status
   `removed` or a `REMOVED` event, never a deletion or an edit. Use `allOf`
   `if`/`then`/`else` to require or forbid fields per status, for example no
   email on a removed version.
4. **Order by business time.** Declare a required `effective_at`
   (`format: date-time`) that the writer stamps when a published field changes,
   in UTC with milliseconds and a literal `Z` (`2026-11-25T08:15:00.000Z`), so
   string order is time order. It is not a wall-clock `updated_at` stamped at
   send time: a resend of an unchanged state must carry the same `effective_at`,
   or it adds a duplicate version. Never declare or order by `created_at`.
   Persist sets it at insert, so it reflects when a version arrived, not when it
   happened, and a replay or backfill gets a new one.
5. **Break ties by vertex id.** The current state is the latest version by
   `effective_at`, with ties broken by the version's vertex id
   (`order().by('effective_at', desc).by(id, desc)`). Pick one direction,
   state it in the extension README, and use it in every reader and index.
6. **Derive current values with Persist indexes.** Declare each current value
   (`current_status`, `current_name` and so on) as an index on the root.
   Trigger it on the root vertex and on the has-version or has-event edge, with
   a `subject_query` that returns the root. Make the `value_query` recompute the
   value from the whole history using that ordering; never copy the value from
   the version that triggered it. When the latest version has no value, such as
   the email of a removed user, the query returns nothing and Persist drops the
   property, which clears it. Access's `current_email` on `access_user`:
   `g.V(__ID__).out('access_user_has_access_user_version').order().by('effective_at', desc).by(id, desc).limit(1).values('email')`.
   Writers never send index properties.
7. **Keep edges free of properties where possible.** Link each root to its
   versions with a property-free edge such as `<root>_has_<root>_version`, and
   keep the facts on vertices, where `allOf` validates them and edges can point
   at them. An identical resend of a property-free edge lands on the same
   edge. Give an edge properties only when the fact really belongs to the link.
8. **Never send a vertex alone (`IsolatedVertex`).** Each write sends the root,
   the new version or event and the edge joining them. Do not design a type
   that a writer would ever send without an edge.
9. **Never use keyed identity.** Never declare
   `{"strategy": "properties"}` and never describe a record as "one per key,
   updated in place". A write guard decides who may write a label; it does not
   make a keyed or mutable vertex acceptable. Model's vertex schema requires an
   `identity`, so declare `{"strategy": "contentHash"}`; the compiled Persist
   lexicon then carries no `identity`.
10. **Old values are kept forever.** Every version keeps its values, including
    old emails and names, after a later version replaces or removes them. Say
    so in the extension README. A data-erasure request is an operator cleanup
    that deletes that subject's version or event vertices. Accept this; do not
    add mutable fields or keyed records to avoid it.

## Examples in `prismteam-ai/model`

- `configurations/access/`: identity-only roots `access_user { user_id }` and
  `access_group { role_id }`, with append-only `access_user_version`
  (`user_id`, `status`, `email` unless removed, `effective_at`) and
  `access_group_version` (`role_id`, `status`, `name` unless removed,
  `effective_at`). Property-free edges `access_user_has_access_user_version`
  and `access_group_has_access_group_version` join them. Derived indexes:
  `current_status` and `current_email` on `access_user`, `current_status` and
  `current_name` on `access_group`. Each index triggers on the root and on the
  has-version edge, has no `absent_value`, and clears the email or name when
  the latest version is removed. Every label is write-guarded with
  `persist:access-plane:write`; the guard restricts who writes, not identity.
- `configurations/system/`: `system_issue` holds only facts that never change.
  Its status changes are append-only, and `current_status` and `resolved_at` are
  derived indexes, so writers never send them.
- `configurations/delivery-planning/`, section "How it stays immutable":
  entities hold identity only, event streams carry `effective_at`, and nothing
  is deleted. It follows the base's `work_task` → `work_task_event` pattern.
- `configurations/inference/`: `assertion.status` is the latest
  `assertion_outcome` by `decided_at`, derived by Persist.
