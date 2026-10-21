# System result callbacks

System can POST a finished request's result to a client-supplied URL instead of
making the client poll. Zygarde owns the framework (validation, dispatcher,
retries, alarms). Celebi enables it per client and tests it. Implemented in
[prismteam-ai/system#32](https://github.com/prismteam-ai/system/pull/32).

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
3. A repeat with the same `Idempotency-Key` and a `callbackUrl` points the
   request at that URL; if the request already finished, System resends.
4. When the Step Functions run finishes, an EventBridge rule queues
   `{invocationId}`. The callback dispatcher reloads the record and client
   settings, builds exactly the `GET /sale-availability/requests/{requestId}`
   body and POSTs it. Succeeded, failed and cached requests each send one.
5. The host must resolve only to public addresses. Redirects are not followed.

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
x-api-key:            <environment API key>
X-System-Timestamp:   <unix seconds>
X-System-Delivery-Id: <requestId>:<status>   same on every retry and resend
X-System-Attempt:     1, 2, ...
body: exactly the GET /sale-availability/requests/{requestId} body
```

The schema is in the System repository's `requirements/swagger.yml`
(OpenAPI 3.1), as a `callbacks` entry on `POST /sale-availability/requests`
keyed `{$request.body#/callbackUrl}`. Use it instead of copying the body shape.

## Authentication and exposure risk

The callback carries the environment API key of the environment where System is
deployed. The dispatcher reads it on every delivery from Secrets Manager
`system/<resourceIdentity or stage>/shared-api-key` (env
`SHARED_API_KEY_SECRET_NAME`) and never logs it. System PR #30 or an operator
provisions the secret. There is no signing secret.

This key has the same value as the customer's Account key and opens every
product on the shared domain and Marketplace. System sends it only to
allowlisted HTTPS origins and refuses redirects, but every allowlisted receiver,
including an external client, gets the key. Allowlist only receivers you trust
with that key. Never paste the key into tickets, logs or evidence.

## Enable for a client

1. Install with `externalFacade.callbacks: true`. It is off by default; with it
   off, no callback resources exist.
2. Set the client with IAM-signed (SigV4) calls only:

   ```http
   PUT /callback-clients/{tenantId}
   { "enabled": true, "allowedUrlPrefixes": ["https://receiver.example/system/"] }
   ```

   A prefix is an HTTPS origin plus a path ending in `/`.
3. Read back with `GET /callback-clients/{tenantId}`.
4. Disable with `PUT` and `"enabled": false`.

Errors on `POST /sale-availability/requests`:

| Code | Meaning |
| --- | --- |
| `400 CALLBACK_URL_INVALID` | `reason` is one of `TOO_LONG`, `NOT_A_URL`, `NOT_HTTPS`, `HAS_CREDENTIALS`, `PORT_NOT_ALLOWED`, `HOST_NOT_ALLOWED`, `HAS_FRAGMENT`, `NOT_ALLOWLISTED` |
| `400 CALLBACKS_NOT_ENABLED` | the client has no enabled callback settings |

## Delivery and retries

- 2xx: delivered (`CallbackDelivered`).
- 408, 429, 5xx, timeouts and a missing environment key: retried with jittered
  backoff starting at 30 s and doubling, at most 15 min apart, up to 8 attempts
  (`CallbackRetried`), then moved to `CallbackDlq` (alarmed).
- Other 4xx: not retried (`CallbackRejected` metric and alarm).
- Delivery is at least once. Receivers drop duplicates by `X-System-Delivery-Id`.

Metrics are in namespace `System/ExternalFacade`: `CallbackDelivered`,
`CallbackSkipped`, `CallbackRejected`, `CallbackRetried`.

## Receiver checklist

1. Compare `x-api-key` with the environment key using a constant-time compare.
   Reject on mismatch.
2. Reject a stale `X-System-Timestamp`, for example more than 300 s from now
   in either direction.
3. Store `X-System-Delivery-Id`; ignore one already processed.
4. Return 2xx quickly and process asynchronously. Slow replies become retries.
5. Answer at the callback URL itself. System does not follow redirects.

## Test sequence

Run mock-first in a non-production review account. Enable callbacks in
production only with explicit approval. Use a capture receiver under an
allowlisted prefix that records headers (with `x-api-key` redacted to
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

Also send one case where the receiver returns 400 and expect no retry and
`CallbackRejected`.

## What to inspect after each case

Find these through the System stack outputs `CallbackQueueUrl`,
`CallbackDlqUrl` and `CallbackDispatcherLogGroup`.

- Step Functions: the sale-availability lookup execution ARN and final status.
- Callback queue and `CallbackDlq`: message count and the `invocationId`.
- Dispatcher log group: entries for the request id with attempt number, status
  code and outcome; confirm the key never appears.
- Metrics in `System/ExternalFacade` for the case.
- Receiver capture: ordered attempts with delivery id, timestamp and attempt
  header, and the body diffed against `GET /sale-availability/requests/{requestId}`.

Record per case: request id, execution ARN, ordered attempts, expected body,
actual body and the verdict. Keep deployed evidence separate from local or
mocked tests; a passing unit test is not a delivered callback.
