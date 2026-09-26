# Registering A Language

How to register a JSON language contract, poll its registration job, and read or list registered languages.

For what a language **is**, read [`concepts.md`](./concepts.md) first.

## `PUT /languages/{language_name}/register`

### Request shape

Required fields:

| Field          | Type              | Notes |
| -------------- | ----------------- | ----- |
| `format`       | `"json"`          | Only `"json"` is accepted today. |
| `type`         | `"class"`         | Only `"class"` is accepted today. |
| `company_name` | string, non-empty | Owner company. |
| `product_name` | string, non-empty | Owner product. |

Exactly **one** of:

| Field      | Type             | Notes |
| ---------- | ---------------- | ----- |
| `data`     | JSON object      | Inline JSON Schema describing the payload. |
| `data_url` | `https://` URL   | Public URL hosting the JSON Schema. |

Optional fields:

| Field          | Type                                  | Notes |
| -------------- | ------------------------------------- | ----- |
| `version`      | string, non-empty                     | If omitted the service assigns one. Use semver for clarity. |
| `example`      | JSON value or array of JSON values    | One or more example payloads that conform to `data`. |
| `callback_url` | `https://` URL                        | Called when the registration job finishes. |

### Example request body

```json
{
  "format": "json",
  "type": "class",
  "company_name": "acme",
  "product_name": "loan",
  "version": "1.0.0",
  "data": {
    "type": "object",
    "required": ["loan_id", "amount_cents"],
    "properties": {
      "loan_id":      { "type": "string" },
      "amount_cents": { "type": "integer", "minimum": 0 },
      "borrower": {
        "type": "object",
        "properties": {
          "first_name": { "type": "string" },
          "last_name":  { "type": "string" }
        }
      }
    }
  },
  "example": {
    "loan_id": "L-001",
    "amount_cents": 125000,
    "borrower": { "first_name": "Ada", "last_name": "Lovelace" }
  }
}
```

### Response shape

`202 Accepted`:

```json
{
  "ok": true,
  "data": {
    "job_id": "lreg_01HW...",
    "status": "STARTED",
    "language_name": "acme-loan-v1",
    "version": "1.0.0",
    "_links": { "status": "/translate/registrations/lreg_01HW..." }
  }
}
```

## Polling — `GET /registrations/{job_id}`

Poll until `status` is `COMPLETED` (success) or `FAILED` (with `failure_reason`).

Status values: `STARTED`, `RUNNING`, `COMPLETED`, `FAILED`.

```json
{
  "ok": true,
  "data": {
    "job_id": "lreg_01HW...",
    "status": "COMPLETED",
    "language_name": "acme-loan-v1",
    "version": "1.0.0",
    "created_at": "2025-05-22T10:00:00Z",
    "finished_at": "2025-05-22T10:00:03Z",
    "schema_digest": "sha256:..."
  }
}
```

## Reading languages

### `GET /languages`

Returns a paginated list. Optional query parameters:

| Query             | Type                          | Notes |
| ----------------- | ----------------------------- | ----- |
| `company_name`    | string                        | Filter by owner company. |
| `product_name`    | string                        | Filter by owner product. |
| `status`          | `"ENABLED"` / `"DISABLED"`    | Filter by enabled state. |
| `format`          | `"json"`                      | Reserved; only `json` today. |
| `next_token`      | string                        | Pagination cursor returned by the previous call. |

Response `data`:

```json
{
  "languages": [
    {
      "languageName":  "acme-loan-v1",
      "version":       "1.0.0",
      "status":        "ENABLED",
      "companyName":   "acme",
      "productName":   "loan",
      "format":        "json",
      "type":          "class",
      "schemaDigest":  "sha256:...",
      "schemaS3Uri":   "s3://...",
      "exampleS3Uri":  "s3://...",
      "createdAt":     "2025-05-22T10:00:00Z",
      "updatedAt":     "2025-05-22T10:00:03Z"
    }
  ],
  "next_token": "..."
}
```

### `GET /languages/{language_name}`

Returns the single language record under `data.language` using the same shape.

## Common failure modes

| `error.type`                              | What it means | Fix |
| ----------------------------------------- | ------------- | --- |
| `BadRequest`                              | Missing/extra fields, or both `data` and `data_url` supplied. | Send exactly one of `data`/`data_url` and fill all required fields. |
| `TranslateLanguageRegistrationInvalid`    | Registration request rejected before the job started. | Read `error.details`. |
| `TranslateLanguageSchemaInvalid`          | The supplied JSON Schema does not validate. | Fix the schema and retry. |
| `TranslateRegistrationWorkflowStartError` | Translate could not start the registration job. | Retry; escalate to the operator if it persists. |
| `TranslateRegistrationNotFound`           | Polled a `job_id` that does not exist or has expired. | Re-register and use the new `job_id`. |
