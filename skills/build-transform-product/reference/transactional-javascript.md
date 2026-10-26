# Transactional JavaScript mappings

Implement `transactional-javascript` as a distinct Transform capability for
**one small transaction per run** (one event, document or record set) where the
batch path's startup time dominates. Run a registered JavaScript mapping in a
fresh in-process sandbox, synchronously, and return a GraphSON v3 document for
Persist. Keep the Spark SQL path, its mappings and its v2 contracts unchanged;
batch and transactional mappings may use different languages.

Use this as an implementation requirement, not evidence of a deployed API.
Kecleon builds the capability; Silvally authors and tests the mappings once the
deployed capability is verified.

## Selection

- Select the engine through the registered mapping (`engine: "javascript"`) and
  the transaction route below. Never gate availability on a CDK context, build
  flag or other deploy-time switch; deploy the route inactive-safe and activate
  it through runtime configuration.
- Resolve exactly one enabled mapping per `from`/`to` pair **and engine**. A pair
  may have one enabled `spark-sql` mapping for batch runs and one enabled
  `javascript` mapping for transactions. Reject missing or ambiguous pairs.
- Never translate SQL into JavaScript or into another SQL dialect, and do not add
  publication checks that can reject existing `spark-sql` mappings.

## Mapping artifact

A version is `mapping.json` plus one self-contained script, registered through
the existing configuration API as one immutable version:

```json
{
  "id": "<from>-to-<to>",
  "version": "1.0.0",
  "status": "ENABLED",
  "engine": "javascript",
  "from": "<from>",
  "to": "<to>",
  "inputs": [
    { "table": "document", "format": "json" },
    { "table": "document_text", "format": "text" },
    { "table": "directory_users", "format": "jsonl", "optional": true }
  ],
  "output": { "shape": "graph", "format": "graphson" },
  "module": { "path": "mapping.js", "sha256": "<sha256 of mapping.js bytes>" }
}
```

| Input `format` | Value passed to the mapping |
| --- | --- |
| `json` | the parsed JSON value |
| `jsonl` | an array of parsed objects, one per non-empty line |
| `text` | the UTF-8 string, unmodified |

- `mapping.js` is one script that defines a global `mapping` object with a
  synchronous `transform(inputs)` function, as produced by
  `esbuild src/mapping.ts --bundle --format=iife --global-name=mapping`.
  It has no imports and no `require`.
- `transform` returns `{ vertices, edges }`:
  - vertex: `{ id, label, properties }`
  - edge: `{ id, label, from, to, properties? }`, where `from`/`to` are vertex `id`s
  - `id`, `from` and `to` are non-empty strings produced by the mapping;
    property values are JSON strings, numbers, booleans or arrays.
- Extend the configuration API body to `{ rule, module: { "mapping.js": "<source>" } }`
  for `engine: "javascript"`. Validate: the rule fields above, `module.path`
  equals `mapping.js`, the declared `sha256` matches the bytes, the script is at
  most 1 MiB and compiles in the sandbox **without executing `transform`**.
  Keep `{ rule, queries }` validation for `spark-sql` byte-for-byte unchanged.
  Preserve immutable versions, identical-content replay, `409` conflicts and
  digest read-back.

## Transaction route

Add a versioned synchronous route next to the existing run routes:

| Route | Body | Result |
| --- | --- | --- |
| `POST /transform/transactions` | `{ contractVersion: 3, from, to, inputs: { <table>: { value } \| { s3Uri } }, transaction_id? }` | `200 { transaction_id, mapping: { id, version, sha256 }, graph, counts: { vertices, edges }, durationMs }` |

- `value` carries a `json`/`text` input inline (a `jsonl` input inline is an
  array). `s3Uri` reads one object inside the approved input scope; use it for
  large reference tables and cache it by ETag. Reject unknown tables, missing
  required tables and bodies above the synchronous payload limit.
- `transaction_id` follows the run route's idempotency: the same id and body
  returns the stored result, a different body returns `409`.
- Errors use the existing envelope. Report `MappingNotFound`,
  `AmbiguousMapping`, `InvalidInput`, `MappingTimeout`, `MappingMemoryExceeded`,
  `MappingFailed` (the script threw; include its message, never its inputs) and
  `InvalidMappingOutput`.
- Do not run cost admission or approval: the payload, memory and time limits
  bound each transaction.

## Runtime

Run the route in a Node.js Lambda (arm64). Per transaction:

