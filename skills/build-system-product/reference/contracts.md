# Composition contracts

Machine contract for System composition. Validate every emitted
`composition.manifest.json` against
[composition.manifest.schema.json](composition.manifest.schema.json).

## Required top-level fields

| Field | Purpose |
| --- | --- |
| `contractVersion` | Integer; this skill uses `1` only. Reject unversioned manifests. |
| `systemId` | Stable kebab-case id (e.g. `sale-availability`). |
| `outcome` | Human outcome statement the System must deliver. |
| `products` | Participating layers — include `product-orchestration` for serve path. |
| `configRefs` | Map of logical names → path/URI stubs agents consume. |
| `workflow` | Ordered steps: who runs, which configRef, success gate. |
| `successCriteria` | Testable checks (invocation status, schema, fixture, deferred). |
| `dependencies` | Upstream repos, catalog URIs, env vars. |
| `deploy` | Activation default (`inactive`), cost ceiling notes. |

Optional: `productName` (Product service name; defaults to `systemId` with
underscores allowed only when documented), `orchestration` summary block.

## Product ids (`products[].product`)

| Id | Meaning |
| --- | --- |
| `product-orchestration` | Product service config (definition, templates, flows, waterfall, invocations) |
| `lexicon` | Governed languages/mappings |
| `connect` | Ingestion / connector jobs |
| `transform` | Language translation (Spark Transform) |
| `persist` | Graph/collections when invocations need Persist |
| `deploy` | Platform activation / CDK |
| `system-runtime` | Thin fallback package only when Product is deferred |
| `batch` | Capacity outside Product waterfalls |
| `translate` | Platform Translate/Language service when distinct from Transform |

## Config ref kinds

Prefer Product kinds for the serve path:

- `product-definition`, `product-schema`, `product-flow-template`,
  `product-flow`, `product-waterfall`, `product-invocation`
- Leaf: `lexicon-catalog`, `connect-source`, `transform-request`,
  `transform-mapping`, `deploy-environment`
- Fallback: `system-openapi`, `system-fixtures`, `other`

## Workflow step shape

Each `workflow[]` entry: `id`, `product`, `configRef`, `agent`, `gate`.

Allowed `agent` values: `zygarde`, `conkeldurr`, `lapras`, `kecleon`,
`machamp`.

## Validation rules (semantic)

1. Every `workflow[].configRef` exists in `configRefs`.
2. Every `products[].product` appears in at least one workflow step unless
   `role` is `reference-only`.
3. If `product-orchestration` is present with role `serve` or `execute`,
   require configRefs for definition + flow-template + product-flow (waterfall
   optional).
4. If only `system-runtime` serves, require a successCriterion with
   `verify: deferred` naming Product cutover.
5. `deploy.activationEnabled` is `false` by default.
6. Do not place Spark SQL, JDBC strings, or API keys in the System manifest.

See [emit-contracts.md](emit-contracts.md) and [product-runtime.md](product-runtime.md).
