# Integrating a product with Access

How a product (Persist, Connect, Console or any other) accepts Access tokens and
asks Access whether a caller may act on a resource. Access publishes no client
library. A product verifies tokens itself with a standard JWT library, and asks
permission questions over HTTP with `POST /decisions`. Where another skill says
"Access's shared verifier" it means the checks in step 2. "Access's shared decision
helper" means `POST /decisions` in step 4.

The code is Node 22 with [`jose`](https://github.com/panva/jose) 6. It was run end
to end against a deployed Access (token, verification, ownership, allowed and
denied decisions). Port it to another language by keeping every check, not by
dropping one.

## What the product needs

| Setting | Value | Where it comes from |
| --- | --- | --- |
| Shared domain | Such as `account.example.com` | The environment; Access is served on it under `/access` |
| Issuer | `https://<shared domain>/access` | `GET /access/capabilities` → `tokens.issuer` |
| Audience | `https://<shared domain>` | `GET /access/capabilities` → `tokens.audience` |
| Signing keys | `https://<shared domain>/access/keys` | `GET /access/capabilities` → `tokens.keys` |
| Service identity name | Such as `connect` | Created once by an operator (step 1) |
| Service identity secret | Opaque | Shown once when created; kept in the product's secret store |

Configure the issuer and audience; do not read them from a token. Read
`/capabilities` at deploy time to check the configured values, not on every
request. Never log a token, a secret, an `authorization` header or a request
body.

## 1. One-time setup, by an operator

Use Doublade ([configure-access-product](../../configure-access-product/SKILL.md)).
These calls use the environment key (`x-api-key`) or a person holding the named
permission.

Declare the product's resource types and actions. `PUT` replaces the whole
declaration; an identical one answers `200 unchanged`.

```bash
curl -sS -X PUT "https://$SHARED_DOMAIN/access/declarations/connect" \
  -H "x-api-key: $ACCESS_API_KEY" -H 'content-type: application/json' \
  -d '{
    "product": "connect",
    "resource_types": [
      {
        "name": "credential",
        "private": true,
        "actions": [
          { "name": "use", "shareable": true },
          { "name": "manage" },
          { "name": "remove" },
          { "name": "create", "type_level": true }
        ]
      }
    ]
  }'
```

- Names are lower-case words joined by `-`. Permissions read
  `<product>:<type>:<action>`, such as `connect:credential:use`.
- `type_level` actions, such as `create`, apply to the type. Roles grant them.
  Every other action applies to one resource.
- `shareable` actions can be shared on one resource. `manage` and `remove`
  never are. A `private` type shares `use` only.
- `private`: a person's resource of the type is usable only by them and those
  they share it with. Administrators and the environment get only its `read` and
  `remove`.

Create the product's service identity with only the Access permissions it
calls. The `201` holds the only copy of `client_secret`; the operator puts it
straight into the product's secret store.

```bash
curl -sS -X POST "https://$SHARED_DOMAIN/access/service-identities" \
  -H "x-api-key: $ACCESS_API_KEY" -H 'content-type: application/json' \
  -d '{
    "name": "connect",
    "grants": ["access:decision:read", "access:resource:manage", "access:resource:remove"]
  }'
```

- `access:decision:read` lets it ask decisions (step 4).
- `access:resource:manage` and `access:resource:remove` let it register and
  remove owners (step 5). Leave them out when no type has a shareable action.
- Names `access` and `access-*` are reserved.
- Rotate with `POST /access/service-identities/connect/secrets` and
  `{"overlap_seconds": 3600}`. The old secret keeps working for that long.

## 2. Verify a caller's token

Verification is offline: after the keys are cached, it makes no request to
Access.

```js
import { createRemoteJWKSet, jwtVerify } from 'jose';

const ACCESS = `https://${process.env.SHARED_DOMAIN}/access`;
const ISSUER = ACCESS;
const AUDIENCE = `https://${process.env.SHARED_DOMAIN}`;

const keys = createRemoteJWKSet(new URL(`${ACCESS}/keys`), {
  cacheMaxAge: 5 * 60_000, // re-read the published keys at most every 5 minutes
  cooldownDuration: 30_000, // an unknown key id re-reads them at most every 30 s
  timeoutDuration: 3_000,
});

/** The caller a valid Access token names; throws for any other token. */
export async function verifyAccessToken(token) {
  const { payload } = await jwtVerify(token, keys, {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat'],
    clockTolerance: 60,
  });
  if (payload.token_use !== 'access') throw new Error('not an access token');
  const roles = payload.roles;
  if (!Array.isArray(roles) || !roles.every((role) => typeof role === 'string')) {
    throw new Error('malformed roles');
  }
  const kind = payload.principal_kind ?? 'user';
  if (kind !== 'user' && kind !== 'service') throw new Error('unknown principal kind');
  return { kind, subject: payload.sub, roles };
}
```

- Keep every check. Never switch off the issuer or audience check, and never
  expect a per-application audience: every application's tokens carry the
  environment's single audience. `client_id` is informational only.
- `subject` is the Access `user_id` for a person, or the identity's name for a
  service. Never identify a person by email.
- Keep `cooldownDuration` at 30 s or less and `cacheMaxAge` at 5 minutes or
  less. Access activates a new signing key two minutes after publishing it,
  which relies on these limits.
- A person's token lasts at most 15 minutes. Disabling a user or changing their
  roles takes effect when their current token expires.

## 3. Get the product's own token

```js
let cached;

export async function serviceToken() {
  if (cached && cached.until > Date.now()) return cached.token;
  const response = await fetch(`${ACCESS}/service-token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.ACCESS_SERVICE_NAME,
      client_secret: process.env.ACCESS_SERVICE_SECRET, // from the secret store
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`service token refused: ${response.status}`);
  const { access_token: token, expires_in: expiresIn } = await response.json();
  cached = { token, until: Date.now() + (expiresIn - 60) * 1000 };
  return token;
}

const callAccess = async (method, path, body) =>
  fetch(`${ACCESS}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await serviceToken()}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5_000),
  });
