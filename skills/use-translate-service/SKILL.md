---
name: use-translate-service
description: "User guide for calling a deployed Translate service — what a language and a runtime mapping are, the exact JSON shapes required to register them, the input shape Translate expects, and the request/response shape for validate, preview, and asynchronous executions. Use when explaining or making calls to /translate/* as a consumer. Not for changing the Translate codebase — use build-translate-service for that."
---

# Use Translate Service

User-facing skill for **calling a deployed Translate service**. It covers concepts and the exact JSON shapes a caller must send and read.

Use when the task is one of:

- Explaining what a Translate **language** or **runtime mapping** is.
- Showing the JSON shape required to register a language or a mapping.
- Showing the shape Translate expects for an input payload and produces as output.
- Showing the request/response shape for `/translate/validate`, `/translate/preview`, or `/translate/executions`, plus status polling and artifact fetching.
- Diagnosing an `error.type` from a `/translate/*` response.

Do **not** use this skill when the task is to change the Translate service itself. Use [`build-translate-service`](../build-translate-service/) for that.

## Always read first

Before answering, read [`reference/concepts.md`](./reference/concepts.md) and [`reference/api-conventions.md`](./reference/api-conventions.md). Concepts gives you the four nouns (language, mapping, operation, execution). Conventions gives you auth, the response envelope, the error-tag set, and the route map.

## Read on demand

Pick the reference file that matches the user's task. Do not read everything up front.

| If the user is asking about…                                                | Read |
| --------------------------------------------------------------------------- | ---- |
| What a language / mapping / operation / execution is                        | [`reference/concepts.md`](./reference/concepts.md) |
| Auth, response envelope, error tags, route map                              | [`reference/api-conventions.md`](./reference/api-conventions.md) |
| Registering a language, polling, or listing/reading languages               | [`reference/register-language.md`](./reference/register-language.md) |
| Registering a runtime mapping or the operation shape                        | [`reference/register-mapping.md`](./reference/register-mapping.md) |
| Validate, preview, executions, status polling, artifacts, warnings          | [`reference/translate.md`](./reference/translate.md) |
| Preparing or debugging an input payload                                     | [`reference/input-payload.md`](./reference/input-payload.md) |
| Idempotency, callbacks, production hygiene, verification checklist          | [`reference/operating.md`](./reference/operating.md) |

## Expected output

Return:

- A plain-language explanation of the concept the user asked about.
- The exact JSON shape (request body and/or response envelope) copied from the matching reference file, with required vs optional fields called out.
- The route, HTTP verb, and required headers.
- The next call(s) the user should make in sequence (e.g. poll registration job, then validate, then execute).
- If the user described a payload, name any fields that would violate the source language schema or any required source paths the mapping references that are missing.
