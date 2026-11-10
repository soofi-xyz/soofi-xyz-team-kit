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
| Environment key | The shared key, with no person attached | Everything, as today. Recorded as the environment. Personal-data fields stay denied to it. |
| IAM role | A signed request from an AWS principal | Everything its role allows, as today. |
| Access administrator | A verified Access token whose roles include the Persist administrator role | Every route. |
| Access user | A verified Access token without that role | GraphQL only, scoped to what is connected to the user. |
| Access service identity | A verified Access token naming a service | The actions its permissions name. |

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

Access publishes each user to Persist as a graph record. A user may read a
record when it is reachable from their own record along edge types the lexicon
marks as carrying access.

- Build every GraphQL read for an Access user as a traversal that starts at the
  caller's user record. Do not fetch first and filter afterwards.
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
- The user record type and the access-carrying edge types are Model decisions.
  Read them from the active lexicon. Do not hard-code labels, and do not add
  them to a deployed lexicon from Persist.

## Fields from other sources

A field the resolution map routes outside the graph is resolved only for a
record the query already reached, so the reachability rule covers it. Keep the
existing personal-data policy in front of those fields and extend it to Access
roles: a role may be granted a personal-data level the same way an IAM role is
today. The environment key keeps no personal-data access.

## Search

Search finds records through a search index, not by traversal, so it is a
separate entry point. Open it to Access users under the same rule:

- Run the search, then keep only hits whose record is reachable from the
  caller. Check reachability in bounded batches against the graph.
- Return and count only the kept hits. Page until the requested size is filled
  or the index is exhausted, with a fixed upper bound on index pages read.
- Apply the rule to the hit's matched text and to every source it cites. A hit
  the user may read must not cite a record they may not.
- If reachability cannot be checked, fail the search field. Never return
  unchecked hits.

## Writes

An Access user's token is read-only in Persist. Data created on a user's behalf
is written by an application's backend or a service identity through ingest.

User records and access-carrying edges arrive through ingest from Access's own
service identity. Treat an access-carrying edge as a privileged write: accept it
only from Access's service identity or an administrator, and log who wrote it.
A caller that can write those edges controls who sees what.

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
| UA-5 | F, D | `alice` and `bob` each search for `quarterly fixture report` | `alice` gets one hit, `item-a1`, with a total of `1` and no cited source under `scope-b`; `bob` gets no hits and a total of `0` |
| UA-6 | F | Make the reachability check fail during `alice`'s search | The search field returns an error; no hits |
| UA-7 | F, D | Connect `group-g` to `scope-b`; `carol` lists items | `item-b1` only |
| UA-8 | F, D | `alice` calls the Gremlin, ingest, lexicon, process-trigger, metrics-catalog, MCP and file-load routes | `403` each; no query or write ran |
| UA-9 | F, D | `admin` calls the same routes | Each behaves as it does for the environment key |
| UA-10 | F, D | Run the existing environment-key and IAM suites | Unchanged results |
| UA-11 | F, D | A service identity without the grant permission ingests a `fixture_can_access` edge | `403`; no edge written. The same ingest from Access's service identity is accepted and logged with its writer |
| UA-12 | F, D | Revoke `alice`'s connection, then repeat `UA-1`, `UA-4` and `UA-5` for her | Empty list, `0`, no hits |
| UA-13 | F, D | Call GraphQL with an expired token, an edited one and one from another environment | `401` each; zero graph queries issued |
| UA-14 | F | A role granted a personal-data level, a role without it, and the environment key each select a personal-data field on a reachable record | Returned for the first; a field error for the other two |
