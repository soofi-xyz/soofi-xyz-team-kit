# Registering A Runtime Mapping

How to register a runtime mapping definition, poll its registration job, and read or list mappings.

For what a mapping and an operation **are**, read [`concepts.md`](./concepts.md) first.

## `PUT /mappings/{mapping_name}/register`

Both `from_language.name` and `to_language.name` MUST already be registered (see [`register-language.md`](./register-language.md)).

### Request shape

Required fields:

| Field           | Type                              | Notes |
| --------------- | --------------------------------- | ----- |
| `from_language` | `{ name, version? }`              | Source language. |
| `to_language`   | `{ name, version? }`              | Target language. |
| `owners`        | array of non-empty strings, ≥1    | Owners for the mapping. |
| `operations`    | array of operation objects, ≥1    | At least one operation. |

Optional fields:

| Field      | Type                          | Notes |
| ---------- | ----------------------------- | ----- |
| `version`  | string, non-empty             | If omitted the service assigns one. |
| `status`   | `"ENABLED"` or `"DISABLED"`   | Defaults to `"ENABLED"`. |

### Operation shape

Each entry in `operations`:

| Field           | Type            | Required | Notes |
| --------------- | --------------- | -------- | ----- |
| `source_path`   | dot path string | yes      | Path read from the input payload. |
| `target_path`   | dot path string | yes      | Path written into the output payload. |
| `default_value` | any JSON value  | no       | Written at `target_path` if `source_path` is missing from the input. |

Examples:

```json
{ "source_path": "loan_id",              "target_path": "id" }
{ "source_path": "amount_cents",         "target_path": "amount.cents" }
{ "source_path": "borrower.middle_name", "target_path": "borrower.middle_name", "default_value": null }
```

### Example request body

```json
{
  "version": "1.0.0",
  "owners": ["data-platform@acme.com"],
  "from_language": { "name": "acme-loan-v1",     "version": "1.0.0" },
  "to_language":   { "name": "internal-loan-v2", "version": "2.0.0" },
  "operations": [
    { "source_path": "loan_id",              "target_path": "id" },
    { "source_path": "amount_cents",         "target_path": "amount.cents" },
    { "source_path": "borrower.first_name",  "target_path": "borrower.given_name" },
    { "source_path": "borrower.last_name",   "target_path": "borrower.family_name" },
    { "source_path": "borrower.middle_name", "target_path": "borrower.middle_name", "default_value": null }
  ],
  "status": "ENABLED"
}
```

### Response shape

`202 Accepted` with a job envelope identical in shape to language registration (see [`register-language.md`](./register-language.md#response-shape)). Poll the same `GET /registrations/{job_id}` endpoint until `status` is `COMPLETED` or `FAILED`.

## Reading mappings

### `GET /mappings`

Returns a paginated list. Optional query parameters:

| Query           | Type                          | Notes |
| --------------- | ----------------------------- | ----- |
| `status`        | `"ENABLED"` / `"DISABLED"`    | Filter by enabled state. |
| `from_language` | string                        | Filter by source language name. |
| `to_language`   | string                        | Filter by target language name. |
| `next_token`    | string                        | Pagination cursor. |

Each entry in `data.mappings`:

```json
{
  "mappingName":         "acme-to-internal",
  "version":             "1.0.0",
  "status":              "ENABLED",
  "owners":              ["data-platform@acme.com"],
  "fromLanguageName":    "acme-loan-v1",
  "fromLanguageVersion": "1.0.0",
  "toLanguageName":      "internal-loan-v2",
  "toLanguageVersion":   "2.0.0",
  "mappingDigest":       "sha256:...",
  "operationCount":      5,
  "registrationMode":    "API",
  "createdAt":           "2025-05-22T10:00:00Z",
  "updatedAt":           "2025-05-22T10:00:03Z"
}
```

### `GET /mappings/{mapping_name}`

Returns the single mapping record under `data.mapping`.

## Common failure modes

| `error.type`                  | What it means | Fix |
| ----------------------------- | ------------- | --- |
| `BadRequest`                  | `operations` empty, `owners` empty, or required field missing. | Send a valid body — at least one operation and one owner. |
| `TranslateLanguageNotFound`   | `from_language` or `to_language` is not registered. | Register the language first, then retry the mapping. |
| `TranslateMappingInvalid`     | Mapping rejected during validation (e.g. duplicate `target_path`). | Read `error.details` for the offending operation. |
| `TranslateMappingCoverageError` | Mapping does not cover required source paths in the source language. | Add operations for the missing required paths or add `default_value`s. |
| `TranslateMappingNotFound`    | `GET /mappings/{mapping_name}` for a name that does not exist. | Register the mapping, or check the name. |
