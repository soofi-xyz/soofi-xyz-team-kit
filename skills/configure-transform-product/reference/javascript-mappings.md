# Author transactional JavaScript mappings

Use a `javascript` mapping when one run covers one small transaction (one event,
document or record set) and the output is either a graph for Persist (`graph`
output) or a JSON document for a caller that delivers it to another system
(`json` output, see [JSON output](#json-output)). Keep batch conversions on
`spark-sql`. Read the engine contract in
[transactional JavaScript mappings](../../build-transform-product/reference/transactional-javascript.md)
and verify the deployment supports it before authoring: list the pair's
registered versions and confirm the API accepts `engine: "javascript"` and serves
`POST /transform/transactions`. Hand missing support to Kecleon.

## Layout

Keep the mapping beside the pair's other mappings in its configuration repository:

```text
transform/<mapping_id>/
  mapping.json          # engine "javascript", inputs, output, module digest
  src/mapping.ts        # source of truth
  mapping.js            # built script; registered and pinned by sha256
  tests/mapping.test.ts # fixtures and independent expectations
```

Build the registered script with:

```bash
npx esbuild src/mapping.ts --bundle --format=iife --global-name=mapping --target=es2020 --outfile=mapping.js
```

Then set `module.sha256` to the sha256 of the `mapping.js` bytes. Commit both the
source and the built script so the registered bytes are reviewable.

## Write the mapping

- Export one synchronous pure function, `transform(inputs)`, where `inputs` holds
  each declared table by name: `json` → the parsed value, `jsonl` → an array of
  objects, `text` → the unmodified string. A missing optional table is absent.
- Return `{ vertices, edges }`. A vertex is `{ id, label, properties }`; an edge
  is `{ id, label, from, to, properties? }`, with `from`/`to` equal to vertex ids.
- Produce the ids in the mapping. Make them stable and deterministic from source
  identities (for example `<source>:meetings/<documentId>`), and make every edge
  endpoint exactly equal to its vertex id. Transform wraps them as GraphSON
  `g:UUID` values; Persist then rehashes elements from their content.
- Use Lexicon labels and property names for the target language. Pass values as
  plain JSON (strings, numbers, booleans, arrays); omit absent properties rather
  than setting `null`. Persist validates the result against Lexicon, so do not
  re-implement that validation in the mapping.
- Do not import packages at runtime, read files, call the network, or use
  `Date.now()`/`Math.random()` for values. The sandbox exposes none of the host,
  and nondeterminism breaks stable ids and replay.
- Do not apply Neptune CSV escaping (`\;`, `\\`) or write `id`, `created_at` or
  derived index keys.
- Throw an `Error` with a message for input the mapping cannot represent, such
  as a missing document id; the transaction fails as `MappingFailed`.

Example skeleton:

```ts
type Inputs = { document: { id: string; name: string }; document_text: string }

export function transform({ document, document_text }: Inputs) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(document.id)) throw new Error("invalid document id")
  const meetingId = `example-doc:meetings/${document.id}`
  const mediaId = `example-doc:documents/${document.id}`
  const lines = document_text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return {
    vertices: [
      { id: meetingId, label: "meeting", properties: { meeting_identifier: meetingId } },
      { id: mediaId, label: "media", properties: { media_identifier: mediaId, line_count: lines.length } },
    ],
    edges: [{ id: `meeting_has_media:${mediaId}`, label: "meeting_has_media", from: meetingId, to: mediaId }],
  }
}
```

## Test before registering

- Write expectations independently of the mapping's output: ids, labels,
  endpoints and property values per fixture, plus the failure cases (missing
  required input, malformed source, empty transaction).
- When the pair also has a `spark-sql` mapping, port its fixtures and expected
  values and require the same ids, labels, endpoints and values, except Neptune
  CSV escaping, which GraphSON output must not contain. Report any other
  difference as a decision for the owner instead of copying either side.
- Run the tests against the built `mapping.js` as well as the source, so the
  registered bytes are what passed.

## JSON output

Choose `json` output when the transaction's result is not a Persist graph,
typically the API payloads a System flow sends to a partner through Connect.
Declare `"output": { "shape": "json", "format": "json" }` and return any JSON
object or array from `transform`; the transaction returns it unchanged as
`data.result`. Verify the deployment accepts that output first and hand missing
support to Kecleon.

- Shape the document for its caller's plain JSONPath: an array of flat objects
  the caller can iterate, each with the identifiers and request body it needs.
- Keep the same purity rules: no clocks, randomness, network or packages.
- Return `[]` when nothing applies; `null`, strings, numbers and booleans fail as
  `InvalidMappingOutput`.
- Use input-stage quality checks only; output-stage checks need a graph.

Example: map an opt-out event plus an account's phone records to the records to
patch:

```ts
type Phone = { demographicPhoneID: number; phoneNumber: string }
type Inputs = { event: { phone_number: string; dnt_status: boolean; debt_id: string }; phones: Phone[] }

export function transform({ event, phones }: Inputs) {
  const digits = (value: string) => value.replace(/\D/g, "").slice(-10)
  const status = event.dnt_status ? "OPTED_OUT" : "OPTED_IN"
  return phones
    .filter((phone) => digits(phone.phoneNumber) === digits(event.phone_number))
    .map((phone) => ({
      debt_id: event.debt_id,
      demographic_phone_id: phone.demographicPhoneID,
      body: { txtMsgStatus: status },
    }))
}
```

Test the document like a graph: independent expected arrays per fixture,
including no match, several matches and malformed input.

## Register and run

Register through Transform's configuration API as for SQL mappings: validate,
register, then get the version and confirm the `mapping.json` and `mapping.js`
digests. The body is `{ rule, module: { "mapping.js": "<source>" } }`. Versions
are immutable; publish every change as a new version.

Run one transaction through the synchronous route with SigV4, using the API URL
from SSM `/<stackName>/api-url`:

```bash
curl -sS --aws-sigv4 "aws:amz:${AWS_REGION}:execute-api" \
  --user "$AWS_ACCESS_KEY_ID:$AWS_SECRET_ACCESS_KEY" \
  -H "x-amz-security-token: $AWS_SESSION_TOKEN" -H "content-type: application/json" \
  -d @transaction.json "${TRANSFORM_API_URL%/}/transform/transactions"
```

with `transaction.json` like:

```json
{
  "contractVersion": 3,
  "from": "<from>",
  "to": "<to>",
  "transaction_id": "<unique-id>",
  "inputs": {
    "document": { "value": { "id": "<id>", "name": "<name>" } },
    "document_text": { "value": "<text>" },
    "directory_users": { "s3Uri": "s3://<approved-input-bucket>/<key>.jsonl" }
  }
}
```

Use `s3Uri` for large reference tables instead of inlining them per transaction.
Until `scripts/transform_api.py` supports `module` bodies and the transaction
route, use the API directly as above and hand helper support to Kecleon.

Inspect the returned `mapping` identity and digest, `counts` and `graph`, then
check the document with Persist's `POST /persist/validate` before any ingest. For
a `json` mapping, inspect `result` against the fixture's expected document and
confirm its caller reads it with the paths it uses.
Report the returned `durationMs` and the Lambda log durations; do not claim
latency from local runs.
