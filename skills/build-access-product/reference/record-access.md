# Record access through resource sharing

Use this reference to build the `record-access` piece. It is a build
specification, not evidence of deployed behavior. Discover the target
revisions of Access, Persist and Model before relying on any part of it.

Record access is not a second grant API. A Persist anchor record is a resource
like any other: Persist declares a resource type for each anchor record type,
with one shareable action on one resource, and a share of that action with a
user or a role is the connection. Access then writes the matching grant edge
into Persist, and removes it when the share goes.

For example, a demo shows company B's logo to company B's signed-in people:

1. Persist declares `company` with the shareable action `read` on one resource.
2. The environment registers the company record as an environment-owned
   resource: `PUT /resources/persist/company/<company vertex id>` with
   `{"owner": {"kind": "environment"}}`.
3. An administrator, or the environment, shares `read` with the company's demo
   role: `POST /resources/persist/company/<company vertex id>/grants` with
   `{"grantee": {"kind": "role", "id": "<role id>"}, "action": "read"}`.
4. Access writes the edge `access_group_can_access` from that role's group
   record to the company record. Everyone whose token carries the role reads
   the company record, and what lies beneath it, through Persist's GraphQL.
5. Revoking the grant, removing the registration, deleting the role or removing
   the user removes the edge.

## Anchors

Each anchor is one entry in a fixed map in the Access repository, beside the
user and group record types. The labels are Model's decisions; Access reads
them and never invents one.

| Access resource type | Edge action | Anchor label | Edge from a user record | Edge from a group record |
| --- | --- | --- | --- | --- |
| `persist:company` | `read` | `company` | `access_user_can_access` | `access_group_can_access` |
| `persist:fixture-scope` (fixture only) | `read` | `fixture_scope` | `fixture_can_access` | `fixture_can_access` |

- A resource type name cannot hold `_`, so the map names the anchor label for
  each type rather than deriving it.
- Only a share of the edge action carries an edge. A share of any other action
  on the same type, or any share on a type outside the map, writes nothing to
  Persist.
- The edge follows the share record: it exists while a share of the edge action
  is on record and goes when the share goes. A declaration that later stops
  making `read` shareable leaves the share on record, as every share is, and its
  edge with it; revoke the share to take the access away.
- The anchor's owner is the environment. Who may share, list and revoke is the
  existing rule for an environment-owned resource: a holder of
  `access:resource:share`, which administrators and the environment key hold.

## The resource identifier

The resource identifier is the anchor record's Persist vertex id: the 64
lowercase hex characters Persist names the record by. Access never derives it
from the record's fields, and sends it to Persist as given. Persist checks that
a record of the anchor label has that id before it writes the edge.

The grantee's end is the keyed record Access publishes for that user or role.
Access computes its id exactly as Persist does for a keyed record: the SHA-256,
in lower-case hex, of the UTF-8 text

```text
{"identity":"properties","key":{"<key property>":["<id>"]},"label":"<label>"}
```

with no white space, `<key property>` `user_id` for `access_user` and `role_id`
for `access_group`. Keep a test pinning one value computed by Persist's own
code, for example role `86041562-51d2-49c1-91e9-aac8331ad0f2` as `access_group`
→ `580a01d60bd4d74c0c836894fe5b382d49ce68e4648eba34e2494f2c7571a4ba`.

## Writing an edge

`POST https://<shared domain>/persist/ingest`, with the shared key as
`x-api-key` and Access's own service token as `Authorization: Bearer`, the same
credentials as a user or group record:

```json
{
  "@type": "tinker:graph",
  "@value": {
    "vertices": [],
    "vertexRefs": [
      { "@type": "g:VertexRef", "@value": { "id": { "@type": "g:UUID", "@value": "<grantee record id>" }, "label": "access_group" } },
      { "@type": "g:VertexRef", "@value": { "id": { "@type": "g:UUID", "@value": "<company vertex id>" }, "label": "company" } }
    ],
    "edges": [
      {
        "@type": "g:Edge",
        "@value": {
          "id": { "@type": "g:UUID", "@value": "access_group_can_access:<grantee record id>:<company vertex id>" },
          "label": "access_group_can_access",
          "outV": { "@type": "g:UUID", "@value": "<grantee record id>" },
          "outVLabel": "access_group",
          "inV": { "@type": "g:UUID", "@value": "<company vertex id>" },
          "inVLabel": "company"
        }
      }
    ]
  }
}
```

