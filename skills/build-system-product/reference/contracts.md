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
| `connect` | External-system access: partner configurations + activations over existing Connect flows |
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
- Leaf: `lexicon-catalog`, `connect-partner`, `connect-activation`,
  `transform-request`, `transform-mapping`, `persist-collection`,
  `deploy-environment`
- System service: `system-workflow` — the `workflow.json` the System compiles
  and runs ([System workflow definitions](system-workflow.md))
- Fallback: `system-openapi`, `system-fixtures`, `other`

Each kind belongs to one product (`product-*` → `product-orchestration`,
`connect-*` → `connect`, `system-*` → `system-runtime`, and so on); a workflow
step may only use refs of its own product. `other` is unrestricted.

`path` is either relative to the manifest (must exist, must not leave the
package) or a remote `scheme://` URI, which must carry
`digest: "sha256:<64 hex>"`.

## Workflow step shape

Each `workflow[]` entry: `id`, `product`, `configRef`, `agent`, `gate`.

Allowed `agent` values: `zygarde`, `conkeldurr`, `lapras`, `kecleon`,
`machamp`.

## Validation rules (semantic)

1. Every `workflow[].configRef` exists in `configRefs`, and every
   `workflow[].product` is declared in `products`.
2. Every `products[].product` appears in at least one workflow step unless
   `role` is `reference-only`.
3. If `product-orchestration` is present with role `serve` or `execute`,
   require configRefs for definition + flow-template + product-flow (waterfall
   optional). `invocationMode: waterfall` requires a `product-waterfall` ref.
   The default `product-service` mode requires `product-orchestration`.
4. If only `system-runtime` serves (or mode is `thin-package-deferred`),
   require a successCriterion with `verify: deferred` naming Product cutover.
5. `deploy.activationEnabled` is `false` by default.
6. Do not place Spark SQL, JDBC strings, secret ARNs, or API keys in the
   System manifest.
7. A step's `agent` matches its ref's `ownerAgent` when one is set. Workflow,
   product and success-criterion ids are unique.

## System workflow checks

A `system-workflow` ref validates against
[`system-workflow.schema.json`](system-workflow.schema.json), and its `id`
equals `systemId`. Its ledger key and data filter use only fields its trigger
declares, every transition targets a state in the same block, every
non-terminal state sets exactly one of `next` or `end`, and state names are
unique across the definition. The System repeats these checks before it
compiles a definition.

## Dependency resolution

A composition with unresolved dependencies is rejected:

- Every local `configRefs[].path` exists; remote paths are digest-pinned.
- Every file under the package's `emits/` has a configRef pointing to it (or
  to a directory containing it). A leaf product a flow template calls at
  request time — Persist included — is declared in `products`, `configRefs`
  and `workflow`, never left as an unregistered note.
- Product definition `name` equals `productName` (or `systemId`).
- Every product flow sets `flow_template_name` to an emitted template's
  `name`; template transitions target existing states; waterfall
  `flow_name`s match emitted flows.
- Connect partner and activation stubs validate against
  [`flow.schema.json`](../../build-connect-product/reference/contracts/flow.schema.json)
  (`PartnerConfiguration`, `Activation`); the activation's
  `configuration_id` matches an emitted partner and stays `enabled: false`
  while deploy activation is off.
- Transform request/mapping stubs validate against
  [`contracts.schema.json`](../../build-transform-product/reference/contracts/contracts.schema.json);
  the request's `from` → `to` pair has a mapping in the emitted Lexicon
  catalog, whose mappings use declared languages.
- Deploy environment component `refs` exist in `configRefs`.
- `dependencies.repos` are `owner/name`; env var names are `UPPER_SNAKE`.

## Check

```bash
python3 scripts/check-system-manifest.py path/to/system.manifest.json
```

The script lives in the team kit and needs `jsonschema`. With no arguments it
checks the kit's worked examples; CI runs it together with
`scripts/test-build-system-product-contract.py`.

See [emit-contracts.md](emit-contracts.md) and [product-runtime.md](product-runtime.md).