1. Resolve the pair's enabled `javascript` mapping; cache by catalog digest.
2. Fetch `mapping.js` by its registered object version, verify the sha256 and
   cache it by digest. A digest mismatch fails the transaction.
3. Load inputs (inline or S3) and parse them by declared format.
4. Create a **fresh** `quickjs-emscripten` runtime and context, set the memory
   limit (default 64 MiB) and an interrupt-handler deadline (default 2 s), evaluate
   `mapping.js`, pass the inputs as one JSON string, call `mapping.transform`,
   and return its result as a JSON string. Dispose the runtime afterwards.
5. Check only the output shape needed to serialize: arrays, non-empty string
   ids, unique vertex ids, edge endpoints present among the vertices. Do not
   re-validate against Lexicon; Persist validates every GraphSON ingest.
6. Serialize GraphSON v3 (below) and return it.

Read limits from runtime configuration (SSM/AppConfig), not deployment
constants. Log transaction id, mapping id/version/digest, per-step durations and
element counts; never log input values or mapping output.

### Isolation

The sandbox boundary is what keeps the mapping away from AWS, S3, the Lambda
filesystem and environment credentials:

- Expose **no host functions or objects** to the sandbox. Pass data in and out
  only as JSON strings. A single host helper (for example an S3 read) removes
  the isolation.
- Keep the Lambda role scoped to the catalog, mapping objects and approved input
  prefixes; the handler, not the mapping, performs every AWS call.
- Treat the mapping output as untrusted data.

Use `isolated-vm` instead only after a measured CPU-bound mapping needs V8 JIT,
and record why. Do not use full Node sandboxes for this pure-function contract.

## GraphSON serialization

Wrap the mapping's own ids; Persist accepts any string in `g:UUID`, rehashes
vertices and edges from their content and returns the final ids:

```json
{
  "@type": "tinker:graph",
  "@value": {
    "vertices": [{
      "@type": "g:Vertex",
      "@value": {
        "id": { "@type": "g:UUID", "@value": "<mapping vertex id>" },
        "label": "<label>",
        "properties": {
          "<name>": [{ "@type": "g:VertexProperty", "@value": {
            "id": { "@type": "g:UUID", "@value": "<mapping vertex id>#<name>" },
            "label": "<name>", "value": "<plain JSON value>" } }]
        }
      }
    }],
    "edges": [{
      "@type": "g:Edge",
      "@value": {
        "id": { "@type": "g:UUID", "@value": "<mapping edge id>" },
        "label": "<label>",
        "outV": { "@type": "g:UUID", "@value": "<from vertex id>" }, "outVLabel": "<from label>",
        "inV": { "@type": "g:UUID", "@value": "<to vertex id>" }, "inVLabel": "<to label>",
        "properties": { "<key>": { "@type": "g:Property", "@value": { "key": "<key>", "value": "<plain JSON value>" } } }
      }
    }]
  }
}
```

- Pass property values through as plain JSON; Persist checks them against the
  Lexicon types. Omit absent properties instead of emitting `null`.
- Never apply Neptune CSV escaping (`\;`, `\\`) or write server-managed
  properties (`id`, `created_at`, derived index keys).
- Return the document. Delivery to Persist (`POST /persist/ingest`,
  `/persist/ingest-async` or a `GraphFactProduced` event) is the caller's step;
  add Persist write permissions to Transform only when requested. Persist's
  synchronous path accepts at most `SYNC_INGEST_MAX_ELEMENTS` (default 50)
  elements; report when typical transactions exceed it.

## Acceptance

- Sandbox probes from inside a mapping: `process`, `require`, `fetch`,
  `WebAssembly` and `import('fs')` are unavailable; a host environment secret is
  unreachable; an infinite loop ends as `MappingTimeout`; unbounded allocation
  ends as `MappingMemoryExceeded`.
- Registration: valid script, digest mismatch, oversize script, syntax error,
  missing `mapping.transform`, identical replay and changed-content `409`;
  existing `spark-sql` registrations validate unchanged.
- Transactions: resolution per engine, unknown/disabled/ambiguous pair, missing
  required and unknown inputs, S3 input outside scope, idempotent
  `transaction_id`, script throw, invalid output shape, dangling edge.
- Parity: where a `spark-sql` mapping exists for the same pair, the JavaScript
  mapping produces the same ids, labels, endpoints and property values on the
  shared fixtures, except Neptune CSV escaping.
- Live: `POST /persist/validate` accepts the returned document; measure cold
  start and warm p50/p99 on the deployed Lambda. Report local measurements,
  synthesis and deployed behavior as separate evidence levels.
