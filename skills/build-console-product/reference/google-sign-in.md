# Console sign-in contract

Use this contract for who may open what on a Console deployment: every app and
every dashboard. People sign in through Access. Console's own `google-oidc`
access policy (Google Workspace sign-in run by Console itself) and the viewer
password were removed in runtime 1.34.0
([Console pull request 71](https://github.com/prismteam-ai/console/pull/71));
see [Retired: Console's own sign-in](#retired-consoles-own-sign-in). Read this before any change to Console pages,
components, routes, the shell, app hosting, the API dispatcher or the web
runtime. A change that weakens a guarantee below is a defect, even when the
change was about something else.

## Target: sign-in through Access

Console integrates with Access instead of running its own sign-in. Never bring
back a Console-run sign-in, password or browser-held key; a missing Access
capability is a gap for `aegislash`.

- Register Console as an Access application with its exact callback and
  sign-out addresses. Access holds the Google client; Console holds no Google
  client ID or secret.
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
  Console setting. Console has no `sessionSeconds`.
- Take who may sign in from Access (its allowed Google domains and its users)
  and who may open a route or run an action from Access roles. Move
  `allowedDomains`, `allowedUsers` and `allowedGroups` to Access; do not keep a
  second copy of those rules in Console.
- Call other products as the signed-in person. When a page's data or action
  binding calls Persist, Connect or another product for a signed-in person,
  send that person's current Access token and never the shared key, so each
  product applies its own per-user rules. A binding that used the shared key
  would be the environment and would show every person the same records.
  Refresh first when the token has expired, and fail the binding closed when
  the refresh fails.
- Hold apps to the same rules as dashboards. The shell owns the session and
  loads an app's code only after sign-in. An app never receives, stores or
  sends a token: its data hooks call Console's API, and Console forwards the
  person's Access token to the owning product. Give each app its own required
  roles in Access, so a role for one app opens no other. The route inventory
  lists every published app and every dashboard route.
- Hold [the invariants that keep sign-in working](#invariants-that-keep-sign-in-working)
  on every change, and keep the route inventory tests.
- The public list is: health, sign-in options, sign-in start and the sign-in
  callback, plus sign-out, which needs no session to clear a cookie. Every
  viewer route needs the Console session. They are Console's declared keyless
  methods under
  [the publish readiness gate](../../guide-product-work/reference/shared-api-domain.md#publish-readiness-gate).
- Access (`aegislash`) owns sign-in, tokens and roles. Console (`chandelure`)
  owns this integration.

### Definition of done for `access-sign-in`

The piece is done only when every check below exists as an automated browser or
API test whose name starts with its ID and passes against a test deployment with
Access installed. Run `CS-1` to `CS-15` twice: against a dashboard page and
against a published app from [the test data](test-data.md). `CS-4b` alone runs
in the repository against a fake Access token endpoint, because a real Access
never returns a bad token. Use the people from [the Access test data](../../build-access-product/reference/test-data.md),
with Console registered as an Access application. Record one evidence row per
check: ID, result, request identifier and the Console revision.

| ID | Do | Expect |
| --- | --- | --- |
| CS-1 | Open a Console page with no session | Redirected to Access sign-in start for the Console application; no page content served |
| CS-2 | Sign in as `alice` | The page renders; the session's subject is her Access user identifier |
| CS-3 | A user without the route's role opens the route, then calls its action directly | `403` from the server for both, not only a hidden link |
| CS-4 | Return to Console's callback with an Access code that is replayed, one that has expired and one issued for another application's address | No session created for any; nothing but a one-time code is ever accepted in the callback address |
| CS-4b | With a fake Access token endpoint, make the code exchange return an expired token, an edited one and one issued by another environment | Console's verifier rejects each; no session created |
| CS-5 | Disable `dave` in Access, then advance past his access token's expiry | His next request triggers a refresh that fails; the session ends, he is sent to sign in and is refused there |
| CS-6 | Sign out, then press back and request a protected route | No protected content served |
| CS-7 | Run the route inventory, add one page, change another, run it again | Every route requires a session in both runs |
| CS-8 | Inspect the deployment | No `/console/access-policy` or `/console/viewer-access` parameter, no Google client secret, the three retired sign-in routes answer not found, and Console's role cannot read any `console/` secret but `console/access-service` |
| CS-9 | Search the run's logs, responses, static assets and bundles for every token issued | None found |
| CS-10 | Remove the role that lets `alice` open a route, then advance past her access token's expiry | After the refresh her next request to that route is `403`; routes her remaining roles allow still work |
| CS-11 | Keep `alice` active across three access-token lifetimes, inspecting her session each time | She is not asked to sign in again; at every moment the session's expiry is no later than that of the Access token it currently holds |
| CS-12 | `alice`, connected to `scope-a`, and `bob`, connected to nothing, open the same page whose binding lists items from Persist | `alice` sees `item-a1` and `item-a2`; `bob` sees none |
| CS-13 | Inspect the outbound calls Console made for `CS-12` and for an action a role allows | Each carries that person's Access token and no shared key |
| CS-14 | A user holding the role for an action runs it | It runs, and the product it calls records that person as the caller |
| CS-15 | Open the sign-in page | It offers sign-in through Access only; there is no field or link for an API key |
| CS-15b | Sign in as `dave`, who holds no role, then sign out | One sign-in round trip, then the no-access page with the request ID and no further redirect; Sign out shows the signed-out page without starting a sign-in |
| CS-16 | Run the route inventory with `sample-app` and `sample-app-two` published, publish a third app, run it again, and request each app's files and bindings with no session | Every published app is listed in both runs, and each is refused without a session: no app code or data is served |
| CS-17 | `alice`, who holds the role for `sample-app` only, opens `sample-app`, then opens `sample-app-two` and calls one of its bindings directly | `sample-app` renders; `sample-app-two` and its binding answer `403` from the server |

### Access sign-in implementation rules

The first step of `access-sign-in` is on
[Console pull request 40](https://github.com/prismteam-ai/console/pull/40)
(runtime 1.22.0) and authorization from Access roles on
[Console pull request 43](https://github.com/prismteam-ai/console/pull/43)
(runtime 1.26.0); both are on `main`. Console's own sign-in was removed on
[Console pull request 71](https://github.com/prismteam-ai/console/pull/71)
(runtime 1.34.0). Keep these rules when changing them.

- **One switch per deployment.** The String parameter `/console/sign-in`
  (`{"kind": "access", "application": "console", "accessUrl":
  "https://<shared domain>/access", "redirectUri":
  "https://<shared domain>/console/viewer/auth/access/callback",
  "serviceSecretRef": "<ARN of the Secrets Manager secret console/access-service>"}`,
  closed schema, `https` only) is the only way in. Without it nobody signs in
  in a browser: viewer routes answer `401` `access_not_configured`, the Access
  start and callback `404`, `sign-in-options` `{"access": false}`, and the page
  says sign-in is not set up and never redirects. A malformed or unreadable
  parameter fails closed.
- **One secret.** `serviceSecretRef` names the Secrets Manager secret
  `console/access-service`, which holds Console's Access service identity as
  `{"client_id", "client_secret"}`, never the secret itself. From runtime
  1.34.0 it must be that secret's ARN in Console's own partition, region and
  account (the stack passes it as `CONSOLE_ACCESS_SERVICE_SECRET_ARN`),
  exactly or followed by `-` and Secrets Manager's six letters or digits; any
  other value fails closed as `UPSTREAM_CONTRACT_INVALID` (`502`). Console's
  role may read only `console/access-service-??????`; never widen it back to
  `console/*`, which would let it read any other client secret under
  `console/`.
- **Routes.** `GET /viewer/auth/access/start` and
  `GET /viewer/auth/access/callback` are public. The callback takes only the
  one-time code and the state; any failure redirects to
  `/console/app/?signin=denied&reason=<code>` with no cookie.
  `POST /viewer/signout` also ends the Access session, for every application.
  `GET /viewer/sign-in-options` answers `{"access": <boolean>}` only. The
  retired `GET /viewer/auth/google/start`, `GET /viewer/auth/google/callback`
  and `POST /viewer/session` (`RETIRED_SIGN_IN_ROUTES`) answer `404`
  `NOT_FOUND` before any session is resolved; any other unknown `/viewer/`
  path answers `401`. `POST /viewer/session` stays at the gateway so the API,
  not API Gateway, answers it.
- **Server-side exchange, in the browser that started.** Each start sets its
  own ten-minute cookie, `console_access_login_<digest of the state>`
  (`HttpOnly`, `Secure`, `SameSite=Lax`, path `/console/viewer/auth/access`),
  so sign-ins in two tabs stay independent; the pending login keeps only its
  digest. The callback refuses a missing or different cookie. Once the login
  is matched, a later failure returns to its page with
  `signin=denied&reason=<code>`.
  Exchange the code at Access's `/token` with the login's PKCE verifier,
  `client_id` the application name and no client secret, as Access defines
  it.
- **Verifier.** Verify with `jose` exactly as
  [product integration §2](../../build-access-product/reference/product-integration.md#2-verify-a-callers-token)
  shows, and also require `aud` to be exactly the environment's origin (a string,
  never a list), `token_use: access`, string `roles` and a person's
  token (`principal_kind` user). Access ships no client library; do not copy
  its in-repository verifier.
- **Sealed session.** Keep the access and refresh tokens server-side, sealed
  together with KMS Encrypt on Console's own session key, granted to the API
  function only and only under the encryption context
  `purpose=console-access-session`. Never put a token in the cookie, a log
  line, an answer or the table in the clear.
- **Validity and refresh.** The session is valid until the held token's `exp`.
  A request within 60 seconds of it refreshes through Access first. A refresh
  Access refuses (`/token` error code `INVALID_GRANT` or `UNAUTHENTICATED`)
  deletes the session and answers `401`; any other `400` or `401` is an
  upstream failure. Access or its keys
  unreachable answers `503`, and a `200` without a token answers `502`; both
  keep the session. Only `jose` errors about the token itself count as a bad
  token. Write a refreshed session only while it still exists, so a sign-out
  during a refresh stays signed out. Never use a token past its raw `exp`, or
  one whose `iat` is more than 60 seconds ahead.
  Access does not rotate refresh tokens.
- **Identity.** The session's subject is the Access user identifier, never an
  email. `Principal.accessToken` is the current token, forwarded to products
  for a person's reads.
- **Roles decide, as Console's service identity.** Console asks Access as
  itself (`POST /service-token` with the identity's secret, then
  `POST /decisions/batch` with the person's token) at sign-in and at every
  refresh, and keeps the answers in the sealed session's record, so a removed
  role ends what it allowed within one access-token lifetime. Anything but
  `allow` is a deny. Access unreachable refuses a sign-in and answers a refresh
  `503`, keeping the session; never store a deny, or allow anything, for a
  failure. Cache the service token until a minute before it expires, drop it
  on a `401`, and never retry a refused token in a loop.
- **Scopes through INTERIM stand-ins.** Console's scopes (`report:read`,
  `model:review`, ...) belong to the products that own them, and none declares
  them in Access yet. Until each does, Console declares one type-level
  stand-in per scope, `console:scope:<scope with ":" as "-">` (such as
  `console:scope:model-review`), in `src/domain/access-permissions.ts`
  (`INTERIM_SCOPES`), and the session holds the scopes Access allows of them.
  The list never holds `console:configure` or `console:publish`: configuring
  and publishing stay with the environment key. When a product declares its
  own permission, map its scope to that permission and drop the stand-in; when
  every product has, remove the `scope` type. Mark every stand-in INTERIM in
  code and text.
- **Per-app roles.** Console declares `console:app` with the shareable action
  `use`. Publishing or rolling back an app registers it with
  `PUT /resources/console/app/<appId>` as environment-owned before selecting
  it (Access unreachable: `503`, nothing selected; another owner: `409
  CONFLICT`). An operator gives the app its role and shares `use` on it with
  that role. A session opens an app, its files, bindings and actions only when
  Access allows `use` (`403 FORBIDDEN` otherwise); the check is in
  `AppService`, not the route. Ask about an app when the person first opens
  it, keep the answer in the session, and ask again at each refresh. An
  app's settings `roles` are names only: Console never shares, so name the
  Access role after them.
- **Refusals.** A dashboard binding or action the manifest declares but the
  caller's scopes hide answers `403`; one it does not declare `404`. A session
  runs a dashboard's or an app's declared action, same-origin JSON only, when
  its roles give the action's scopes.
- **The declaration is applied by an operator.** Console ships it as
  `requirements/access-declaration.json`, generated from the code and checked
  by a test. Console's service identity holds only `access:decision:read` and
  `access:resource:manage`; never give it `access:declaration:manage` or
  `access:resource:share`.
- **Sign-in page.** On an Access deployment the page goes straight to Access;
  after a denial or an ended session it offers sign-in through Access only.
  Only a `401` from `GET /viewer/session` means signed out. A `403` is a person
  Access signed in who holds no role giving `console:read`: show a no-access
  page ("You're signed in, but you don't have access to Console. Ask an
  administrator for a role.") with the request ID and a Sign out button
  (`POST /viewer/signout`, then the signed-out page). Never redirect from it:
  Access's own session signs the person straight back in, and the page loops
  about once a second. Any other failed check shows a retry page, not sign-in.
  As a safety net, redirect to Access by itself at most once per short window
  in a tab (Console uses 30 seconds in `sessionStorage`, cleared when a session
  loads); a sign-in back without a session inside that window shows the Sign in
  link. Apply the same rules on an app page (`?appId=`).
- **No target.** `/console/app/` with neither `?app=` nor `?appId=` opens no
  default dashboard. Console has no route listing what a session may open, so
  the page says "Choose an app" and explains `?appId=` instead of answering a
  `404` for a dashboard the environment never published.
- **Code layout.** Session resolution and the sign-in routes live in
  `src/handlers/viewer-session.ts`, the adapter in
  `src/adapters/access-sign-in.ts`, Console's calls as its service identity in
  `src/adapters/access-authorization.ts`, the declaration and questions in
  `src/domain/access-permissions.ts`, and a fake Access that keeps the real
  one's code, refresh, sign-out, service-token, decision and resource rules
  (decisions from the roles the person's token carries) in
  `test/support/fake-access.ts`
  (the `installed-access` Playwright project serves it on the stand-in's
  origin).
- **Operator setup in Access** (Doublade, with the environment key), once per
  environment: register the application `console` with the exact callback
  address; `PUT /access/declarations/console` with
  `requirements/access-declaration.json`; `POST /access/service-identities`
  `{"name": "console", "grants": ["access:decision:read",
  "access:resource:manage"]}` and put the `201`'s `client_id` and
  `client_secret` into `console/access-service`; create the roles (for the
  test data: `member` granting `console:scope:console-read` and
  `console:scope:persist-read`, `report-reader` granting
  `console:scope:report-read`, `sample-app-viewer` and `sample-app-two-viewer`
  with no grant) and assign them (`alice` and `bob`: `member`,
  `report-reader`, `sample-app-viewer`); after each app's first publish,
  share `use` on `console/app/<appId>` with its role. Apps published before
  the switch are registered by publishing or rolling back once more.
- **Open.** Verified on soofi-safavi on 2026-11-24: every check passes except
  `CS-12`, `CS-13` and `CS-14` (Console 1.33.0; `CS-8` on 1.34.0 after the
  operator cleanup). `CS-13` waits with `CS-12` and `CS-14`, since it inspects
  their calls. The INTERIM stand-ins stay until Report, Persist, Model and
  System declare their own permissions. `CS-12` waits on Persist user-scoped
  reads and `CS-14` on a product action that records the person. Access
  sign-out is not retried once Console's session is deleted (a failure is
  counted as `AccessSignOutFailed`), and CloudFront standard logs record the
  callback query.

## Retired: Console's own sign-in

Runtime 1.34.0 removed Console's own sign-in. Do not rebuild any of it:

- the `google-oidc` policy in the SSM parameter `/console/access-policy`, its
  Google OAuth client secret (`console/google-oauth`) and
  `GET /viewer/auth/google/start` and `/callback`;
- the viewer password in `/console/viewer-access`, `POST /viewer/session`,
  viewer tokens and `scripts/set-viewer-password.ts`;
- the sign-in page's Google, password and environment-key screens. The browser
  holds no key or token and reads only through `/viewer` with its Access
  session cookie.

The environment key keeps working for operators, Deploy and checks calling the
API directly. `CS-8` checks the removal on a deployment: no
`/console/access-policy` or `/console/viewer-access` parameter, no Google
client secret, the three retired routes answer `404`, and Console's role
cannot read any `console/` secret but `console/access-service`. The two
parameters and the secret are not stack resources: an operator deletes them
after 1.34.0 is verified (save `/console/access-policy`'s value first, and
schedule the secret's deletion with a recovery window).

## Invariants that keep sign-in working

Hold all of these on every change:

1. **Deny by default.** The API dispatcher authorizes every route before any
   handler runs. Only a fixed, tested list (`PUBLIC_ROUTES` in
   `src/handlers/api.ts`) is public: `GET /health`, the sign-in routes in
   `VIEWER_SIGN_IN_ROUTES` (`GET /viewer/sign-in-options`,
   `GET /viewer/auth/access/start`, `GET /viewer/auth/access/callback`,
   `POST /viewer/signout`) and the design-system stylesheet. Every public route
   is marked `security: []` in the OpenAPI contract, and the route-inventory
   test requires the two lists to match. A new route is protected without any
   per-route code. Never add a route that skips the shared guard.
2. **Server-side enforcement.** Hiding a page or button in the renderer is not
   access control. Every data, report, app and action read checks the session
   and its Access decisions in the API.
3. **Renderer gate.** The shell checks the session before rendering any
   dashboard route or loading any app, including deep links. Without one it
   sends the person to Access and loads no configuration, app code or data.
   There is no field or link for an API key: the environment key is never
   typed into a browser. Page and component code fetches only through the
   shared authenticated API client.
4. **Pages are configuration or app code.** Adding or changing a dashboard page
   changes the manifest or registry; adding or changing an app changes its
   delivered version. Neither touches the guard. If a change seems to need its
   own auth handling, stop and treat it as a sign-in change.
5. **Expiry and sign-out are server-side.** A session ends when its Access
   token cannot be refreshed, or at sign-out, even if the browser still holds
   the cookie.
6. **No credentials outside the secret store.** Codes, access and refresh
   tokens, the service identity's secret and session cookies never appear in
   source, manifests, configuration bundles, static assets, URLs, browser
   storage or logs. Log the decision, the reason code and a request ID only.
7. **Operator access stays separate.** A session's permissions are the
   person's Access roles, including the actions those roles allow.
   Configuration and publish operations stay behind the environment key and
   Account's service authorization, called from tools and never from the
   browser session.

## Required tests

Keep these in the default test run so every change exercises them. Use the
fake Access in `test/support/fake-access.ts`, shared by the unit tests and the
`installed-access` Playwright project; never call a real Access from CI.

- The `CS-` checks that run in the repository, named by their IDs, including
  `CS-4b` and `test/cs-8.test.ts` (retired routes, template and the
  `console/access-service` grant).
- The API route inventory: every OpenAPI operation outside the public list
  rejects a request without credentials, directly and under `/viewer`.
- The renderer route inventory: for each manifest route and each published
  app, every binding it reads rejects a request without a session and succeeds
  with an allowed one. Renderer routes are hash routes the server never sees,
  so they are covered through their bindings.
- The browser credential check: the `api` project's specs fail if the browser
  sends `x-api-key` or `Authorization` (`e2e/support/browser-credentials.ts`).
- The secret scan: no client secret, token or private key in tracked files or
  built assets.

The route-inventory tests are what make later page work safe: they fail when a
new route or page bypasses the guard, without anyone remembering to add a test.

## Change checklist

For any change to Console pages, components, routes, app hosting or the runtime:

1. Keep pages and components in configuration, the registry or a delivered app
   version; do not touch the guard unless the task is a sign-in change.
2. Run the sign-in suite and the route-inventory test; both must pass.
3. For a new route, show in a browser that opening its deep link without a
   session sends the person to Access and serves no data, and that it renders
   with an allowed session. Locally, use the `installed-access` Playwright
   project, which runs the real handler against the fake Access; browsers
   accept the `Secure` session cookie on `http://127.0.0.1`. Then confirm once
   in the hosted runtime when the change is installed.
4. Report the sign-in evidence with the change. Never report unrun sign-in
   checks as passing.

## Rollback

Roll back sign-in by installing an earlier Console version, never by bringing
back a Console-run sign-in. Going back to 1.33.0 restores Google sign-in and
the viewer password only on a deployment without `/console/sign-in` and only
while `/console/access-policy`, `/console/viewer-access` and
`console/google-oauth` still exist; with `/console/sign-in`, 1.33.0 signs in
through Access as 1.34.0 does, but reads any `console/` secret again. To stop
all browser sign-ins on a deployment, delete `/console/sign-in`. Existing
sessions end when their Access tokens can no longer be refreshed or their
records are deleted.
