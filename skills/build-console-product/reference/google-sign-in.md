# Console Google sign-in access policy

Use this contract for the `google-oidc` access policy: Google Workspace sign-in
(OpenID Connect) for every application on a Console deployment. Read it before
any change to Console pages, components, routes, the renderer shell, the API
dispatcher or the web runtime. A change that weakens a guarantee below is a
defect, even when the change was about something else.

## Target: sign-in through Access

Console integrates with Access instead of running its own sign-in. The
`google-oidc` policy described in the rest of this contract is the existing
behavior. It stays in force only until Access sign-in is verified on a
deployment; add no capability to it.

- Register Console as an Access application with its exact callback and
  sign-out addresses. Access holds the Google client; Console holds no Google
  client ID or secret after migration.
- Send an unauthenticated visitor to Access. On return, verify the Access token
  with Access's shared verifier (signature, issuer, audience, expiry, token
  type) and issue the Console read session from it. Fail closed on any
  verification error.
- A Console session is valid only while it holds an unexpired Access token.
  When that token expires, refresh through Access before serving anything, and
  carry on with the new token; a failed refresh ends the session. Take the
  roles from each refreshed token, so a disabled person or a removed role takes
  effect within one access-token lifetime.
- How long a person stays signed in overall is Access's refresh lifetime, not a
  Console setting. After migration Console has no `sessionSeconds`; that value
  belongs to the `/console/access-policy` parameter, which is removed.
- Take who may sign in from Access (its allowed Google domains and its users)
  and who may open a route or run an action from Access roles. Move
  `allowedDomains`, `allowedUsers` and `allowedGroups` to Access; do not keep a
  second copy of those rules in Console.
- Keep every guarantee below that is not about Google itself: deny by default,
  server-side checks on every route, bounded sessions, sign-out, no credential
  or token in logs, bundles or static assets, and the route inventory test.
- Migrate one deployment at a time: verify Access sign-in for the same users,
  then remove `/console/access-policy`, the Google client secret and the
  viewer password. Do not run both sign-ins as a permanent state.
- Access (`aegislash`) owns sign-in, tokens and roles. Console (`chandelure`)
  owns this integration. A missing Access capability is a gap to report, not a
  reason to extend `google-oidc`.

### Definition of done for `access-sign-in`

The piece is done only when every check below exists as an automated browser or
API test whose name starts with its ID and passes against a test deployment with
Access installed. Use the people from [the Access test data](../../build-access-product/reference/test-data.md),
with Console registered as an Access application. Record one evidence row per
check: ID, result, request identifier and the Console revision.

| ID | Do | Pass when |
| --- | --- | --- |
| CS-1 | Open a Console page with no session | Redirected to Access sign-in start for the Console application; no page content served |
| CS-2 | Sign in as `alice` | The page renders; the session's subject is her Access user identifier |
| CS-3 | A user without the route's role opens the route, then calls its action directly | `403` from the server for both, not only a hidden link |
| CS-4 | Return to the callback with an expired token, an edited one and one issued by another environment | No session created for any |
| CS-5 | Disable `dave` in Access, then advance past his access token's expiry | His next request triggers a refresh that fails; the session ends, he is sent to sign in and is refused there |
| CS-6 | Sign out, then press back and request a protected route | No protected content served |
| CS-7 | Run the route inventory, add one page, change another, run it again | Every route requires a session in both runs |
| CS-8 | After migration, inspect the deployment | No `/console/access-policy` parameter, no Google client secret, the viewer password route answers not found, and Console's role cannot read a Google client secret |
| CS-9 | Search the run's logs, responses, static assets and bundles for every token issued | None found |
| CS-10 | Remove the role that lets `alice` open a route, then advance past her access token's expiry | After the refresh her next request to that route is `403`; routes her remaining roles allow still work |
| CS-11 | Keep `alice` active across three access-token lifetimes, inspecting her session each time | She is not asked to sign in again; at every moment the session's expiry is no later than that of the Access token it currently holds |

## Ownership

