# Access verification and definition of done

Use this reference to decide when an Access piece is done. Every check uses
[the Access test data](test-data.md). It is a build specification: it states
what must be proven, not what is deployed.

## Definition of done

A piece is **done** only when all of these hold:

1. Every check listed for the piece exists as an automated test whose name
   starts with the check ID (for example `SI-5`).
2. The piece's verification command exits 0 at the **fake** level, and at the
   **deployed** level against the test environment through HTTP on
   `https://<shared domain>/access`.
3. The run wrote an evidence file with one row per check: check ID, level,
   result, correlation or request identifier, timestamp and the Access revision.
4. The [leak scan](#leak-scan) for that run found nothing.
5. Every check of every earlier done piece still passes in the same run.
6. Cleanup removed everything the run created.

Report one of three states for a piece, never a bare "done":

| State | Meaning |
| --- | --- |
| `verified` | Every check passed at its level |
| `verified-with-gaps` | Every check that can run passed; the rest are blocked by a named prerequisite outside Access, listed by check ID |
| `not-verified` | A check failed, was not automated, or was not run |

Expose one command per piece and one for everything, for example
`verify <piece>` and `verify all`, each taking the level and the test
environment. Record the exact commands in the Access repository's README.

### Levels

| Level | Runs | Who |
| --- | --- | --- |
| **F** fake | In the repository, with fakes for the login directory, the identity provider, the permission store and Persist | The agent |
| **D** deployed | Against the deployed test environment through the Access HTTP API, with the fake identity provider as its configured issuer | The agent |
| **D\*** deployed, needs another product | As D, but needs the named capability of another product | The agent, once the prerequisite exists |
| **H** human | Needs a person and a real Google account | A person; only `SI-H1` |

### Working without a person

By the user's explicit instruction, Aegislash verifies each Access piece itself
with these checks and starts the next piece without waiting for a person to run
it. This replaces the stop-and-wait checkpoint of the shared workflow for
Access build work only. Give the evidence table after each piece.

Stop and ask a person when:

- a check cannot be automated as written, or its pass condition is ambiguous;
- a deployed check still fails after the cause was investigated and fixed once;
- a step needs a real credential, a real recipient, a non-test environment or a
  change to another product's repository;
- a requirement conflicts with the security floor;
- `SI-H1` is the only check left for `sign-in`: report it pending and continue.

### Required responses

Checks compare these responses. They are part of the contract:

| Situation | Status |
| --- | --- |
| No credential, or an invalid, expired or revoked one | `401` |
| A verified caller without the needed permission | `403` |
| A record that does not exist, or that the caller may not learn exists | `404` |
| An invalid document or parameter | `400`, with no write |
| A change that would break an invariant (for example the last administrator) | `409`, with no write |
| A write that created something | `201` |
| A write that replaced something, or an identical replay | `200`, with a result of `replaced` or `unchanged` |
| A removal | `204` |

Access tokens last at most 15 minutes and invitations at most 7 days unless the
user sets other values. Checks read the configured values and assert against them.

## Checks by piece

### `sign-in`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| SI-1 | D | Start sign-in for `app-one` | `302` to the configured issuer with a `state`, an S256 code challenge and exactly the registered redirect address; the response carries no token |
| SI-2 | D | Complete the flow as `alice` | The caller's own profile returns one stable user identifier and `alice`'s email; exactly one user exists for her |
| SI-3 | D | Sign in as `alice` again | Same user identifier; user count unchanged |
| SI-4 | D | Sign in as `bob` | A different user identifier |
| SI-5 | D | Sign in as `personal` | `403`; no user created; no session |
| SI-6 | D | Sign in as `outsider`, then as `spoof` | `403` for both; no user created for either |
| SI-7 | D | Replay `alice`'s authorization code | `400`; no second session |
| SI-8 | D | Return to the callback with a changed `state`, then without the code verifier | `400` for both; no session |
| SI-9 | D | Refresh, then sign out, then refresh again | New access token; after sign-out the refresh is `401` |
| SI-10 | F, D | Inspect the synthesized infrastructure and every route used in this piece | No domain or certificate resource beyond the shared one; every route's host is the shared domain and its path starts with `/access` |
| SI-11 | F | Read capability discovery under a non-test configuration | The reported issuer is Google's |
| SI-12 | D | Call sign-in start 50 times in a row from one client | Later calls are rate-limited with `429`; a single call after the window succeeds |
| SI-H1 | H | A person signs in once with a real company Google account and once with a personal one | The first reaches the application signed in; the second is refused |

### `applications`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| AP-1 | D | As `admin`, create `app-two` | `201`; reading it back returns the document's addresses exactly |
| AP-2 | D | Send the identical document again | `200 unchanged`; no new audit change record |
| AP-3 | D | Replace one address | `200 replaced`; read-back shows the new set; the dropped address no longer starts sign-in |
| AP-4 | D | Start sign-in for `app-one` with each refused address in the test data | `400` each time, before any redirect to the issuer |
| AP-5 | D | Create an application with an `http` address, then one with a wildcard | `400` both; nothing stored |
| AP-6 | D | Remove `app-two` after a user signed in through it | `204`; that user's refresh token is `401`; sign-in start for it is `404` |
| AP-7 | D | Create and remove as `bob`, then with no credential | `403`, then `401`; nothing changed |

### `application-bundles`

Prerequisites outside Access: Build's `access` `application` kind and Deploy's
Access adapter.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| AB-1 | F | Validate application documents containing a client secret, a token, a user and a role | Each is rejected by the application schema |
| AB-2 | D\* | Install a bundle with `app-one` and `app-two` | Both read back equal to the bundle |
| AB-3 | D\* | Install the same bundle again | No write; both results `unchanged` |
| AB-4 | D\* | Publish a release changing one address of `app-two` | Only `app-two` is `replaced`; `app-one` is `unchanged` |
| AB-5 | D\* | Publish a release without `app-two`, with `app-direct` registered directly | `app-two` is removed; `app-one` and `app-direct` are untouched |
| AB-6 | D\* | Run the leak scan over the bundle, the run results and the logs | No marker and no token found |

### `token-contract`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| TC-1 | D | Decode `alice`'s access token | Subject is her user identifier, issuer is this environment's, audience is `app-one`, token type is access, roles is `["member"]`, and expiry minus issue time is at most the configured lifetime |
| TC-2 | F | Give the shared verifier: a good token, an expired one, one from another issuer, one for another audience, an identity token, one with edited roles, one with no signature algorithm, one signed by an unknown key | Only the good token is accepted; each other returns a distinct rejection reason |
| TC-3 | F | Verify 100 good tokens with outbound network calls counted after the keys are cached | Zero outbound calls |
| TC-4 | D | Fetch the published keys with no credential | `200`; the set contains the key identifier in `alice`'s token |
| TC-5 | F, D | Rotate the signing key while a verifier is running | A token signed with the new key verifies without a restart; a token signed with the old key verifies until its expiry |
| TC-6 | F | Make the published keys unreachable, then verify a token with an unknown key identifier | Rejected; never accepted |

### `users`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| US-1 | D | As `admin`, invite `carol` as `viewer` | `201`; she is listed as pending; an audit record names `admin` as the actor |
| US-2 | D | Sign in as `carol` | She is active; her token's roles are `["viewer"]` |
| US-3 | D | Invite with an expiry already in the past, then sign in as that person | Sign-in creates the user with no role; the expired invitation's role is not applied |
| US-4 | D | Sign in as `erin`, who was never invited | A user is created with no role; her token's roles are empty; every permission check denies her |
| US-5 | D | As `bob`, list users and invite someone | `403` both; nothing written |
| US-6 | D, F | Disable `dave` after he signed in | His refresh is `401` at once; a new sign-in is `403`; at F, with the clock moved past his token's expiry, the verifier rejects him |
| US-7 | D | Remove a user | `204`; absent from the list; audit record written |
| US-8 | D | Call every user route with no credential | `401` each |

### `user-records`

Prerequisite outside Access for D\*: Persist with a user record type in its lexicon.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| UR-1 | F | Create `alice` | Exactly one publication to the Persist fake, containing only the fields the lexicon declares for a user |
| UR-2 | F | Make the Persist fake fail, then sign in as `bob`, then restore it | Sign-in succeeds while Persist fails; `bob`'s record is delivered after recovery |
| UR-3 | F | Deliver the same user event twice | One record, same identifier |
| UR-4 | F | Change, disable and remove a user | The record is updated, marked disabled and marked removed in turn |
| UR-5 | F | Compare every published payload with the list of tokens and markers | None present |
| UR-6 | D\* | Create a user, then read the record through Persist | The record appears within five minutes with the expected identifier and fields |

### `permissions`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| PM-1 | D | Declare the `fixture` product's resource type and actions | Reading the declaration back returns them exactly |
| PM-2 | D | Create the `member` and `viewer` roles from the test data and assign them | Both read back; the next tokens for `alice` and `carol` carry them |
| PM-3 | D | Ask the decision helper the eight questions below | Every answer matches |
| PM-4 | D | Create a role with `fixture:destroy` | `400`; the number of stored rules is unchanged |
| PM-5 | D | Remove `admin`'s role, then remove `admin` | `409` both; `admin` is still an administrator |
| PM-6 | F | Make the permission store fail, time out and throttle | The helper denies each time |
| PM-7 | D | Create a role as `bob` | `403`; nothing written |
| PM-8 | D | Create a role using only the environment key | Allowed; the audit record's actor is `environment` |
| PM-9 | D | Check which principals can write rules to the store | Only Access's own role; every other product role can only ask for a decision |
| PM-10 | D | Ask the helper about `fixture:secret/secret-a` (personal, owned by `alice`) for `alice`, `bob`, `admin` and the environment | `use`: allow for `alice`, deny for the other three. `remove`: allow for `alice`, `admin` and the environment, deny for `bob`. `manage`: allow for `alice` only |
| PM-11 | D | Ask about `fixture:secret/secret-env` (owned by the environment) for the environment, `admin` and `alice` | `use`: allow for the environment and `admin`, deny for `alice` |

Decisions for `PM-3` (resource `fixture:item/item-1`, owned by `alice`):

| Caller | Action | Answer |
| --- | --- | --- |
| `admin` | `manage` | allow |
| `alice` | `read` | allow |
| `alice` | `use` | allow (owner) |
| `bob` | `read` | allow (role) |
| `bob` | `use` | deny |
| `carol` | `read` | deny |
| `erin` | `read` | deny |
| `fixture-service` | `use` | deny |

### `resource-sharing`

Resource `fixture:item/item-1`, owned by `alice`. Ask the decision helper after each step.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| RS-1 | D | No grant yet: `bob` asks to `use` | deny |
| RS-2 | D | `alice` grants `bob` `use` | `201`; `bob` `use` is allow; audit record names `alice` |
| RS-3 | D | `alice` grants the `viewer` role `read` | `carol` `read` is allow; `carol` `use` is deny |
| RS-4 | D | `bob` tries to grant `carol` `use` | `403`; `carol` `use` stays deny |
| RS-5 | D | List grants on the item as `alice`, then as `bob` | `alice` sees both grants; `bob` gets `403` |
| RS-6 | D | `alice` revokes `bob`'s grant | `204`; `bob` `use` is deny on the next question; audit record written |
| RS-7 | D | Send the same grant twice | One grant stored |
| RS-8 | D | `alice` shares `secret-a` with `bob`; then `admin` and the environment each try to share it with `carol` | `bob` `use` is allow; `403` for `admin` and the environment; `carol` `use` stays deny |
| RS-9 | D | `admin` shares `secret-env` with `alice`; `alice` then tries to share it with `bob` | `alice` `use` is allow; `403` for her share; `bob` `use` stays deny |
| RS-10 | D\* | Run Connect checks `UC-3` to `UC-11` with real Connect credentials | They pass. Needs Connect's per-user checks |

### `record-access`

Uses the graph fixture. Prerequisite outside Access for D\*: Persist's
user-scoped access.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| RA-1 | F | As `admin`, connect `alice` to `scope-a` | Exactly one access edge is written to the Persist fake, by Access's service identity; audit record written |
| RA-2 | F | List `alice`'s connections, then revoke | The list shows `scope-a`; after revoking, the edge is removed |
| RA-3 | F | Connect `group-g` to `scope-b` | One edge from the group; `carol` is reported as reaching `scope-b` |
| RA-4 | F | Connect as `bob`, then with no credential | `403`, then `401`; no edge written |
| RA-5 | F | Send the same connection twice | One edge |
| RA-6 | F | Scan Access's own stores after the run | They hold connection and audit records only; no item content |
| RA-7 | D\* | Connect `alice` to `scope-a`, then run Persist checks `UA-1` to `UA-5` | They pass |
| RA-8 | D\* | Revoke, then run Persist check `UA-12` | It passes |

### `service-identities`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| SV-1 | D | Create `fixture-service` | `201`; the secret is in this one response; reading the identity again returns metadata only |
| SV-2 | D | Get a token for it and decode it | Subject is `fixture-service`; the verifier reports kind `service`; no person's identifier appears |
| SV-3 | D | Rotate the secret | Old and new both obtain tokens during the overlap; only the new one after it ends |
| SV-4 | D | Revoke the identity | Token requests are `401`; a token issued earlier is rejected no later than its expiry |
| SV-5 | D | Ask the helper whether it may `use` `item-1` | deny |
| SV-6 | D | Run the leak scan | The service marker is absent everywhere |

### `product-integration`

The integrating product's builder owns its own checks. Access is done with this
piece for a product when:

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| PI-1 | F | Install the shared verifier and decision helper from their published versions in a clean project | Both install and pass `TC-2` and `PM-6` there |
| PI-2 | D\* | Run that product's checks: Persist `UA-*`, Connect `UC-*`, Console `CS-*` | All pass |
| PI-3 | D\* | Call the product with only the environment key | Works as before; recorded as the environment, not a person |
| PI-4 | D\* | Call the product with no token and no key | `401` |

## Negative-test matrix

Each defect of [the earlier sign-in service](prior-implementation.md) must stay
impossible. A piece that touches the area re-runs its row.

| Earlier defect | Proven absent by |
| --- | --- |
| Test bypass in production | `SI-11`; plus a check that sends every route a request whose user agent names a test tool and gets the same answer as without it |
| Unverified tokens | `TC-2` |
| Fail-open check | `TC-6`, `PM-6` |
| Unprotected administration | `AP-7`, `US-5`, `US-8`, `PM-7`, `RA-4` |
| Credentials in logs | Leak scan |
| Tokens in URLs | `SI-1`; plus an assertion that no redirect in any check carries a token |
| Long-lived, weakly bound sessions | `TC-1`, `SI-7`, `SI-8`, `SI-9` |
| Lookup by scan | A check that resolving `app-one` issues a keyed read and no list call, with 200 applications registered |
| Email as identity | `SI-3`; plus changing `alice`'s email at the provider and signing in again returns the same user identifier and grants |
| Sign-up coupled to another service | `UR-2` |

## Leak scan

Run after every deployed run, over the run's time window:

1. Collect every Access log group's events, every HTTP response body and header
   the run captured, every redirect address, every audit record, every
   configuration bundle and Deploy run result used, and every record the run
   wrote to Persist.
2. Search them for each leak marker from the test data and for every
   authorization code, access token, identity token and refresh token issued
   during the run.
3. Pass only with zero matches, apart from the single response that
   legitimately returned a secret or token to its owner.

A token or marker found anywhere else fails the piece, whatever else passed.

## Cumulative scenario

Run `E2E-1` when Access, Persist and Connect are all integrated. It is the final
acceptance for the product and needs every piece above.

| Step | Do | Pass when |
| --- | --- | --- |
| 1 | `admin` signs in, creates the roles, invites `carol` | `US-1`, `PM-2` |
| 2 | `alice` and `bob` sign in through `app-one` | Two distinct users; both records readable in Persist |
| 3 | `admin` connects `alice` to `scope-a` | One access edge |
| 4 | `alice` and `bob` each query Persist's GraphQL for items, and search for `quarterly fixture report` | `alice` gets `item-a1` and `item-a2`, and one search hit; `bob` gets nothing |
| 5 | `alice` creates a Connect credential and starts a flow that uses it; `bob` starts the same flow | `alice`'s job runs; `bob`'s is refused before any partner call |
| 6 | `alice` grants `bob` `use`; `bob` starts the flow | It runs |
| 7 | `admin` disables `alice`; she retries steps 4 and 5 after her token expires | Both refused |
| 8 | Call Persist and Connect with only the environment key | Both work as before |
| 9 | Run the leak scan and cleanup | Nothing found; nothing left behind |
