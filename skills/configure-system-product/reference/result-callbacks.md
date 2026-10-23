# System result callbacks

System can POST a finished request's result to a client-supplied URL instead of
making the client poll. Zygarde owns the framework (validation, dispatcher,
retries, alarms). Celebi enables it per client and tests it. Implemented in
[prismteam-ai/system#32](https://github.com/prismteam-ai/system/pull/32); the
per-client auth header, the one-URL rule and the install parameter below are in
[prismteam-ai/system#40](https://github.com/prismteam-ai/system/pull/40).

Production status: System-prod has had `ExternalFacadeCallbacks` `true` since
the 2026-10-23 13:14 UTC install of #40 and
[#41](https://github.com/prismteam-ai/system/pull/41). The install turns on no
client: each one needs `PUT /callback-clients/{tenantId}`. #41, in the same
install, lets the service-key admin role tag the API keys it mints; before it,
`POST /service-keys` and rotate failed with 502 `KEY_UPSTREAM_FAILED`.
The client-facing guide is the OpenDoor portal's Result callbacks section,
from [elephant-xyz/opendoor-documentation](https://github.com/elephant-xyz/opendoor-documentation);
never put operator settings, secret names or IAM routes there.

Scope: the sale-availability client facade only (`POST /sale-availability/requests`).
The generic `POST /flows/{name}/invocations` route, Connect/Transform callbacks
and progress updates are out of scope.

## How it works

1. The client sends `POST /sale-availability/requests` with an optional
   `callbackUrl`. The facade removes it from the flow input, so cache and
   idempotency behavior do not change.
2. The facade validates the URL and stores it on the invocation record:
   HTTPS, port 443, no credentials, no IP literal or `localhost`, no fragment,
   and it must start with one of the client's allowlisted prefixes.
3. A request's callback URL is set once. A repeat with the same
   `Idempotency-Key` and the same `callbackUrl` (or one for a request that had
   none) is idempotent and, if the request already finished, resends it; one
   with another `callbackUrl` gets `409 IDEMPOTENCY_CONFLICT` and changes
   nothing. A repeat without `callbackUrl` changes nothing.
4. When the Step Functions run finishes, an EventBridge rule queues
   `{invocationId}`. The callback dispatcher reloads the record and client
   settings, builds exactly the `GET /sale-availability/requests/{requestId}`
   body and POSTs it. Succeeded, failed and cached requests each send one.
5. The callback carries the client's callback key in the header the client
   chose. System never reads the service key for it.
   The host must resolve only to public addresses. Redirects are not followed.
6. Polling does not change. `GET /sale-availability/requests/{requestId}`
   stays the source of truth: invocation records are kept 30 days, with or
   without a `callbackUrl`.

```text
client ─POST /sale-availability/requests {callbackUrl}─▶ facade ─▶ Step Functions
                                                                    │ finished
receiver ◀─POST callbackUrl── dispatcher ◀─ queue ◀─ EventBridge ◀──┘
              (retries ─▶ CallbackDlq)
```

## Request sent to the receiver

```
POST <callbackUrl>
content-type: application/json
<auth.header>:        <the client's callback key>   e.g. x-api-key or Authorization
X-System-Timestamp:   <unix seconds>
X-System-Delivery-Id: <requestId>:<status>   same on every retry and resend
X-System-Attempt:     1, 2, ...
X-System-Signature:   sha256=<hex>             only when the client has signing
body: exactly the GET /sale-availability/requests/{requestId} body
```

The schema is in the System repository's
`requirements/sale-availability.swagger.yml` (OpenAPI 3.1), as the
`resultReady` entry under `callbacks` on `POST /sale-availability/requests`,
keyed `{$request.body#/callbackUrl}`. Use it instead of copying the body shape.

## Authentication: which key is which

Use these three names with clients and in evidence, never "the key":

| Direction | Credential | Header | System keeps |
| --- | --- | --- | --- |
| Client calls the facade (`POST`/`GET /sale-availability/requests…`) | **Service key** (the client's Prism client key), from `POST /service-keys` | `x-api-key` | only an HMAC-SHA256 fingerprint |
| System calls the client's `callbackUrl` | **Callback key**, a value the client gives us at onboarding | `auth.header`, chosen by the client | the exact header value in `auth.secretId` |
| Optional signing | **Signing secret**, a third value | `X-System-Signature` (HMAC; the secret is not sent) | `signing.secretId` |

- System never reads the service key, the environment's shared API key or any
  other System credential for a callback: it sends only the callback key, as
  stored, plus the `X-System-*` headers. If a client chose the same value for
  both keys, that value is what is sent.
- Nothing prevents a client from choosing a callback key equal to its service
  key; System keeps only the service key's fingerprint and never compares them.
  Recommend a separate value: a leak of one does not expose the other, they
  rotate independently, and the service key, which can call the API, then
  never sits in webhook logs.
- Rotation: the client sends the new callback key, you update the secret, and
  the next delivery sends it. No redeploy. The client's endpoint should accept
  both keys until the new one arrives. The service key rotates separately
  (`POST /service-keys/{id}/rotate`).
- The client-facing wording of this section is the OpenDoor portal's
  "Authentication: which key is which" under Result callbacks.

The client's endpoint authenticates System by comparing one header with its
stored copy of the callback key. System stores its copy per tenant and sends it
on every callback:

- `auth.header` names the header, e.g. `x-api-key` or `Authorization`. System
  stores it lowercase. `x-system-*`, `content-type`, `content-length`, `host`,
  `connection`, `transfer-encoding` and `user-agent` are refused.
- `auth.secretId` is the Secrets Manager name or ARN of the secret holding the
  exact header value (for `Authorization`, the full `Bearer <key>`). It must be
  under `system/<stage>/callback-clients/<tenantId>/`.
- Optional `signing.secretId`, under the same prefix, adds
  `X-System-Signature: sha256=<hex>`: the HMAC-SHA256, keyed with that secret,
  of `<X-System-Timestamp>.<X-System-Delivery-Id>.<raw body>`.

The dispatcher reads the secret on every delivery, so a rotation applies at
once, and never logs it. Its IAM policy allows only
`system/<stage>/callback-clients/*`, so it cannot read or send the environment's
shared API key or the client's System service key. While the secret is missing,
empty or not a valid header value, nothing is sent and the delivery is retried
(`CLIENT_SECRET_MISSING`, `CLIENT_SECRET_INVALID`; `SIGNING_SECRET_*` for the
signing secret). Settings saved without `auth` send nothing
(`AUTH_NOT_CONFIGURED`), and the facade answers `CALLBACKS_NOT_ENABLED`.

The settings API stores only secret names. Provision values out of band, for
example:

```bash
aws secretsmanager create-secret \
  --name system/<stage>/callback-clients/<tenantId>/auth-header \
  --secret-string file://client-callback-key.txt
```

Never paste a key into tickets, logs or evidence.

## Enable for a client

Collect from the client first, through the secure channel used for its
service key:

- the HTTPS URL prefix its `callbackUrl` values will start with (an origin on
  port 443 plus a path ending in `/`);
- the header name its endpoint checks, e.g. `x-api-key` or `Authorization`;
- the callback key: the exact header value (the key, or `Bearer <key>`),
  stored as `system/<stage>/callback-clients/<tenantId>/auth-header`.
  Recommend a value different from its service key;
- whether it wants signed callbacks; if so, a signing secret, separate from
  both keys, stored under the same prefix and shared with the client the same
  way.

The `tenantId` is the tenant of the client's System service key.

1. Install with the Marketplace parameter `ExternalFacadeCallbacks` `true`
   (`externalFacade.callbacks: true` for a direct deployment). It is `false`
   by default; with it off, no callback resources exist. Turning it on enables
   no client.
2. Set the client with IAM-signed (SigV4) calls only:

   ```http
   PUT /callback-clients/{tenantId}
   {
     "enabled": true,
     "allowedUrlPrefixes": ["https://receiver.example/system/"],
     "auth": {
       "header": "x-api-key",
       "secretId": "system/<stage>/callback-clients/<tenantId>/auth-header"
     }
   }
   ```

   A prefix is an HTTPS origin plus a path ending in `/`. `auth` is required;
   add `"signing": { "secretId": "..." }` to sign. A secret outside the
   client's prefix gets `400 CALLBACK_SETTINGS_INVALID`.
3. Read back with `GET /callback-clients/{tenantId}`.
4. Disable with `PUT` and `"enabled": false`.

Errors on `POST /sale-availability/requests`:

| Code | Meaning |
| --- | --- |
| `400 CALLBACK_URL_INVALID` | `reason` is one of `TOO_LONG`, `NOT_A_URL`, `NOT_HTTPS`, `HAS_CREDENTIALS`, `PORT_NOT_ALLOWED`, `HOST_NOT_ALLOWED`, `HAS_FRAGMENT`, `NOT_ALLOWLISTED` |
| `400 CALLBACKS_NOT_ENABLED` | the client has no enabled callback settings |

## Delivery and retries

- Each attempt times out after 10 s.
- 2xx: delivered (`CallbackDelivered`).
- 408, 429, 5xx, timeouts and a missing or invalid client secret: retried with jittered
  backoff starting at 30 s and doubling, at most 15 min apart, up to 8 attempts
  (`CallbackRetried`), then moved to `CallbackDlq` (alarmed).
- Any other answer (other 4xx, and 3xx since redirects are not followed): not
  retried (`CallbackRejected` metric and alarm).
- Delivery is at least once. Receivers drop duplicates by `X-System-Delivery-Id`.
- If EventBridge cannot put a finished run on the callback queue, the raw event
  goes to `CallbackRuleDlq` (alarmed).
- `CallbackQueueAgeAlarm` fires when a callback has waited over 3600 s. One
  callback's retries can take about 45 min, so older means the dispatcher is stuck.

Metrics are in namespace `System/ExternalFacade`: `CallbackDelivered`,
`CallbackSkipped`, `CallbackRejected`, `CallbackRetried`.

## Receiver checklist

1. Compare the configured header with your stored callback key (not your
   service key) using a constant-time compare. Answer 401 on a missing or different key; System does not retry it.
2. With signing on, recompute `X-System-Signature` over the raw body and
   compare it in constant time.
3. Reject a stale `X-System-Timestamp`, for example more than 300 s from now
   in either direction.
4. Store `X-System-Delivery-Id`; ignore one already processed.
5. Return 2xx quickly and process asynchronously. Slow replies become retries.
6. Answer at the callback URL itself. System does not follow redirects.
7. To rotate the callback key, accept both old and new briefly, have System's
   secret updated, then retire the old key. A key System does not hold yet gets 401 and is not retried.

## Local test (no AWS)

Run this before any deployed test. In a System checkout of `main`:

```bash
npm ci
npm run callbacks:local-demo           # or: just callback-local-demo
```

It runs the real delivery code against a mock receiver on `127.0.0.1` and prints
PASS or FAIL for: correct key, wrong key (401, not retried), missing key, no key
provisioned (nothing sent, DLQ), 500 then 200, duplicate delivery id, URL
outside the prefix, production URL rules refusing the local receiver, key
rotation, HMAC signing, and no secret in logs or other headers. Local mode needs
`SYSTEM_CALLBACK_LOCAL_DEV=1`, which the scripts set; no stack sets it and no
deployed handler reads it. A passing local run is not a delivered callback.

## Test sequence

Run mock-first in a non-production review account. Enable callbacks in
production only with explicit approval. Use a capture receiver under an
allowlisted prefix that records headers (with the auth header redacted to
match/mismatch), body and arrival time.

| # | Case | Setup | Expected |
| --- | --- | --- | --- |
| 1 | No callback (regression) | request without `callbackUrl` | same response, cache and idempotency as before; nothing queued |
| 2 | Success | allowlisted URL, request succeeds | one delivery, attempt 1, body equals GET body, status succeeded |
| 3 | Failure | request whose flow fails | one delivery with the failed GET body |
| 4 | Cache hit | repeat a cached lookup with a `callbackUrl` | one delivery for the cached result |
| 5 | Rejected URL | non-allowlisted, HTTP, IP literal, port, fragment | `400 CALLBACK_URL_INVALID` with the matching `reason`; nothing queued |
| 6 | Retry then success | receiver returns 503, then 200 | attempts 1..n with one delivery id; `CallbackRetried` then `CallbackDelivered` |
| 7 | Retries exhausted | receiver always returns 503 | 8 attempts, message in `CallbackDlq`, alarm fires |
| 8 | Client disabled | `enabled: false`, then send with `callbackUrl` | `400 CALLBACKS_NOT_ENABLED` |
| 9 | Wrong key | receiver stores another key | one attempt, 401, `CallbackRejected`, no retry |
| 10 | Key rotation | change the receiver's key, then the secret | 401 before, delivered after, no redeploy |

Also send one case where the receiver returns 400 and expect no retry and
`CallbackRejected`.

## What to inspect after each case

Find these through the System stack outputs `CallbackQueueUrl`,
`CallbackDlqUrl`, `CallbackRuleDlqUrl`, `CallbackDispatcherLogGroup`,
`CallbackDlqAlarmName`, `CallbackRuleDlqAlarmName` and `CallbackQueueAgeAlarmName`.

- Step Functions: the sale-availability lookup execution ARN and final status.
- Callback queue, `CallbackDlq` and `CallbackRuleDlq`: message count and the
  `invocationId`. `CallbackRuleDlq` should stay empty.
- The three callback alarms: only `CallbackDlqAlarm` should fire, and only in case 7.
- Dispatcher log group: entries for the request id with attempt number, status
  code and outcome; confirm neither the client key nor any System key appears.
- Metrics in `System/ExternalFacade` for the case.
- Receiver capture: ordered attempts with delivery id, timestamp and attempt
  header, and the body diffed against `GET /sale-availability/requests/{requestId}`.

Record per case: request id, execution ARN, ordered attempts, expected body,
actual body and the verdict. Keep deployed evidence separate from local or
mocked tests; a passing unit test is not a delivered callback.
