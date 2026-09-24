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
| `products` | Ordered list of Product participations (`lexicon`, `connect`, `transform`, `deploy`, optional others). |
| `configRefs` | Map of logical names → path/URI stubs Lapras/Kecleon/Conkeldurr consume. |
| `workflow` | Ordered steps: who runs, which configRef, success gate. |
| `successCriteria` | Testable checks (fixture keys, OpenAPI status, no scrape, etc.). |
| `dependencies` | Upstream repos, catalog URIs, env vars (e.g. `ELEPHANT_LEXICON_ROOT`). |
| `deploy` | Activation default (`inactive`), CDK/stack hints, cost ceiling notes. |

## Product ids

Use these lowercase ids in `products[].product`:

- `lexicon` — governed languages/mappings (Conkeldurr + `build-lexicon-product`)
- `connect` — ingestion (Lapras + `build-connect-product`)
- `transform` — language translation (Kecleon + `build-transform-product`)
- `deploy` — platform activation / CDK (Conkeldurr)
- `system-runtime` — optional thin API package in the System target repo

## Workflow step shape

Each `workflow[]` entry:

- `id` — stable step id
- `product` — must match a `products[].product`
- `configRef` — key into `configRefs`
- `agent` — `conkeldurr` | `lapras` | `kecleon` | `zygarde`
- `gate` — what must be true before the next step (e.g. `checkpoint-committed`)

## Validation rules (semantic)

Beyond JSON Schema:

1. Every `workflow[].configRef` exists in `configRefs`.
2. Every `products[].product` appears in at least one workflow step unless
   `products[].role` is `reference-only`.
3. `deploy.activationEnabled` defaults to `false`.
4. Do not place Spark SQL or JDBC connection strings inside the System
   manifest; those belong in Connect/Transform config emits.

See [emit-contracts.md](emit-contracts.md) for file shapes each agent consumes.
