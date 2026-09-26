# Translating A Payload

How to validate input, preview a small translation synchronously, and run an asynchronous execution end-to-end.

For what an execution **is**, read [`concepts.md`](./concepts.md) first.

## Shared request shape

`POST /validate`, `POST /preview`, and `POST /executions` share the same base request shape:

| Field              | Type                            | Notes |
| ------------------ | ------------------------------- | ----- |
| `mapping_name`     | string, non-empty               | Required. |
| `mapping_version`  | string, non-empty               | Optional. Pin in production; omit during development. |
| `input`            | JSON value                      | Inline payload to translate. |
| `input_url`        | `https://` URL                  | Alternative to `input` (executions/validate only). |
| `idempotency_key`  | string, non-empty               | Use on retries to dedupe. |
| `callback_url`     | `https://` URL                  | Called when the execution finishes (executions only). |
| `validate_input`   | boolean (default `true`)        | Validate the input against the source language. |
| `validate_output`  | boolean (default `true`)        | Validate the output against the target language. |
| `request_metadata` | object of string → string       | Free-form labels echoed back in status and artifacts. |

Rules:

- For `POST /validate` and `POST /executions`, send **exactly one** of `input` or `input_url`. Both, or neither, is a `BadRequest`.
- For `POST /preview`, `input` is required and `input_url` / `callback_url` are not allowed.
- `input_url` and `callback_url` must use `https://`.
- Leave `validate_input` / `validate_output` at `true` unless you have already validated upstream and accept the risk.

## `POST /validate`

Use to fail fast before paying for a full execution.

Request body:

```json
{
  "mapping_name": "acme-to-internal",
  "input": {
    "loan_id": "L-001",
    "amount_cents": 125000,
    "borrower": { "first_name": "Ada", "last_name": "Lovelace" }
  }
}
```

Response (`200`): `{ ok: true, data: <ValidationResult> }`. On schema failure the envelope flips to `ok: false` with `error.type: "TranslateInputValidationError"` and `error.details` containing the schema violations.

## `POST /preview`

Synchronous translation for **small** payloads.

Request body (same as validate but `input` is required and `input_url` / `callback_url` are not):

```json
{
  "mapping_name": "acme-to-internal",
  "input": { "loan_id": "L-001", "amount_cents": 125000,
             "borrower": { "first_name": "Ada", "last_name": "Lovelace" } }
}
```

Response (`200`):

```json
{
  "ok": true,
  "data": {
    "output":   { "id": "L-001", "amount": { "cents": 125000 },
                  "borrower": { "given_name": "Ada", "family_name": "Lovelace", "middle_name": null } },
    "warnings": [],
    "coverage": { "mapped_ratio": 1.0, "required_source_paths": ["..."],
                  "mapped_source_paths": ["..."], "unmapped_required_paths": [],
                  "ignored_source_paths": [] }
  }
}
```

If the payload is too large the envelope returns `ok: false` with `error.type: "PayloadTooLarge"` or `"TranslatePreviewNotAllowed"`. Switch to `POST /executions`.

## `POST /executions`

Production path. Asynchronous.

Request body:

```json
{
  "mapping_name": "acme-to-internal",
  "mapping_version": "1.0.0",
  "input_url": "https://example.com/inputs/batch-2025-05-22.json",
  "idempotency_key": "acme-batch-2025-05-22",
  "callback_url": "https://my-service.example.com/translate-callback",
  "validate_input": true,
  "validate_output": true,
  "request_metadata": { "source_batch": "2025-05-22" }
}
```

Response (`202`):

```json
{ "ok": true, "data": { "execution_id": "exec_01HW...", "status": "PENDING" } }
```

## `GET /executions/{execution_id}`

The response includes the current execution status, timings, accumulated warnings, and pointers to artifacts. Poll until the status is terminal.

### Warning shape

A warning is a non-fatal observation:

```json
{
  "type": "MissingOptionalSourcePath",
  "path": "borrower.middle_name",
  "message": "Optional source path missing; default applied.",
  "details": { "default_value": null }
}
```

Warning `type` values: `MissingOptionalSourcePath`, `ConditionalSkipped`, `DefaultApplied`, `CoverageBelowThreshold`.

## `GET /executions/{execution_id}/artifacts`

Returns presigned `https://` URLs for the artifacts produced by the execution:

- `input` — the input payload Translate actually consumed.
- `output` — the translated payload.
- `warnings` — the full list of warning records.
- `coverage` — coverage metrics for the run.
- `debug` — internal debug data (when available).

Download artifacts within the presigned URL's TTL; do not store the URL itself for replay.

### Coverage shape

```json
{
  "mapped_ratio": 0.92,
  "required_source_paths":   ["loan_id", "amount_cents", "borrower.first_name", "borrower.last_name"],
  "mapped_source_paths":     ["loan_id", "amount_cents", "borrower.first_name", "borrower.last_name"],
  "unmapped_required_paths": [],
  "ignored_source_paths":    ["internal_only_flag"]
}
```

Treat any non-empty `unmapped_required_paths` or a `mapped_ratio` below your threshold as a release blocker — Translate will surface this as `error.type: "TranslateMappingCoverageError"` when the coverage rule is enforced.

## `GET /executions/{execution_id}/logs`

Returns a normalised summary of the execution timeline (Step Functions states and Lambda invocations). Use this for debugging only; do not parse it as a stable contract.

## Common failure modes

| `error.type`                       | What it means | Fix |
| ---------------------------------- | ------------- | --- |
| `BadRequest`                       | Both `input` and `input_url`, neither of them, or a non-HTTPS URL. | Send exactly one valid value. |
| `PayloadTooLarge`                  | Preview body exceeds the inline limit. | Use `POST /executions` with `input_url`. |
| `TranslatePreviewNotAllowed`       | Preview disabled or limit exceeded for this mapping/payload. | Use `POST /executions`. |
| `TranslateMappingNotFound`         | `mapping_name` (or pinned `mapping_version`) does not exist or is `DISABLED`. | Re-register or enable the mapping. |
| `TranslateInputValidationError`    | Input does not conform to the source language schema. | Fix the input. See [`input-payload.md`](./input-payload.md). |
| `TranslateOutputValidationError`   | Translated output does not conform to the target language schema. | Fix the mapping operations or the target language schema. |
| `TranslateIdempotencyConflict`     | Same `idempotency_key` reused with a different body. | Use a new key or send the original body. |
| `TranslateExecutionError`          | Mapping ran but failed mid-execution. | Inspect `warnings` and `debug` artifacts. |
| `TranslateMappingCoverageError`    | Required source paths were not mapped. | Add operations or `default_value`s. |
| `TranslateExecutionNotFound`       | Polled an `execution_id` that does not exist or has expired. | Confirm the ID; re-execute if necessary. |
| `TranslateCallbackError`           | Translate could not deliver the callback. | Verify the callback URL and TLS; consider polling. |
