# Preparing An Input Payload

Rules an input payload must follow so a mapping translates it cleanly.

## Rules

1. The input MUST conform to the JSON Schema of the mapping's `from_language`. Translate validates this when `validate_input` is `true` (the default). Schema violations return `error.type: "TranslateInputValidationError"`.
2. Every `source_path` listed in the mapping's `operations` SHOULD be present in the input. Paths that are missing **and** have no `default_value` produce warnings (`MissingOptionalSourcePath`, `DefaultApplied`) or a `TranslateMappingCoverageError`, depending on configuration.
3. Field types in the input MUST match the schema. For example, if `amount_cents` is declared `integer minimum: 0`, sending `"125000"` (string) or `-1` will be rejected.
4. Nested paths use dot notation in the mapping (`borrower.first_name`) and standard nested JSON objects in the payload (`{ "borrower": { "first_name": "Ada" } }`).
5. Extra fields in the input that no operation references are **allowed**. They are ignored and listed under `coverage.ignored_source_paths`.

## Inline vs remote input

- Use inline `input` for small payloads (preview, validate, small executions).
- Use `input_url` (`https://`) for any payload large enough to bump against API Gateway request limits or for inputs that already live in object storage. Translate fetches the URL once at execution start.

## Example aligned with the mapping

Given the source language schema:

```json
{
  "type": "object",
  "required": ["loan_id", "amount_cents"],
  "properties": {
    "loan_id":      { "type": "string" },
    "amount_cents": { "type": "integer", "minimum": 0 },
    "borrower": {
      "type": "object",
      "properties": {
        "first_name": { "type": "string" },
        "last_name":  { "type": "string" },
        "middle_name": { "type": "string" }
      }
    }
  }
}
```

And the mapping operations:

```json
[
  { "source_path": "loan_id",              "target_path": "id" },
  { "source_path": "amount_cents",         "target_path": "amount.cents" },
  { "source_path": "borrower.first_name",  "target_path": "borrower.given_name" },
  { "source_path": "borrower.last_name",   "target_path": "borrower.family_name" },
  { "source_path": "borrower.middle_name", "target_path": "borrower.middle_name", "default_value": null }
]
```

A valid input:

```json
{
  "loan_id": "L-001",
  "amount_cents": 125000,
  "borrower": { "first_name": "Ada", "last_name": "Lovelace" }
}
```

Produces:

```json
{
  "id": "L-001",
  "amount": { "cents": 125000 },
  "borrower": {
    "given_name": "Ada",
    "family_name": "Lovelace",
    "middle_name": null
  }
}
```

`borrower.middle_name` was missing in the input, but the operation supplied `default_value: null`, so the run succeeds with a `MissingOptionalSourcePath` warning instead of an error.

## Quick self-check before sending

- [ ] Every field required by the source language schema is present and the right type.
- [ ] Every `source_path` your mapping needs is present, **or** that operation has a `default_value`.
- [ ] Strings, numbers, and booleans match the schema (no stringly-typed numbers, no `null` for required fields).
- [ ] Nested objects nest correctly — no dot-keys like `{ "borrower.first_name": "Ada" }`.
- [ ] If the payload is large, host it at a public `https://` URL and use `input_url`.