This section and those after it describe a deployment that has not yet migrated
to Access. Google is the identity provider. Console owns the policy that decides who may
open its applications: it verifies Google ID tokens, applies the configured
domain/user/group rules and issues its own read session. Account still owns API
keys, operator credentials and product scopes; do not move them into Console and
do not issue scopes beyond what the viewer session already grants
(`console:read`, `report:read`). Vivillon configures the policy for an
environment; Chandelure builds and maintains it.

## Policy settings

Keep the policy per environment, outside code and outside application manifests,
so it applies to every application and route on that deployment. Store the
non-secret settings in an SSM parameter and the OAuth client in a secret store:

```json
{
  "kind": "google-oidc",
  "clientSecretRef": "arn:aws:secretsmanager:<region>:<account>:secret:console/<name>",
  "redirectUri": "https://<shared domain>/console/viewer/auth/google/callback",
  "allowedDomains": ["example.com"],
  "allowedUsers": [],
  "allowedGroups": [],
  "sessionSeconds": 43200,
  "passwordSignIn": "disabled"
}
```

- `clientSecretRef` names a Secrets Manager secret holding
  `{"client_id": "...", "client_secret": "..."}`. Read it at runtime with
  `secretsmanager:GetSecretValue`, granted only on secrets under `console/`;
  cache it briefly in memory. Never accept the client ID or secret as a literal
  anywhere.
- `redirectUri` is the environment's callback on its console domain. It is
  `https` and its path is exactly `/console/viewer/auth/google/callback`.
- `allowedDomains` is required and non-empty. Match it against the ID token's
  `hd` claim, never the email suffix alone.
- `allowedUsers` (emails) and `allowedGroups` (Workspace group emails) narrow
  access further when present. Group membership needs a Directory or Cloud
  Identity lookup; fail closed when it is configured but unreadable.
- `sessionSeconds` bounds a session from sign-in; refuse values outside
  15 minutes to 24 hours.
- `passwordSignIn` is `disabled` or `enabled`. `enabled` keeps the viewer
  password next to Google sign-in during migration. `disabled` makes
  `POST /viewer/session` answer `NOT_FOUND` even if `/console/viewer-access`
  still exists.
- The parameter is `/console/access-policy`. A missing policy parameter means
  Google sign-in is off. A malformed or
  unreadable one fails closed: no sign-in, no viewer reads.

## Sign-in flow

Use the authorization code flow with PKCE, run on the server. The routes sit
under the API's `/viewer` prefix, so on the shared domain they are
`/console/viewer/...`:

1. `GET /viewer/auth/google/start` creates single-use `state`, `nonce` and PKCE
   verifier, stores them server-side with a short TTL and redirects to Google
   with `hd` set to the first allowed domain and `prompt=select_account`.
2. `GET /viewer/auth/google/callback` rejects a missing, reused or mismatched `state`,
   exchanges the code with the client secret, and verifies the ID token:
   signature against Google's JWKS, `iss`, `aud` equal to the client ID, `exp`,
   `nonce`, `email_verified`, then `hd`, users and groups. Any failure redirects
   to `/console/app/?signin=denied&reason=<code>`, never a token or claim dump.
3. On success create a server-side session record (subject email, policy
   revision, expiry) and set an `HttpOnly`, `Secure`, `SameSite=Lax` cookie
   scoped to the Console path on the shared domain. Verify that the renderer and
   API share that origin before relying on the cookie; if they do not, return a
   short-lived bearer token held only in memory, as the viewer flow does.
4. `POST /viewer/signout` deletes the session record and clears the cookie. The
   next request is refused and the renderer shows sign-in again.

`GET /viewer/sign-in-options` tells the renderer which methods are on
(`{"google": bool, "password": bool}`). Take the redirect URI from the policy for
the environment's console domain. Never build it from the `Host` header, a query parameter or
configuration supplied by an application.

## Invariants that keep sign-in working

Hold all of these on every change:

1. **Deny by default.** The API dispatcher authorizes every route before any
   handler runs. Only a fixed, tested list (`PUBLIC_ROUTES` in
   `src/handlers/api.ts`) is public: `GET /health`, `GET /viewer/sign-in-options`,
   `GET /viewer/auth/google/start`, `GET /viewer/auth/google/callback`,
   `POST /viewer/signout`, and `POST /viewer/session`, which answers `NOT_FOUND`
   unless the policy keeps the password. Every public route is marked
   `security: []` in the OpenAPI contract, and the route-inventory test requires
   the two lists to match. A new route is protected without any per-route code. Never add a route that skips
   the shared guard.
