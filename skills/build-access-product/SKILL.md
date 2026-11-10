---
name: build-access-product
description: "Build or maintain Access: Google sign-in for a company's users, registered applications, users, roles, service identities, permission rules and the grants other products enforce to tell users apart. Use Aegislash for implementation and Doublade for existing-service configuration."
disable-model-invocation: true
---

# Build Access

Use `aegislash`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Access capability map](../guide-product-work/reference/iterations/access.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `doublade` with [configure-access-product](../configure-access-product/SKILL.md)
for sign-in, user, role and grant setup on an existing deployment.

This skill is a build specification. It does not prove that any route, claim or
integration is deployed. Discover the target repository, revision and deployment
before changing anything.

## Scope

Access answers two questions for every product in an environment: **who is
calling** and **what may they do**.

- One environment is one company. Separate companies use separate environments.
  Do not model tenants, organizations or workspaces, and do not put a tenant
  identifier in a token, route or record.
- Access owns sign-in, applications, users, roles, service identities, the
  token, the permission rules and the grant API.
- Each product enforces access on its own routes and data. Its builder
  implements that: Conkeldurr in Persist, Lapras in Connect, Chandelure in
  Console. Supply the contract and helpers and review their use; do not edit
  another product's repository to make an Access feature pass.
- Account owns the company's Prism identity, keys and AWS account. Do not
  duplicate account keys or account provisioning.

## Three stores, one job each

| Store | Holds | Never holds |
| --- | --- | --- |
| The login directory | Who a person is: Google identity, sessions, the stable user identifier | Permission rules, product data |
| The permission store | What a caller may do: roles and grants on named resources | Credentials, product data |
| Persist | The user as a graph record, and the edges that connect a user to the records they may read | Passwords, tokens, secrets, permission rules |

Decisions read the permission store and the graph edges. A role name copied onto
a user record in Persist is for reporting only and never decides access.

## Start from the earlier service's lessons

Read [what the earlier sign-in service did and why not to port it](reference/prior-implementation.md)
before designing a feature. Reuse its flows as a starting contract. Write new
code: the earlier service does not meet the engineering guidelines and has the
security defects listed there.

## Contracts

### Sign-in and address

- Sign in with Google only. Do not build email-and-password sign-in or another
  provider unless the user asks for it.
- Restrict sign-in to the company's Google domains using the provider's
  hosted-domain claim, never the email suffix alone.
- Serve every Access route under `https://<shared domain>/access`: sign-in
  start, callback, sign-out, published keys and the API. Follow
  [the shared API domain contract](../guide-product-work/reference/shared-api-domain.md).
  Do not create a second domain or certificate for sign-in. If a chosen
  component needs its own address for the provider redirect, stop, record it as
  a gap and ask before adding one.
- Use the authorization-code flow with PKCE. Deliver tokens to the application
  through its registered back channel or secure cookies. Never put an access,
  identity or refresh token in a URL.
- Match redirect and sign-out addresses exactly against the registered
  application. Reject before issuing a code.
- Identify a person by a stable, opaque user identifier. Never use an email
  address as a key, a foreign key or a grant principal.
- A first sign-in from an allowed domain creates the user with no role, so they
  can do nothing until an administrator assigns one. An invitation only
  pre-assigns a role.

### Token

Keep access tokens short-lived and verifiable offline. Require these claims and
document the exact names in the target repository's API description:

| Claim | Meaning |
| --- | --- |
| Subject | Stable user identifier, or the service identity name for a non-human caller |
| Issuer | This environment's Access issuer |
| Audience or client | The application or product the token was issued for |
| Expiry and issue time | Short access-token lifetime; refresh is a separate token |
| Token type | Distinguishes access tokens from identity tokens |
| Roles | Role names assigned to the subject at issue time |

Publish the signing keys. Ship one shared verifier that checks signature, issuer,
audience, expiry and token type and returns the caller (`subject`, `roles`,
`kind: user | service`). Verifying a token makes no request to Access.

State the revocation trade-off plainly: a disabled user or changed role takes
effect when the current access token expires. Keep access tokens to at most 15
minutes unless the user sets another value, and revoke refresh tokens immediately.

### Permissions

Use Amazon Verified Permissions as the permission store, one policy store per
environment, owned by Access.

- Every rule has three parts: who (a user, role or service), which action, on
  which resource. Roles are groups of users.
- Each product declares its resource types and actions (for example a Connect
  credential with `use` and `manage`). Access keeps that list as the store's
  schema and rejects an undeclared type or action.
- Express the rules as:

  | Rule | Expression |
  | --- | --- |
  | A role may perform an action on a resource type | One policy per role |
  | An owner may use their own resource | One fixed policy comparing the resource's owner to the caller |
  | One resource is shared with one user or role | One policy per share, created from a template |

- Only Access writes rules. Products and people create, list and revoke grants
  through the Access API, which audits every change. Nobody writes policy text
  by hand.
- Ship one shared decision helper. A product passes the verified caller, the
  action, and the resource with its owner; the helper asks the store and returns
  allow or deny. Deny on any error.
- The store keeps rules, not data. The product supplies the resource's owner and
  attributes with each question.
- A product may declare a resource type **private to its owner**. For that
  type, a resource owned by a person is usable only by that person and by those
  the owner shares it with. Administrators and the environment key get its
  metadata and removal, never use, sharing or a change of its value. A resource
  of that type owned by the environment is usable by the environment key and
  administrators, and shared only by an administrator. Connect credentials are
  declared this way. Do not let the administrator role's rules reach a personal
  resource of a private type.
- Who may share: the owner for a personal resource, an administrator for an
  environment-owned one. Sharing grants `use` only and never moves ownership.
- Ship an administrator role and refuse to remove or demote the last administrator.
- Do not use the store to filter lists. It answers one question about one
  resource. Record access in Persist is decided by graph edges, below.

### Users and record access in Persist

- Publish every user to Persist as a graph record after the user is created or
  changed. Publish asynchronously with retry and safe replay. Sign-in never
  waits on Persist and never fails because Persist is unavailable.
- Send only the identifier and profile fields the lexicon declares. Never send
  a password, token, code or secret.
- Access to graph records is a connection: a user reads what is reachable from
  their own record along edge types the lexicon marks as carrying access. The
  same rule covers Persist's search results.
  Connect users to a few anchor records (directly or through a group), not to
  every record.
- Access owns granting it. Deliver grant, list and revoke that write and remove
  those edges through Persist's API using Access's own service identity, with an
  audit record for each. Persist enforces; Access keeps no copy of the data.
- The user record type and the access-carrying edge types are Model decisions.
  Until Model publishes them, build against a fixture lexicon and report the gap.

### Coexistence with the environment key

Products are called today with one shared environment key and no user. Keep that
working and make its meaning explicit:

- A request with a user or service token is that caller.
- A request with only the environment key is the **environment**: an
  administrator-level, non-human caller. Record it as such in audit output. Like
  an administrator, it cannot use a person's resource of a private type.
- The environment key never goes to a browser, a mobile app or an end user.
  User-facing applications use tokens only.
- Replace environment-key product-to-product calls with service identities one
  product at a time. Do not remove the key in an Access change.

## Security floor

These are not optional and are not deferred to a later piece:

- Verify every token's signature. Never read claims from an unverified token.
- Fail closed: an unreachable dependency, an unexpected status or a parse error
  is a rejection, never an acceptance.
- No test, tool or user-agent bypass in deployed code. Use fixtures and a test
  deployment instead.
- Every route except sign-in start, sign-in callback and published keys requires
  a verified caller with a named permission.
- Never log a request body, code, token, secret or cookie. Log the correlation
  identifier, subject and outcome.
- Write an audit record for sign-in and for every user, role, grant,
  record-access and service-identity change: who, what, when, outcome.
- Rate-limit sign-in and invitation routes.

## Delivery

Deliver Access as an authenticated HTTP API with validated requests, stable
identifiers, idempotent writes, correlated errors and capability discovery.
Follow [the stable stack identity contract](../build-product-deployer/reference/stack-identity.md);
use no deployment stages.

Make applications installable from a configuration bundle. Deliver the
application API to [the Access application payload contract](../build-product-deployer/reference/configuration-bundles.md#access-application-payloads):
create-or-replace by name, idempotent on identical content, read-back and
removal, with no secret in the document. Tinkaton adds the `access`
`application` kind to Build and Corviknight adds the Access adapter to Deploy;
do not build an installer in Access. Roles, users and grants stay API-only.

Build one capability from the map at a time. For each: explain it with one
example, then implement it together with its checks from
[the verification reference](reference/verification.md), using
[the test data](reference/test-data.md).

A piece is done only by that reference's definition: every listed check is an
automated test named by its check ID, the piece's verification command passes at
the fake level and against the deployed test environment, earlier pieces still
pass, the leak scan is clean and the run cleaned up. Report `verified`,
`verified-with-gaps` or `not-verified` with the evidence table.

By the user's explicit instruction, Aegislash verifies each piece itself and
starts the next one without waiting for a person to run it. This replaces the
shared workflow's stop-and-wait checkpoint for Access build work only. Stop and
ask in the cases the reference lists. Automated sign-in uses the fake identity
provider; one human check, `SI-H1`, uses real Google.

Keep real provider credentials, real invitations and real email behind explicit
authorization for the exact target. Use a sandbox Google project and test
accounts. Never invite or email a real person to pass a check.

## Return

Return the Access changes, the exact routes and token claims delivered, the
declared resource types and actions, test and fake results, user observations,
AWS evidence, cleanup and remaining gaps. Name which products have adopted
Access and which still accept only the environment key. Hand configuration-only
work to `doublade` and enforcement inside another product to that product's
builder.
