# Access capability map

Use Aegislash for the service and Doublade for sign-in, users, roles and grants on
an existing deployment. Apply the [shared workflow](../../SKILL.md) to the
requested capabilities. These areas are a starting inventory, not a fixed
iteration count. Select scope, order dependencies and split independently useful
features. Keep tests and user feedback inside every piece.

Each piece is done only by [the Access definition of done](../../../build-access-product/reference/verification.md):
its listed checks pass as automated tests at the fake and deployed levels, with
[the Access test data](../../../build-access-product/reference/test-data.md), a
clean leak scan and cleanup. The last column below summarises the outcome; the
verification reference holds the exact checks and pass conditions. Those checks
are the evidence brought to the shared workflow's person-run checkpoint; they do
not replace it.

One environment serves one company. Access separates **users inside that
environment**; it has no tenant, organization or workspace concept. Separate
companies use separate environments. Do not add a tenant identifier to tokens,
APIs or stored records.

## Product boundaries

| Product | Owns |
| --- | --- |
| **Access** | Google sign-in, registered applications, users, roles, service identities, the token every product verifies, the environment's permission rules, and the API that grants a user access to a resource or a graph record. |
| **Persist** | The user as a graph record, and enforcement of record access: a signed-in user reads only what is connected to them, through GraphQL. |
| **Connect** | Enforcement on credentials and flows: who may use a credential decides who may start a flow that uses it. Connect never returns a secret value. |
| **Console** | Signing people in through Access as a registered application. It does not run its own sign-in. |
| **Account** | The company's Prism identity, account and service keys, and the backing AWS account. |
| **Environment** | The shared domain and certificate. Access is served on that same domain under `access`. |

## Feature inventory

The rows are in build order. A piece uses only what it and the pieces above it
deliver. Until `permissions` is done there are no roles: administrative calls
use the environment key and every signed-in person is refused on protected routes.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `applications` — register where sign-in may start and return | Shared domain; the environment key | Deliver create-or-replace by name, read, list and remove for an application: a named set of exact redirect and sign-out addresses on the environment's one sign-in client, idempotent on identical content. Configure two applications, an `http` address and a wildcard. | Read back both applications. An invalid document is rejected with no write. A lookup by name is one keyed read. |
| `sign-in` — sign in once with Google for every product | `applications`; Google client credentials from the operator | Deliver Google sign-in only: provider configuration with allowed company domains, sign-in start, callback, refresh, sign-out and revocation, all under `https://<shared domain>/access`, with one session shared by every application. Sign in as two people, then try a personal Google account, another company's domain, a replayed code and an unregistered address; start sign-in from a second application while signed in. | A first sign-in creates one user; a repeat reuses it. The second application signs the person in without a new prompt, and one sign-out ends both. No token, code or secret appears in a URL, a log line or a response to another origin. No second domain or certificate was created. |
| `token-contract` — let a product check a caller itself | `sign-in` | Deliver signed short-lived tokens carrying the stable user identifier, the environment's single audience, the application as an informational client, and roles; the published signing keys; and a shared verifier that checks signature, issuer, audience, expiry and token type. Verify a good token, an expired one, one from another environment and one with a tampered role. | Only the good token passes, whichever application issued it. Verifying a token makes no request to Access. A signing-key rotation is picked up without redeploying a product. |
| `users` — invite, list, read, disable and remove people | `sign-in`, `token-contract` | Deliver invitations bound to an email, plus list, read, disable and remove for the environment key. Exercise an uninvited company user, a signed-in person calling an administrative route, and a disabled user. | Read back the user and the audit record of who changed it. A signed-in person gets a rejection with no write but can read their own profile. A disabled user cannot refresh or sign in again. |
| `permissions` — decide what each role may do | `users` | Deliver one permission store per environment, the first administrator set by the environment key, each product's declared resource types, actions and shareable actions, role definitions, role assignment and invitations that carry a role. Configure a baseline role, a narrower one, an undeclared action, removal of the last administrator and a resource type private to its owner. | The same question gets the same answer from every product through the shared decision helper. An undeclared action is rejected with no write. The last administrator cannot be removed or demoted. An administrator cannot use a person's private resource. |
| `service-identities` — let one product call another | `token-contract`, `permissions` | Deliver named non-human callers with their own permissions, secret rotation and revocation, and Access's own identity for calling Persist. Exercise overlap during rotation, a revoked caller and a service asking for an action it was not given. | The token names the service, not a person. Plaintext secrets are shown once and never stored in logs or evidence. A revoked caller is refused. |
| `user-records` — publish each user to Persist | `users`, `service-identities`; a user record type in the lexicon | Deliver asynchronous publication of every created, changed, disabled and removed user to Persist through its ingest API with Access's own identity, with retry and replay. Exercise Persist being unavailable during sign-in and a repeated event. | Sign-in succeeds while Persist is down and the record appears after recovery. A replay writes nothing new. Tokens and secrets never reach Persist. |
| `resource-sharing` — give a person or role a specific resource | `permissions` | Deliver grant, list and revoke for one named resource (for example a Connect credential) to a user or role, limited to the actions its type declares shareable. Only the owner shares a personal resource and only an administrator an environment-owned one. Exercise the owner, a user with a grant, a role grant, a user with neither, a revoked grant, a non-shareable action and an administrator on a private personal resource. | The cases give the answers listed in the verification reference through the product's own API. Each grant and revoke has an audit record. No product writes permission rules directly. |
| `record-access` — connect a person to graph records | `user-records`; access-carrying edge types and anchor record types in the lexicon | Deliver grant, list and revoke that connect a user (or a group of users) to an anchor record in Persist through Persist's API with Access's own identity. Exercise a connected user, an unconnected one, and a revoked connection. | Persist's GraphQL, including its search, returns the connected records to the first user and nothing to the second. Access holds no copy of the data. Each grant and revoke has an audit record. |
| `application-bundles` — install applications from a configuration bundle | `applications`; Build's `access` `application` kind and Deploy's Access adapter | Verify the application API meets [the Access application payload contract](../../../build-product-deployer/reference/configuration-bundles.md#access-application-payloads) so Tinkaton and Corviknight can add the kind and adapter. Install a bundle with two applications, change one, replay it, then remove one. | Read each application back through the Access API and compare it with the bundle. A replay writes nothing. No client secret or token appears in the bundle, the run result or the logs. |
| `product-integration` — a product accepts Access sign-in | `token-contract`; `permissions`; `record-access` for Persist | The product's own builder adds the integration: Console signs people in through Access, Persist scopes GraphQL to the caller, Connect checks flow start and credential use. Aegislash supplies the verifier and decision helper and reviews their use. | One sign-in works in every integrated product. Two test users get different, correct results in each. A call with no token and no environment key is refused. Environment-key callers keep working and are recorded as the environment, not a person. |

Use [the Access build contract](../../../build-access-product/SKILL.md) and
[the lessons from the earlier sign-in service](../../../build-access-product/reference/prior-implementation.md).
The map specifies required outcomes, not deployed endpoints. Discover exact
routes, claims and statuses in the target revision. Exercise each feature through
the Access HTTP API. Route missing API behavior to Aegislash and missing
enforcement inside another product to that product's builder.

Install Access before any product is switched to require tokens. Applications
can be installed from a configuration bundle once Build and Deploy support the
`access` `application` kind; roles, users and grants are set through the Access
API only. The lexicon's user record type, its access-carrying edge types and
its anchor record types are Model decisions that are still open: build and test
against a fixture lexicon and report the gap, without inventing labels in a
deployed lexicon. A specification, local fixture or synthesis does not prove a
deployed sign-in or an enforced grant.
