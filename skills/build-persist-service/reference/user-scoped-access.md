# User-scoped access

Use this contract when a person signed in through Access calls Persist. It is
requested build scope, not evidence of deployed behavior. Verify the target
revision before relying on any part of it.

One environment is one company. Persist separates users inside it by their
connections in the graph. It has no tenant prefix, tenant key or per-tenant
partition.

## Callers

| Caller | How it is recognised | What it may reach |
| --- | --- | --- |
| Environment key | The shared key, with no person attached | Everything, as today, except writing the access-plane labels below. Recorded as the environment. Personal-data fields stay denied to it. |
| IAM role | A signed request from an AWS principal | Everything its role allows, as today, except writing the access-plane labels below. |
| Access administrator | A verified Access token whose roles include the Persist administrator role | Every route, except writing the access-plane labels below. |
| Access user | A verified Access token without that role | GraphQL only, scoped to what is connected to the user. |
| Access service identity | A verified Access token naming a service | The actions its permissions name. Access's own identity is the only caller that may write the access-plane labels below. |

Signed-in people, Access administrators and Access's own service identity call
Persist with an Access token and no shared key. Put the whole shared API behind
one authorizer that accepts the shared key or a verified Access token, under
[the publish readiness gate's option 3](../../guide-product-work/reference/shared-api-domain.md#publish-readiness-gate).
That option applies to an entire API, so move every method together and re-run
the environment-key suite. The gateway only establishes who is calling; the
route rule below, enforced inside Persist, decides what each caller may reach.

Verify Access tokens with the shared verifier from Access: signature, issuer,
audience, expiry and token type. Reject on any verification error. Never read a
claim from an unverified token.

## Route rule

A signed-in user who is not an administrator reaches GraphQL and nothing else.
Refuse an Access user on every other route with `403`:

- Gremlin queries, async queries and explain
- ingest, async ingest and validation
- lexicon, extensions and the lexicon catalog
- process triggers
- metrics and the metrics catalog
- the MCP server and its configuration
- file loads and exports

Keep these routes working for the environment key, IAM roles and Access
administrators.

## Reads start from the user

Access publishes each user to Persist as a graph record, and each role as a
group record. A user may read a record when it is reachable, along edge types
the lexicon marks as carrying access, from their own record or from the group
record of a role in their verified token.

Take a caller's roles from the token, never from the graph. Who holds a role is
not stored in Persist, so unassigning a role takes effect when the caller's
current token expires and cannot lag behind a delayed publication.

The lexicon marks two kinds of access-carrying edge, and they are written by
different callers:

| Kind | What it connects | Written by |
| --- | --- | --- |
| **Grant edge** | A user or a group to an anchor record | Access's own service identity only |
| **Structural edge** | An anchor to the records beneath it, and those records to the ones beneath them, in one declared direction | Ordinary ingest, as today |

Access flows one way: from the user's record and their token's role groups,
across grant edges to an anchor, then down structural edges. A structural edge is followed only in its declared
direction, so a record never grants access to its parent or to a sibling.

- Build every GraphQL read for an Access user as a traversal that starts at the
  caller's user record and the group records of their token's roles. Do not
  fetch first and filter afterwards.
- A lookup by identifier must prove the record is reachable from the caller
  before returning it. Answer "not found" for an unreachable record, so the
  response does not reveal that it exists.
- Follow only access-carrying edge types when deciding reachability. An
  ordinary relationship never grants access, otherwise a user could walk from
  one record to an unrelated one through a shared neighbour.
- Apply the same rule to nested fields, counts and aggregates. A count over
  unreachable records leaks them.
- Expect users to be connected to a few anchor records, directly or through a
  group, with everything beneath reached by traversal. Bound the traversal depth
  and reject a lexicon that would make it unbounded.
- The user and group record types, the anchor record types and both kinds of
  access-carrying edge are Model decisions. Read them from the active lexicon.
  Do not hard-code labels, and do not add them to a deployed lexicon from
  Persist.

## Fields from other sources

A field the resolution map routes outside the graph is resolved only for a
record the query already reached, so the reachability rule covers it. Keep the
existing personal-data policy in front of those fields and extend it to Access
roles: a role may be granted a personal-data level the same way an IAM role is
today. The environment key keeps no personal-data access.

## Search

Search finds records through a search index, not by traversal, so it is a
separate entry point. Filter it inside the index by access anchor; do not fetch
hits and filter them afterwards.

- An **anchor** is a record type the lexicon marks as one that users are
  connected to. Every other record sits beneath one or more anchors along
  access-carrying edges.
- When a record is indexed, compute the identifiers of every anchor it sits
  beneath and store them on its search document. A record beneath no anchor
  gets an empty list and is invisible to Access users.
- At query time, resolve the caller's anchors with one bounded graph read: the
  anchors connected to their user record or to the group record of a role in
  their token. Add them
  as a filter to the index query, so ranking, paging and totals are computed
  over readable documents only.
- Granting or revoking a connection between a user and an anchor changes only
  the caller's anchor set. It takes effect on the next query and needs no
  reindexing.
- A change beneath an anchor does need reindexing: a record that moves to
  another anchor, or an access-carrying edge added or removed below one.
  Reindex the affected documents from the same change stream that keeps the
  index current.
- The index can lag such a change. Before returning a page, confirm each of its
  hits is reachable from the caller in the graph. Drop a hit that is not, count
  it in a metric and queue its document for reindexing. This check covers only
  the returned page, never the whole result.
- Apply the anchor filter to every source a hit cites. A hit the user may read
  must not cite a record they may not.
- Bound the number of anchors in one filter. Refuse the search with a clear
  error for a caller above the bound instead of truncating the list.
- If the caller's anchors cannot be resolved, or the page check cannot run,
  fail the search field. Never return unfiltered or unchecked hits.
- Add anchor identifiers with a new index generation and backfill, promoted the
  way other index changes are. Until a generation with anchors is active,
  search stays closed to Access users.
- The environment key, IAM roles and administrators search without the filter,
  as today.

Anchor record types are a Model decision, like the access-carrying edge types.

## Writes

An Access user's token is read-only in Persist. Data created on a user's behalf
is written by an application's backend or a service identity through ingest.

The **access-plane labels** are user records, group records and grant edges.
Only Access's own service identity writes or removes them, so every grant goes
through Access's audited API. Refuse them from every other caller, including
the environment key, IAM roles and administrators, on every write path: ingest,
async ingest, event ingestion and file loads. Log the writer of each accepted
one. These labels are new, so no existing ingest is affected.

Structural edges are ordinary data. Any caller that may ingest today writes
them, because placing a record beneath an anchor is part of loading that
record. Two rules keep them from acting as grants:

- Refuse, from every caller but Access, any edge with a user or group record at
  either end, whatever its label.
- Refuse a structural edge whose direction or endpoint types differ from the
  lexicon's declaration.

Ingest is limited to the environment key, IAM roles, administrators and
service identities, which can already read and write all data. A signed-in
person cannot write a structural edge.

## Definition of done

`user-scoped-access` is done only when every check below exists as an automated
test whose name starts with its ID, passes at its level, and the existing
environment-key and IAM regression suites still pass. Use the graph fixture and
people from [the Access test data](../../build-access-product/reference/test-data.md#graph-fixture);
never invent labels in a deployed lexicon. Write one evidence row per check:
ID, level, result, request identifier and the Persist revision.

Level **F** runs in the repository against the service's real graph fixture
with Access tokens issued by a test signer. Level **D** runs against a deployed
test environment with Access installed. These checks let the builder verify the
piece; the shared workflow's person-run checkpoint still applies to Persist.

Setup for `UA-1` to `UA-5`: `alice` is connected to `scope-a`; `bob` is
connected to nothing.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| UA-1 | F, D | `alice` and `bob` each list items through GraphQL | `alice` gets `item-a1` and `item-a2` only; `bob` gets an empty list |
| UA-2 | F, D | `alice` looks up `item-b1` by identifier, then an identifier that does not exist | Both answers are not found, with the same response shape |
| UA-3 | F, D | `alice` selects the `fixture_related` neighbour of `item-a1` | `item-b1` is not returned |
| UA-4 | F, D | `alice` and `bob` each count items | `2` and `0` |
| UA-5 | F, D | `alice` and `bob` each search for `quarterly fixture report` | `alice` gets one hit, `item-a1`, with a total of `1` and no cited source under `scope-b`; `bob` gets no hits and a total of `0`. The index query carried the anchor filter, and no page was fetched and discarded |
| UA-6 | F | Make anchor resolution fail during `alice`'s search, then make the page check fail | The search field returns an error both times; no hits |
| UA-7 | F, D | Connect the `viewer` role's group `group-g` to `scope-b`; `carol`, whose token carries `viewer`, lists items | `item-b1` only |
| UA-8 | F, D | `alice` calls the Gremlin, ingest, lexicon, process-trigger, metrics-catalog, MCP and file-load routes | `403` each; no query or write ran |
| UA-9 | F, D | `admin` calls the same routes | Each behaves as it does for the environment key |
| UA-10 | F, D | Run the existing environment-key and IAM suites | Unchanged results |
| UA-11 | F, D | The environment key, an IAM role, `admin` and another service identity each ingest a `fixture_can_access` edge, a `fixture_user` record and a `fixture_group` record, by ingest and by file load | `403` each; nothing written. The same writes from Access's own service identity are accepted and logged with their writer |
| UA-12 | F, D | Revoke `alice`'s connection, then repeat `UA-1`, `UA-4` and `UA-5` for her | Empty list, `0`, no hits |
| UA-13 | F, D | Call GraphQL with an expired token, an edited one and one from another environment | `401` each; zero graph queries issued |
| UA-14 | F | A role granted a personal-data level, a role without it, and the environment key each select a personal-data field on a reachable record | Returned for the first; a field error for the other two |
| UA-15 | F | Index 500 items under `scope-b` that match the search phrase and rank above `item-a1`; `alice` searches | She still gets `item-a1` with a total of `1` |
| UA-16 | F | Move `item-a2` from `scope-a` to `scope-b` and search as `alice` for `annual fixture summary`, which only `item-a2` contains, before the reindex runs and then after | Before: `item-a2` is dropped by the page check and counted once in the stale-hit metric. After: no hit, a total of `0` and the metric unchanged |
| UA-17 | F | Connect a caller to more anchors than the bound, then search | A clear error; no partial result |
| UA-18 | F, D | Search as `alice` while no index generation with anchors is active | The search field returns an error; GraphQL reads still work |
| UA-19 | F, D | With the environment key, ingest a new item with a `fixture_contains` edge from `scope-a` | Accepted, as ordinary ingest; `alice` then reads the item |
| UA-20 | F, D | With the environment key, ingest a `fixture_contains` edge from `alice`'s user record to `item-b1`, then one pointing from an item up to a scope | `403` for the edge that touches a user record and `400` from lexicon validation for the wrong direction; nothing written; `alice` still cannot read `item-b1` |
| UA-21 | F, D | With `group-g` connected to `scope-b`, unassign `viewer` from `carol` and let her token expire; nothing else is republished | With her new token she lists nothing under `scope-b`, and her search returns no hit there |
