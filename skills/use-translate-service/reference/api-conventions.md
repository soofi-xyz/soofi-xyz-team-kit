# Translate API Conventions

Auth, response envelope, error tags, and the route map. Read this once before touching any other reference file.

## Authentication

All protected routes require:

```http
x-api-key: <service-api-key>
content-type: application/json
```

The only public route is `GET /translate/information`. Use it as a connectivity check.

Get the API URL and key from the operator of the Translate deployment. They are typically published in tenant SSM as `/translate/api-url` and `/translate/service-api-key-id`. Do not hard-code the key in source.

## Response envelope

Every response is one of:

```json
{ "ok": true,  "data": { ... } }
```

```json
{ "ok": false, "error": { "type": "<TagName>", "message": "...", "details": { ... } } }
```

Branch on `ok` first, then on `error.type`. Do not branch on HTTP status alone.

## Error type tags

The full set of `error.type` values Translate returns:

```
BadRequest
PayloadTooLarge
TranslateLanguageRegistrationInvalid
TranslateInputValidationError
TranslateOutputValidationError
TranslatePreviewNotAllowed
TranslateLanguageNotFound
TranslateMappingNotFound
TranslateExecutionNotFound
TranslateRegistrationNotFound
TranslateIdempotencyConflict
TranslateLanguageSchemaInvalid
TranslateMappingInvalid
TranslateMappingCoverageError
TranslateExecutionError
TranslateStoreError
TranslateWorkflowStartError
TranslateArtifactStoreError
TranslateCallbackError
TranslateRegistrationWorkflowStartError
InternalServerError
NotFound
```

## Route map

Replace `BASE_URL` with the Translate API URL you were given (e.g. `https://acme.tenant.example/translate`).

| Verb   | Path                                              | Auth | Sync? | Purpose | Reference |
| ------ | ------------------------------------------------- | ---- | ----- | ------- | --------- |
| `GET`  | `/information`                                    | no   | sync  | Static service metadata | — |
| `PUT`  | `/languages/{language_name}/register`             | yes  | async | Register/update a JSON language | [`register-language.md`](./register-language.md) |
| `GET`  | `/registrations/{job_id}`                         | yes  | sync  | Read language registration status | [`register-language.md`](./register-language.md) |
| `GET`  | `/languages`                                      | yes  | sync  | List registered languages (filter by `company_name`, `product_name`, `status`) | [`register-language.md`](./register-language.md) |
| `GET`  | `/languages/{language_name}`                      | yes  | sync  | Read one registered language | [`register-language.md`](./register-language.md) |
| `PUT`  | `/mappings/{mapping_name}/register`               | yes  | async | Register/update a runtime mapping | [`register-mapping.md`](./register-mapping.md) |
| `GET`  | `/mappings`                                       | yes  | sync  | List runtime mappings (filter by `from_language`, `to_language`, `status`) | [`register-mapping.md`](./register-mapping.md) |
| `GET`  | `/mappings/{mapping_name}`                        | yes  | sync  | Read one runtime mapping | [`register-mapping.md`](./register-mapping.md) |
| `POST` | `/validate`                                       | yes  | sync  | Validate input against a mapping's source language | [`translate.md`](./translate.md) |
| `POST` | `/preview`                                        | yes  | sync  | Translate a small payload inline | [`translate.md`](./translate.md) |
| `POST` | `/executions`                                     | yes  | async | Start an asynchronous translation execution | [`translate.md`](./translate.md) |
| `GET`  | `/executions/{execution_id}`                      | yes  | sync  | Read execution status, timings, warnings | [`translate.md`](./translate.md) |
| `GET`  | `/executions/{execution_id}/artifacts`            | yes  | sync  | Presigned URLs for input/output/warnings/coverage/debug | [`translate.md`](./translate.md) |
| `GET`  | `/executions/{execution_id}/logs`                 | yes  | sync  | Normalised execution log summary | [`translate.md`](./translate.md) |
