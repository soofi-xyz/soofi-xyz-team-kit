# Operating Translate As A Caller

Idempotency, callbacks, and the end-of-integration verification checklist.

## Idempotency

- Send the same `idempotency_key` on retried `POST /executions` calls to dedupe. Translate returns the original execution on subsequent calls.
- A different request body with the same key returns `ok: false` with `error.type: "TranslateIdempotencyConflict"`. Pick a new key, or send the exact original body.
- The same idempotency rule applies in spirit to language and mapping registrations: a re-`PUT` with the same `(name, version, body)` is safe and produces a new job that ends in `COMPLETED` without changing the underlying record.

## Callbacks

- Set `callback_url` (`https://`, reachable from the Translate egress path) to be notified once when the execution reaches a terminal state.
- Acknowledge the callback with a `2xx` response body. Translate may retry on non-`2xx`; build the handler to be idempotent.
- Translate also accepts polling via `GET /executions/{execution_id}`. Use callbacks for production fan-out and polling for ad-hoc inspection — pick one, not both, per environment.
- A failed callback surfaces as `error.type: "TranslateCallbackError"` in the execution status. Fix the callback endpoint and resume by polling.

## Production hygiene

- Pin `mapping_version` in production calls so a later mapping update does not silently change output shape. Let it default only in development.
- Pin `from_language.version` and `to_language.version` inside the mapping registration for the same reason.
- Set `validate_input: true` and `validate_output: true` (defaults) in production. Disable only when you have proven upstream validation and accept the risk.
- Surface `error.type` and warning `type` values to your metrics/log pipeline. Alert on `TranslateMappingCoverageError`, `TranslateInputValidationError`, `TranslateIdempotencyConflict`, and any `TranslateCallbackError`.

## Verification checklist

Before declaring an integration complete, verify:

- [ ] `GET /information` returns `ok: true` from your caller environment.
- [ ] The source and target languages each have a `COMPLETED` registration record and appear in `GET /languages`.
- [ ] The mapping appears in `GET /mappings` with the expected `from_language`, `to_language`, and `ENABLED` status.
- [ ] `POST /validate` accepts a representative input.
- [ ] `POST /preview` returns the expected output for a small payload.
- [ ] `POST /executions` (with `idempotency_key`) returns `202` with an `execution_id`; the execution reaches a terminal status; `GET /executions/{id}/artifacts` returns presigned URLs; the `callback_url` (if configured) fires once.
- [ ] Errors and warnings are surfaced by `type` tag in caller logs/metrics, not just by HTTP status.