2. **Server-side enforcement.** Hiding a page or button in the renderer is not
   access control. Every data, report and configuration read checks the session
   in the API.
3. **Renderer gate.** The shell checks the session before rendering any
   application route, including deep links. Without one it shows a sign-in page
   and loads no configuration or data. When Google sign-in is on, that page opens
   on "Sign in with Google", which links to `/console/viewer/auth/google/start`
   with a return path limited to `/console/app/`. The API key stays available
   behind a secondary link for operators. Page and
   component code fetches only through the shared authenticated API client.
4. **Pages are configuration.** Adding or changing a page or component changes
   the manifest or registry, not the guard. If a change seems to need its own
   auth handling, stop and treat it as a policy change.
5. **Expiry and sign-out are server-side.** Reject a session past
   `sessionSeconds` or after sign-out even if the browser still holds it.
6. **No credentials outside the secret store.** The client secret, codes, ID
   tokens, access tokens and session cookies never appear in source, manifests,
   configuration bundles, static assets, URLs, browser storage or logs. Log the
   decision, the domain, the reason code and a request ID only.
7. **Operator access stays separate.** The environment API key keeps working for
   operators and automation; Google sessions never gain write, publish or action
   scopes.

## Required tests

Keep these in the default test run so every change exercises them. Use one
fake Google issuer module (local JWKS, signed test ID tokens), shared by the unit
tests and the browser harness; never call Google from CI. Tie each issued token
to its one-time code, because parallel browser sign-ins otherwise swap tokens.

| Case | Expected |
| --- | --- |
| Allowed-domain user completes callback | Session created; application and report reads succeed |
| User from another Google domain | Denied; no session record; reason `domain_not_allowed` |
| Personal account (no `hd` claim) | Denied; reason `domain_not_allowed` |
| Request with no session | API `UNAUTHORIZED`; renderer shows Google sign-in and loads no data |
| Sign-out | Session record gone; next request is refused and sign-in shows again |
| Session past `sessionSeconds` | Rejected; sign-in shows again |
| Reused or mismatched `state`, wrong `aud`, bad signature, wrong `nonce` | Denied |
| `passwordSignIn: disabled` | `POST /viewer/session` returns `NOT_FOUND`; older viewer tokens are rejected; the renderer opens on Google sign-in |
| API route inventory | Every OpenAPI operation outside the public list rejects a request without credentials, directly and under `/viewer` |
| Renderer route inventory | For each manifest route, every binding it reads rejects a request without a session and succeeds with an allowed one; renderer routes are hash routes the server never sees, so they are covered through their bindings |
| Secret scan | No client secret, token or private key in tracked files or built assets |

The route-inventory tests are what make later page work safe: they fail when a
new route or page bypasses the guard, without anyone remembering to add a test.

## Change checklist

For any change to Console pages, components, routes or the runtime:

1. Keep pages and components in configuration or the registry; do not touch the
   guard unless the task is a policy change.
2. Run the sign-in suite and the route-inventory test; both must pass.
3. For a new route, show in a browser that opening its deep link without a
   session shows Google sign-in and no data, and that it renders with an allowed
   session. Locally, use the `installed-google` Playwright project
   (`GOOGLE_SIGN_IN=fake`), which runs the real handler against the fake issuer;
   browsers accept the `Secure` session cookie on `http://127.0.0.1`. Then
   confirm once in the hosted runtime when the change is installed.
4. Report the sign-in evidence with the change. Never report unrun sign-in
   checks as passing.

## Rollback

Keep each environment's policy as a file in its configuration repository, because
deleting the SSM parameter also deletes its history. Roll back by deleting
`/console/access-policy`, which ends every Google session and brings back the
viewer password if `/console/viewer-access` still exists; restore by writing the
file back. Each change reaches every instance within the 5-minute policy cache,
so wait until `/console/viewer/sign-in-options` shows it several times in a row. If the OAuth
client may be exposed, rotate the client secret in Google Cloud and update the
secret value, or delete the client to stop all Google sign-ins. Existing
sessions end when their records are deleted.
