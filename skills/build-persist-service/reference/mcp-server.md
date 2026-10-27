# Persist MCP server

Requested 2026-10-27. This is implementation guidance, not evidence of deployed
support. Verify the target revision before claiming any tool exists.

Engineers and analysts in Claude Code or Cursor query Persist through typed MCP
tools instead of relearning routes, payloads, the graph schema and Gremlin each
session. The server ships inside Persist, is installed with every Marketplace
install and needs nothing installed locally. Report ships its own server at
`/report/mcp` ([Report MCP server](../../build-report-product/reference/mcp-server.md));
clients list both. Do not build one server across products.

## Endpoint and transport

- Serve `https://<shared domain>/persist/mcp` as stateless MCP Streamable HTTP
  (JSON responses, no session state) from its own Lambda.
- Add an explicit `mcp` resource on the keyed shared REST API in
  `lib/persist-shared-api.ts`, as GraphQL and CSV loads have; keep the shared
  `x-api-key` and usage plan. Do not add a public route.
- Call Persist services in process (`GraphQlExecutorService`,
  `GraphQlSearchService`, `GremlinService`, lexicon catalog reads). Never call
  Persist's own HTTP API from the server, so the key is never forwarded.
- Log each tool call: tool, argument shape, duration, row count, outcome and
  correlation id. Redact headers. The key never appears in tool arguments,
  results, errors or logs; a test asserts this.

## Read-only enforcement

Enforce in layers; one bypass must not enable a write.

1. The MCP Lambda imports no ingest, CSV load, lexicon, process-trigger or
   catalog write code, and its IAM role has no write permissions on the graph,
   buckets or configuration.
2. Gremlin runs against the Neptune reader endpoint only.
3. Gremlin passes a step allowlist (reads, filters, projections, aggregation),
   not only `GremlinQueryPolicy`'s mutation denylist.
4. GraphQL refuses any `mutation` operation before execution.
5. Every refusal returns a plain message naming the refused step or operation.
   Writes belong to the HTTP API, Uxie and Deploy.

## Tools

Tool input and output schemas come from the same Effect schemas as the HTTP
routes (`lambda/schemas`). A contract test fails when a tool and its API, or
`docs/openapi.json`, disagree.

| Tool | Behavior |
| --- | --- |
| `describe_schema` | The merged current lexicon in compact form: vertex types, properties and types, edges with endpoints, searchable fields. |
| `search` | Keyword, vector or hybrid search through the GraphQL search source. Returns matched text, score and the source-id path for citation (for example utterance → media → meeting). |
| `run_gremlin` | Read-only Gremlin with timeout, row limit and reader target; long queries go through async Gremlin and are awaited within the timeout. |
| `run_graphql` | Read-only GraphQL with the same limits. |
| `count_by_label` | Vertex or edge counts per label, optionally filtered by label. |
| `date_range` | Date-safe min, max and range of a property that mixes epoch-millisecond numbers and ISO strings; normalizes both and reports the count of each form and unparsable values. |
| `lookup_metric` | Reads metric cells once an active metrics catalog exists; otherwise says none is active. |
| `query_<name>` | A saved, parameterised read-only Gremlin query from configuration, with typed inputs. |

Errors are explained plainly: missing or rejected key, `Forbidden`, timeout,
row or result limit, refused write and unavailable capability (no search source,
no metrics catalog).

## Configuration

Serve `GET/PUT /persist/mcp/configuration` on the shared configuration-source
pattern (API pointer, `If-Match` on the version read, short cache). It takes
effect without a redeploy and holds:

- enabled tools;
- limits: maximum rows, timeout, maximum search results, reader target;
- saved queries: name, description, Gremlin template, typed parameters. Each is
  validated against the step allowlist on `PUT` and appears as `query_<name>`.

Searchable fields stay governed by the lexicon; the server only reports them.

## Feature pieces

| Piece | Delivers | Acceptance |
| --- | --- | --- |
| `mcp-endpoint` | Endpoint, key auth, error mapping, call logging, `describe_schema`, bundle wiring, client setup | Claude Code and Cursor connect with the documented setup and list the tools; the schema returns meeting, media, utterance, action, person and email with their edges and searchable fields; key absent from transcripts and logs. |
| `mcp-graph-query` | `run_gremlin`, `run_graphql`, `count_by_label`, `date_range`, read-only layers | Meeting count equals a verified direct query; earliest and latest meeting `started_at` are correct over mixed epoch-ms and ISO values; a Gremlin write step, CSV load, lexicon or catalog change and GraphQL mutation are refused with a clear message. |
| `mcp-search` | `search` with source-id paths | A RAG question about a known meeting returns utterance text with utterance, media and meeting ids a direct query confirms. Requires a deployed `vector-search` piece. |
| `mcp-configuration` | Configuration API, saved queries as tools | Disabling a tool, lowering the row limit and adding a saved query take effect without a redeploy; the saved query lists as its own tool. |
| `mcp-metrics` | `lookup_metric` | Reads one debt's cells under an active catalog; reports clearly when none is active. |

Each piece has its own user-run configuration and AWS inspection: the MCP
Lambda's correlated logs, the Neptune reader endpoint in use and the
configuration version read.
