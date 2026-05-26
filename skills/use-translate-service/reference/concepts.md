# Translate Concepts

The four nouns every Translate user needs to understand before calling the API.

## Language

A **language** is a named, versioned JSON contract that describes the shape of a payload.

- You name it whatever you want (e.g. `acme-loan-v1`) and pick a version (e.g. `1.0.0`).
- You supply a JSON Schema in `data` (or a public `https://` URL in `data_url`) plus ownership metadata (`company_name`, `product_name`).
- You may attach an `example` payload that conforms to the schema.
- Every language is `format: "json"` and `type: "class"` today. Other formats and types are not accepted.

A language is the **identity of a data shape**. Translate uses it on two sides:

- The **source language** of a mapping says "inputs to this mapping must conform to this schema".
- The **target language** of a mapping says "outputs of this mapping will conform to this schema".

Languages must be registered **before** any mapping that references them.

## Runtime mapping

A **runtime mapping** is a named, versioned conversion from one registered language to another.

It does not contain code. It is a list of deterministic **operations** that copy values from paths in the input to paths in the output, with optional defaults when a source path is missing.

Every mapping declares:

- `from_language` — the source language by `name` and optional `version`.
- `to_language` — the target language by `name` and optional `version`.
- `owners` — at least one email or team identifier responsible for the mapping.
- `operations` — at least one operation (see below).
- `status` — `ENABLED` (default) or `DISABLED`.

A mapping is the **rule book** Translate follows for one direction of conversion. To go A → B and B → A you need two separate mappings.

## Operation

An **operation** is a single path-to-path copy inside a mapping.

```json
{ "source_path": "borrower.first_name", "target_path": "borrower.given_name" }
```

- `source_path` (required) — dot path read from the input payload.
- `target_path` (required) — dot path written into the output payload.
- `default_value` (optional) — JSON value written when `source_path` is missing from the input. Without a default, a missing required source path becomes a validation error or coverage warning.

Operations are evaluated deterministically in the order they appear.

## Execution

An **execution** is one run of a mapping against one input payload.

- Executions are **asynchronous**. You start one with `POST /translate/executions` and Translate replies with an `execution_id`. You poll status (or receive a callback) and fetch the translated output and metadata artifacts when the execution reaches a terminal state.
- A **preview** is the synchronous equivalent for small payloads. You get the translated output inline on the same call. Use preview during development; use executions for production.

## Lifecycle order

```diagram
╭───────────╮   ╭───────────╮   ╭──────────╮   ╭───────────────╮   ╭───────────╮
│ Register  │──▶│ Register  │──▶│ Register │──▶│ Validate /    │──▶│ Execute   │
│ source    │   │ target    │   │ mapping  │   │ Preview       │   │ (async)   │
│ language  │   │ language  │   │          │   │               │   │           │
╰───────────╯   ╰───────────╯   ╰──────────╯   ╰───────────────╯   ╰───────────╯
```