```

Twenty failed requests for one identity from one address within about two
minutes answer `429`. Do not retry a `401` in a loop.

## 4. Ask whether a caller may act on a resource

```js
/** 'allow' or 'deny'; any failure is a deny. */
export async function decide(callerToken, action, resource) {
  try {
    const response = await callAccess('POST', '/decisions', {
      caller: { token: callerToken },
      action,
      resource,
    });
    if (!response.ok) return 'deny';
    const { decision } = await response.json();
    return decision === 'allow' ? 'allow' : 'deny';
  } catch {
    return 'deny';
  }
}

// One resource: the product supplies its owner from its own data.
await decide(token, 'use', {
  type: 'connect:credential',
  id: 'cred-123',
  owner: { kind: 'user', id: ownerUserId }, // or { kind: 'service', id }, or { kind: 'environment' }
});

// A type-level action: no id and no owner.
await decide(token, 'create', { type: 'connect:credential' });
```

- Pass the caller's own token. Access verifies it again and answers for that
  caller. An invalid caller token is a `400`, which the code treats as a deny.
- Ask one question about one resource. Never use it to filter a list.
- Deny on any error, timeout or non-`200` answer. Never fall back to allow.
- New grants and revocations take a few seconds to reach every decision.
- A request that came with only the environment key is the environment.
  Decide it in the product: the environment may do everything except use,
  share or change a person's resource of a private type. Record such requests
  as the environment, not as a person.
- A request with neither a token nor the key is `401`.

## 5. Register who owns a resource

Do this when the product creates a resource of a type with a shareable action,
and remove it with the resource. Access keeps only the owner, never the
product's data. The owner is fixed: the same owner again answers `200
unchanged`, another owner `409`.

```js
export async function registerOwner(product, type, id, owner) {
  const path = `/resources/${product}/${type}/${encodeURIComponent(id)}`;
  const response = await callAccess('PUT', path, { owner });
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`owner not registered: ${response.status}`);
  }
}

export async function removeResource(product, type, id) {
  const path = `/resources/${product}/${type}/${encodeURIComponent(id)}`;
  const response = await callAccess('DELETE', path);
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`resource not removed: ${response.status}`);
  }
}
```

## 6. Share on behalf of the owner

Only the owner shares a personal resource, so the product forwards the
signed-in owner's own token, not its service token. An administrator or the
environment key gets `403` on a personal resource. For an environment-owned
resource, a holder of `access:resource:share` shares.

```js
const response = await fetch(`${ACCESS}/resources/connect/credential/cred-123/grants`, {
  method: 'POST',
  headers: { authorization: `Bearer ${ownerToken}`, 'content-type': 'application/json' },
  body: JSON.stringify({ grantee: { kind: 'user', id: recipientUserId }, action: 'use' }),
});
```

`GET` on the same path lists the grants; `DELETE .../grants/{grant_id}`
revokes one. Every grant and revocation is audited by Access.

## Checks for the product's builder

Run these with a temporary declaration and service identity, then remove both:

| Do | Pass when |
| --- | --- |
| Get the service token and verify it | Accepted; kind `service`, subject the identity's name |
| Verify that token with one edited claim, and a malformed token | Both refused |
| Ask `use` on a resource the caller owns | `allow` (allow a few seconds after setup) |
| Ask `use` on a resource another person owns, with no grant | `deny` |
| Ask a type-level action the identity was granted | `allow` |
| Ask an undeclared action, and ask with an invalid caller token | `deny` both |
| Make `POST /decisions` unreachable or slow | `deny` |
