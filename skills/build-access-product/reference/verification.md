# Access verification and definition of done

Use this reference to decide when an Access piece is done. Every check uses
[the Access test data](test-data.md). It is a build specification: it states
what must be proven, not what is deployed.

## Definition of done

A piece is **done** only when all of these hold:

1. Every fake and deployed check listed for the piece exists as an automated
   test whose name starts with the check ID (for example `SI-5`). A human check
   is tracked by its ID and cannot be automated.
2. The piece's verification command exits 0 at the **fake** level, and at the
   **deployed** level against the test environment through HTTP on
   `https://<shared domain>/access`.
3. The run wrote an evidence file with one row per check: check ID, level,
   result, correlation or request identifier, timestamp and the Access revision.
4. The [cross-cutting checks](#cross-cutting-checks) pass for that run.
5. Every check of every earlier done piece still passes in the same run.
6. Cleanup removed everything the run created and touched nothing else, as
   [the test data](test-data.md#cleanup) describes.

Report one of three states for a piece, never a bare "done":

| State | Meaning |
| --- | --- |
| `verified` | Every check passed at its level, and a person confirmed any human check |
| `verified-with-gaps` | Every check that can run passed; the rest are listed by check ID with what they wait on: a named prerequisite outside Access, or a person for a human check |
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

### Checkpoint

These checks are the evidence Aegislash brings to the shared workflow's
checkpoint. They do not replace it. After each piece, give the evidence table
and have the person run the piece and inspect it before the next piece starts.
Continue without waiting only when the person working with you says so in that
session; record the instruction and what it skipped.

Stop and ask a person whenever:

- a check cannot be automated as written, or its pass condition is ambiguous;
- a deployed check still fails after the cause was investigated and fixed once;
- a step needs a real credential, a real recipient, a non-test environment or a
  change to another product's repository;
- a requirement conflicts with the security floor.

### Order

Pieces are verified in this order. A piece's checks use only what that piece
and the ones before it deliver:

`applications` → `sign-in` → `token-contract` → `users` → `permissions` →
`service-identities` → `user-records` → `resource-sharing` → `record-access` →
`application-bundles` → `product-integration`

Until `permissions` is done the fixture people hold no permission:
administrative calls use the environment key, and every fixture person is
refused on protected routes. A deployed run shares its test environment with
whatever is installed there and uses run-suffixed fixture names.

### Required responses

Checks compare these responses. They are part of the contract:

| Situation | Status |
| --- | --- |
| No credential, or an invalid, expired or revoked one | `401` |
| A verified caller without the needed permission | `403` |
| A record that does not exist, or that the caller may not learn exists | `404` |
| An invalid document or parameter | `400`, with no write |
| A change that would break an invariant (for example the last administrator) | `409`, with no write |
| Too many requests | `429` |
| A write that created something | `201` |
| A write that replaced something, or an identical replay | `200`, with a result of `replaced` or `unchanged` |
| A removal | `204` |

Access tokens last at most 15 minutes and invitations at most 7 days unless the
user sets other values. Checks read the configured values and assert against them.

## Cross-cutting checks

Run these with every piece, over all routes that exist at that point.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| RI-1 | F, D | Read every route from the API description and call each with every caller kind that exists at that point: no credential and the environment key from `applications` on, plus a signed-in fixture person holding no permission from `sign-in` on | Each route is marked with exactly one class from the build contract and behaves as that class: public routes answer without user data; sign-in-credential and service-credential routes answer `401` without their own credential and ignore the key; own-session routes act only on the caller; protected routes answer `401` with no credential, `403` to the signed-in person and success to the environment key |
| NB-1 | D | Repeat `RI-1` with a user agent that names a test tool | Identical answers |
| LS-1 | D | Run the [leak scan](#leak-scan) | No match |

## Checks by piece

### `applications`

Uses the environment key; nobody can sign in yet.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| AP-1 | D | Create `app-one` and `app-two` | `201` each; reading each back returns the document's addresses exactly |
| AP-2 | D | Send `app-two`'s identical document again | `200 unchanged`; no new audit change record |
| AP-3 | D | Replace one address of `app-two` | `200 replaced`; read-back shows the new set |
| AP-4 | D | Create an application with an `http` address, then one with a wildcard, then one carrying a client secret | `400` each; nothing stored |
| AP-5 | D | Remove `app-two`, then read it | `204`, then `404` |
| AP-6 | D | Create, read and remove with no credential | `401` each; nothing changed |
| AP-7 | F | Resolve `app-one` with 200 applications registered | One keyed read and no list call |

### `sign-in`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| SI-1 | D | Start sign-in for `app-one` with the application's code challenge | `302` to the configured issuer with Access's own `state`, an S256 code challenge and Access's own callback under `/access` as the redirect address, never the application's; the response carries no token |
| SI-2 | D | Complete the flow as `alice` and exchange the result | After the provider callback the browser is sent to exactly `app-one`'s registered address with a one-time Access code and no token; exchanging that code with the application's verifier returns the tokens; her own profile returns one stable user identifier and her email; exactly one user exists for her |
| SI-3 | D | Sign in as `alice` again; then change her email at the provider and sign in once more | Same user identifier each time; user count unchanged |
| SI-4 | D | Sign in as `bob` | A different user identifier |
| SI-5 | D | Sign in as `personal` | `403`; no user created; no session |
| SI-6 | D | Sign in as `outsider`, then as `spoof` | `403` for both; no user created for either |
| SI-7 | D | Replay `alice`'s provider code at the callback, then replay her Access code at token exchange | `400` both; no second session and no second set of tokens |
| SI-8 | D | Return to the callback with a changed `state`; then exchange an Access code with no verifier, with a wrong verifier, and naming `app-two`'s address | `400` each; no session and no tokens |
| SI-9 | D | Refresh, then sign out, then refresh again | New access token; after sign-out the refresh is `401` |
| SI-10 | D | Start sign-in for `app-one` with each refused address in the test data | `400` each time, before any redirect to the issuer |
| SI-11 | D | With `alice` signed in through `app-one`, start sign-in for `app-two` | Completes without a new prompt at the issuer, as the same user identifier |
| SI-12 | D | Sign out through `app-one`, then refresh the session obtained through `app-two` | `401`; one sign-out ended both |
| SI-13 | D | Remove `app-two`'s second address, then start sign-in with it | `400`; `alice`'s existing session still works |
| SI-14 | F, D | Inspect the synthesized infrastructure and every route used in this piece | One sign-in client; no domain or certificate resource beyond the shared one; every route's host is the shared domain and its path starts with `/access` |
| SI-15 | F | Read capability discovery under a non-test configuration | The reported issuer is Google's |
| SI-16 | D | Call sign-in start 50 times in a row from one client | Later calls answer `429`; a single call after the window succeeds |
| SI-17 | D | Inspect every redirect produced in this piece | None carries an access, identity or refresh token; a provider code appears only in the provider's redirect to Access's callback, and an Access code only in Access's redirect to the application |
| SI-18 | D | With the environment key, try to change the identity provider's issuer, then read capability discovery | `400` or `403`; the issuer is unchanged; changing the allowed domains instead succeeds and is audited |
| SI-19 | D | Return to the callback with a sign-in from the `rogue` issuer presenting `alice`'s subject, email and hosted domain | `400`, as for any code the configured issuer did not issue; no session; `alice`'s user is unchanged and no new user exists |
| SI-20 | D | Wait past the Access code's lifetime, then exchange it | `400`; no tokens |
| SI-21 | F | In the fake login directory, resolve a sign-in carrying `alice`'s subject, email and hosted domain under a different issuer | It matches no existing user; `alice`'s record and grants are untouched |
| SI-H1 | H | A person signs in once with a real company Google account and once with a personal one | The first reaches the application signed in; the second is refused |

### `token-contract`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| TC-1 | D | Decode `alice`'s access token | Subject is her user identifier, issuer is this environment's, audience is the environment's audience, client is `app-one`, token type is access, roles is an empty list, and expiry minus issue time is at most the configured lifetime |
| TC-2 | D | Decode tokens `alice` obtained through `app-one` and through `app-two` | Same subject and same audience; only the client differs |
| TC-3 | F | Give the shared verifier: a good token, an expired one, one from another issuer, one for another environment's audience, an identity token, one with edited roles, one with no signature algorithm, one signed by an unknown key | Only the good token is accepted; each other returns a distinct rejection reason |
| TC-4 | F | Verify 100 good tokens with outbound network calls counted after the keys are cached | Zero outbound calls |
| TC-5 | D | Fetch the published keys with no credential | `200`; the set contains the key identifier in `alice`'s token |
| TC-6 | F, D | Rotate the signing key while a verifier is running | A token signed with the new key verifies without a restart; a token signed with the old key verifies until its expiry |
| TC-7 | F | Make the published keys unreachable, then verify a token with an unknown key identifier | Rejected; never accepted |

### `users`

Administrative calls use the environment key; the fixture people hold no role yet.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| US-1 | D | Invite `carol` | `201`; she is listed as pending; an audit record names `environment` as the actor |
| US-2 | D | Sign in as `carol` | She is active; her token's roles are empty |
| US-3 | D | Sign in as `erin`, who was never invited | A user is created with no role |
| US-4 | D | As `bob`, list users, invite someone and disable someone | `403` each; nothing written |
| US-5 | D | `bob` reads his own profile | `200`, his own data only |
| US-6 | D, F | Disable `dave` after he signed in | His refresh is `401` at once; a new sign-in is `403`; at F, with the clock moved past his token's expiry, the verifier rejects it and he cannot obtain another |
| US-7 | D | Remove a user | `204`; absent from the list; audit record written |
| US-8 | D | Call every user route with no credential | `401` each |

### `permissions`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| PM-1 | F, D | With the environment key, make `admin` an administrator; `admin` signs in again and lists users. At F, do this on fresh state with no administrator | The assignment is audited with actor `environment`; with his new token `admin` gets `200`. At F it proves the first-administrator path |
| PM-2 | D | Declare the `fixture` product's resource types and actions | Reading the declaration back returns them exactly, including which type is private, which actions are shareable and which are type-level |
| PM-3 | D | As `admin`, create the `member` and `viewer` roles, assign `member` to `alice` and `bob` and `viewer` to `carol`, and invite `frank` as `viewer` | Both roles read back; the next tokens for `alice` and `carol` carry `["member"]` and `["viewer"]`; `frank`'s first token carries `["viewer"]` |
| PM-4 | D | Invite `grace` as `viewer` with an expiry already in the past, then sign in as her | She is created with no role |
| PM-5 | D | Ask the decision helper the nine questions below | Every answer matches |
| PM-6 | D | Create a role with `fixture:destroy` | `400`; the number of stored rules is unchanged |
| PM-7 | F | On fresh state where `admin` is the only administrator: as `admin`, remove `admin`'s role, then remove `admin` | `409` both; `admin` is still an administrator |
| PM-8 | F | Make the permission store fail, time out and throttle | The helper denies each time |
| PM-9 | D | As `bob` and as `erin`, call every protected route | `403` each; nothing written |
| PM-10 | D | Create a role using only the environment key | Allowed; the audit record's actor is `environment` |
| PM-11 | D | Check which principals can write rules to the store | Only Access's own role; every other product role can only ask for a decision |
| PM-12 | D | Ask the helper about `fixture:secret/secret-a` (personal, owned by `alice`) for `alice`, `bob`, `admin` and the environment | `use`: allow for `alice`, deny for the other three. `remove`: allow for `alice`, `admin` and the environment, deny for `bob`. `manage`: allow for `alice` only |
| PM-13 | D | Ask about `fixture:secret/secret-env` (owned by the environment) for the environment, `admin` and `alice` | `use`: allow for the environment and `admin`, deny for `alice` |
| PM-14 | F | On fresh state where `admin` is the only administrator: with the environment key, remove that role from `admin` | Allowed and audited with actor `environment`; his next token carries no administrator role, his current token stops being accepted at its expiry and not before, and the key still works |

Decisions for `PM-5` (resource `fixture:item/item-1`, owned by `alice`):

| Caller | Action | Answer |
| --- | --- | --- |
| `admin` | `manage` | allow |
| `alice` | `read` | allow |
| `alice` | `use` | allow (owner) |
| `bob` | `read` | allow (role) |
| `bob` | `use` | deny |
| `carol` | `read` | deny |
| `erin` | `read` | deny |
| `bob` | `create` (type-level, on `fixture:item`) | allow (role) |
| `erin` | `create` (type-level, on `fixture:item`) | deny |

### `service-identities`

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| SV-1 | D | As `admin`, create `fixture-service` | `201`; the secret is in this one response; reading the identity again returns metadata only |
| SV-2 | D | Request a token with its secret and decode it | Subject is `fixture-service`; the verifier reports kind `service`; no person's identifier appears |
| SV-3 | D | Rotate the secret | Old and new both obtain tokens during the overlap; only the new one after it ends |
| SV-4 | D | Revoke the identity | Token requests are `401`; a token issued earlier is rejected no later than its expiry |
| SV-5 | D | Ask the helper whether it may `read` and `use` `item-1` | `read` allow; `use` deny |
| SV-6 | D | Request a token with a wrong secret, 20 times | `401` each, then `429` |
| SV-7 | D | Confirm Access's own service identity exists for calling Persist | It obtains a token; its subject names Access |

### `user-records`

Prerequisite outside Access for D\*: Persist with a user record type in its lexicon.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| UR-1 | F | Create `alice` | Exactly one publication to the Persist fake, sent with Access's own service identity, containing only the fields the lexicon declares for a user |
| UR-2 | F | Make the Persist fake fail, then sign in as `bob`, then restore it | Sign-in succeeds while Persist fails; `bob`'s record is delivered after recovery |
| UR-3 | F | Deliver the same user event twice | One record, same identifier |
| UR-4 | F | Change, disable and remove a user | The record is updated, marked disabled and marked removed in turn |
| UR-5 | F | Compare every published payload with the list of tokens and markers | None present |
| UR-6 | F | Create the `viewer` role, assign it to `carol`, then unassign it | One group record for the role, sent with Access's own identity; nothing published says who holds the role, on assignment or on unassignment |
| UR-7 | D\* | Create a user, then read the record through Persist | The record appears within five minutes with the expected identifier and fields |

### `resource-sharing`

Resource `fixture:item/item-1`, owned by `alice`. Ask the decision helper after each step.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| RS-1 | D | No grant yet: `bob` asks to `use` | deny |
| RS-2 | D | `alice` grants `bob` `use` | `201`; `bob` `use` is allow; audit record names `alice` |
| RS-3 | D | `alice` grants the `viewer` role `read`, a shareable action of this type | `carol` `read` is allow; `carol` `use` is deny |
| RS-4 | D | `alice` tries to grant `bob` `manage`, then `remove` | `400` both; neither becomes allow |
| RS-5 | D | `bob` tries to grant `carol` `use` | `403`; `carol` `use` stays deny |
| RS-6 | D | List grants on the item as `alice`, then as `bob` | `alice` sees both grants; `bob` gets `403` |
| RS-7 | D | `alice` revokes `bob`'s grant | `204`; `bob` `use` is deny on the next question; audit record written |
| RS-8 | D | Send the same grant twice | One grant stored |
| RS-9 | D | `alice` shares `secret-a` with `bob`; she then tries to share `read` on it; then `admin` and the environment each try to share it with `carol` | `bob` `use` is allow; `400` for `read`; `403` for `admin` and the environment; `carol` `use` stays deny |
| RS-10 | D | `admin` shares `secret-env` with `alice`; `alice` then tries to share it with `bob` | `alice` `use` is allow; `403` for her share; `bob` `use` stays deny |
| RS-11 | D\* | Run Connect checks `UC-3` to `UC-11` with real Connect credentials | They pass. Needs Connect's per-user checks |

### `record-access`

Uses the graph fixture. Prerequisite outside Access for D\*: Persist's
user-scoped access.

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| RA-1 | F | As `admin`, connect `alice` to `scope-a` | Exactly one grant edge is written to the Persist fake, by Access's own service identity; audit record written |
| RA-2 | F | List `alice`'s connections, then revoke | The list shows `scope-a`; after revoking, the edge is removed |
| RA-3 | F | Connect the `viewer` role to `scope-b` | One grant edge from its group record `group-g` to `scope-b`; no membership edge is written |
| RA-9 | F | Inspect every write Access sent to the Persist fake in this piece | Only user records, group records and grant edges; no scope, item or structural edge |
| RA-10 | F | Make the Persist fake fail, then revoke `alice`'s connection; restore it and revoke again | An error the first time, with the connection still listed and no audit record of a revoke; removed and audited the second time |
| RA-4 | F | Connect as `bob`, then with no credential | `403`, then `401`; no edge written |
| RA-5 | F | Send the same connection twice | One edge |
| RA-6 | F | Scan Access's own stores after the run | They hold connection and audit records only; no item content |
| RA-7 | D\* | Connect `alice` to `scope-a`, then run Persist checks `UA-1` to `UA-5` | They pass |
| RA-8 | D\* | Revoke, then run Persist check `UA-12` | It passes |

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

### `product-integration`

The integrating product's builder owns its own checks. Access is done with this
piece for a product when:

| ID | Level | Do | Pass when |
| --- | --- | --- | --- |
| PI-1 | F | Install the shared verifier and decision helper from their published versions in a clean project | Both install and pass `TC-3` and `PM-8` there |
| PI-2 | D\* | Run that product's checks: Persist `UA-*`, Connect `UC-*`, Console `CS-*` | All pass |
| PI-3 | D\* | Use one token, obtained through one application, against Persist, Connect and Console | Accepted by all three as the same user, with no second sign-in |
| PI-4 | D\* | Call the product with only the environment key | Works as before; recorded as the environment, not a person |
| PI-5 | D\* | Call the product with no token and no key | `401` |

## Negative-test matrix

Each defect of [the earlier sign-in service](prior-implementation.md) must stay
impossible. A piece that touches the area re-runs its row.

| Earlier defect | Proven absent by |
| --- | --- |
| Test bypass in production | `NB-1`, `SI-15`, `SI-18`, `SI-19` |
| Unverified tokens | `TC-3` |
| Fail-open check | `TC-7`, `PM-8` |
| Unprotected administration | `RI-1`, `AP-6`, `US-4`, `US-8`, `PM-9`, `RA-4` |
| Credentials in logs | `LS-1` |
| Tokens in URLs | `SI-1`, `SI-17` |
| Long-lived, weakly bound sessions | `TC-1`, `SI-7`, `SI-8`, `SI-9` |
| Lookup by scan | `AP-7` |
| Email as identity | `SI-3`, `SI-21` |
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
3. Pass only with zero matches, apart from these expected places:
   - the single response that returned a secret or token to its owner;
   - the provider's code in the provider's redirect to the Access callback, and
     an Access code in Access's redirect to the application, which the sign-in
     flow requires. A code anywhere else, including a log line, is a match.

A token or marker found anywhere else fails the piece, whatever else passed.

## Cumulative scenario

Run `E2E-1` when Access, Persist and Connect are all integrated. It is the final
acceptance for the product and needs every piece above.

| Step | Do | Pass when |
| --- | --- | --- |
| 1 | The environment key makes `admin` an administrator; `admin` signs in, creates the roles and invites `carol` | `PM-1`, `PM-3` |
| 2 | `alice` and `bob` sign in once, through `app-one` | Two distinct users; both records readable in Persist |
| 3 | `admin` connects `alice` to `scope-a` | One access edge |
| 4 | With those same sessions, `alice` and `bob` each query Persist's GraphQL for items, and search for `quarterly fixture report` | `alice` gets `item-a1` and `item-a2`, and one search hit; `bob` gets nothing. Neither signed in again |
| 5 | `alice` creates a Connect credential and starts a flow that uses it; `bob` starts the same flow | `alice`'s job runs; `bob`'s is refused before any partner call |
| 6 | `alice` grants `bob` `use`; `bob` starts the flow | It runs |
| 7 | `admin` disables `alice`; she retries steps 4 and 5 after her token expires | Both refused |
| 8 | Call Persist and Connect with only the environment key | Both work as before |
| 9 | Run the leak scan and cleanup | Nothing found; nothing left behind |
