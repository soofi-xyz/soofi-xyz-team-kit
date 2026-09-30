# System configuration contracts

Machine contract for a System-hosted Product configuration. Validate every
`composition.manifest.json` against
[composition.manifest.schema.json](composition.manifest.schema.json).

## Required top-level fields

| Field | Purpose |
| --- | --- |
| `contractVersion` | Integer; this skill uses `1` only. Reject unversioned manifests. |
| `configurationVersion` | Semantic version of this configuration package. |
| `systemId` | Stable kebab-case id (e.g. `sale-availability`). |
| `productName` | Product name exposed by System. |
| `outcome` | Human outcome statement the System must deliver. |
| `orchestration` | `system-service` and invocation mode. |
| `products` | Participating layers — include `system-runtime` as serve path. |
| `configRefs` | Map of logical names → path/URI stubs agents consume. |
| `workflow` | Ordered steps: who runs, which configRef, success gate. |
| `successCriteria` | Testable checks (invocation status, schema, fixture, deferred). |
| `dependencies` | Upstream repos, catalog URIs, env vars. |
| `deploy` | Activation default (`inactive`), cost ceiling notes. |
| `evidence` | Highest proven level and supporting artifact paths. |

## Product ids (`products[].product`)

| Id | Meaning |
| --- | --- |
| `system-runtime` | Base System config/runtime (definition, templates, flows, waterfall, invocations) |
| `lexicon` | Governed languages/mappings |
| `connect` | External-system access: partner configurations + activations over existing Connect flows |
| `transform` | Language translation (Spark Transform) |
| `persist` | Graph/collections when invocations need Persist |
| `deploy` | Platform activation / CDK |
| `batch` | Capacity outside Product waterfalls |
| `translate` | Platform Translate/Language service when distinct from Transform |

## Config ref kinds

Use Product-shaped kinds for System's inner configuration model:

- `product-definition`, `product-schema`, `product-flow-template`,
  `product-flow`, `product-waterfall`, `product-invocation`
- Aggregate: `system-configuration`
- Leaf: `lexicon-catalog`, `connect-source`, `transform-request`,
  `transform-mapping`, `deploy-environment`
- Supporting: `system-openapi`, `system-fixtures`, `other`

Each kind belongs to one product (`product-*` and `system-*` →
`system-runtime`, `connect-*` → `connect`, and so on); a workflow step may
only use refs of its own product. `other` is unrestricted.

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
3. Require exactly one `system-runtime` with role `serve`.
4. Require configRefs for Product definition, request and response schemas,
   Flow Template, Product Flow, and invocation contract.
5. `deploy.activationEnabled` is `false` by default.
6. Do not place Spark SQL, JDBC strings, secret ARNs, or API keys in the
   System manifest.
7. A step's `agent` matches its ref's `ownerAgent` when one is set. Workflow,
   product and success-criterion ids are unique.
8. Every Product Flow sets `flow_template_name`, defaults to inactive, and
   names an emitted Flow Template.
9. Every waterfall names emitted Product Flows and has unique positive
   `order` values.
10. `evidence.level` may only claim work actually verified.

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
- A Connect source stub uses kind `connect-source` and validates against
  [`flow.schema.json`](../../build-connect-product/reference/contracts/flow.schema.json)
  (`PartnerConfiguration`). The runtime schema has no activation kind, so an
  activation stub uses kind `other` and a filename containing `activation`;
  it validates as `Activation`, its `configuration_id` matches an emitted
  source, and it stays `enabled: false` while deploy activation is off.
  A Persist collection reference also uses kind `other`.
- Transform request/mapping stubs validate against
  [`contracts.schema.json`](../../build-transform-product/reference/contracts/contracts.schema.json);
  the request's `from` → `to` pair has a mapping in the emitted Lexicon
  catalog, whose mappings use declared languages.
- Deploy environment component `refs` exist in `configRefs`.
- `dependencies.repos` are `owner/name`; env var names are `UPPER_SNAKE`.

## Check

```bash
python3 skills/build-system-product/scripts/validate-manifest.py path/to/composition.manifest.json
python3 scripts/check-system-manifest.py path/to/composition.manifest.json
```

The scripts live in the team kit and need `jsonschema`. With no arguments they
check the kit's worked example; CI also runs
`scripts/test-build-system-product-contract.py`.

See [emit-contracts.md](emit-contracts.md) and [product-runtime.md](product-runtime.md).