- Both ends are vertex references, never vertices: a vertex in the body would
  replace that record's properties. The grant edge has no properties.
- Persist names the edge by a hash of its label and ends, so the edge id in the
  body is a placeholder and the same edge sent again changes nothing.
- `200` is written. `404` `MissingVertexRef` means the anchor record, or the
  grantee's own record, is not in Persist yet (a user record is published after
  the fact). Every other answer is read as for a user record: `400`, `403` and
  other 4xx but 408 and 429 are refusals; `408`, `429`, `5xx`, a timeout and no
  answer are unavailability.

## Removing an edge

Persist's contract for it is "Removing an access-plane edge" in
[user-scoped access](../../build-persist-service/reference/user-scoped-access.md#removing-an-access-plane-edge).
Access sends the same label and ends it wrote, with the same credentials:

```json
{ "edges": [ { "label": "access_group_can_access", "outV": "<grantee record id>", "outVLabel": "access_group", "inV": "<company vertex id>", "inVLabel": "company" } ] }
```

`200` is removed, whether or not the edge was there. Every other answer is read
as for a write. Until Persist serves that route, every removal fails and every
revoke of a share that carries an edge answers an error and leaves the share as
it was. That is the intended fail-closed result: report it as a Persist gap.

## When each edge is written and removed

A grant or revoke is synchronous, as the build contract requires, and the
record queue makes Persist converge on Access's records whatever happens to a
request.

| Change | Order | When Persist did not confirm |
| --- | --- | --- |
| A new share of the edge action | Share and rule as for any share, then the edge | The share and its rule are taken back, audited as `share.revoke`; `409 RECORD_NOT_IN_PERSIST` for `MissingVertexRef`, `502 PERSIST_REFUSED` for another refusal, `503 PERSIST_UNAVAILABLE` otherwise. Nothing is granted |
| The same share again | The edge again | `200` is not answered: the same error, and the share stays as it was |
| A revoke | The edge first, then the rule and the share | The same error; the share and its rule stay, and no `share.revoke` is written |
| Removing a registration, a role or a user | Every edge of their shares first, then each share's rule and record, then the registration, role or user | The same error; nothing in Access is removed |

- Every share change also goes through the stream to the record queue, as a
  record of kind `grant` named by its ends: grantee kind and id, product, type
  and resource id. The publisher reads whether a share of the edge action is on
  record for it now, writes the edge if one is and removes it if none is. A
  write that took effect though its answer was lost, a rollback whose removal
  failed and a replay all converge, and refusals go to `UnpublishedRecords`
  with the alarms user records already have.
- The record backfill queues every share on an anchor type as well, so a share
  stored before this piece, or whose change the relay could not queue, gets its
  edge.
- Removing a user removes the shares made to them. Keep the ids of a user's
  shares in an index, as a role's are, and limit a user to as many shares as a
  role, so their removal fits in one request. A share made before the index
  existed is not removed with its user; it grants nothing once the user is gone,
  since no token names them again.
- Write no record of the edge in Access beyond the share itself. Access holds
  share and audit records only.

## What Persist and Model provide

- Model: the anchor record type, marked as an anchor, and both grant edges,
  from the user record type and from the group record type to the anchor, each
  marked as a grant edge and write-guarded with `persist:access-plane:write`.
- Model and Persist: an anchor id that does not change while the record stays
  the same record. A content-hashed record gets a new id whenever one of its
  properties changes, and a share of the old id then reaches nothing.
- Persist: the edge write above (persist#498 and the write guard), the edge
  removal route, and a resource type in its Access declaration for each anchor:

  ```json
  { "name": "company", "private": false, "actions": [ { "name": "read", "shareable": true, "type_level": false } ] }
  ```
