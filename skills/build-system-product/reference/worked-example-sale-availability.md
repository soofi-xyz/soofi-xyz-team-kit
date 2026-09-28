# Worked example — sale-availability (skeleton)

Skeleton composition for a sale-availability outcome delivered as a **Product**
configuration that composes curated Connect → Transform (or fixture) data —
aligned with [StaircaseAPI/product](https://github.com/StaircaseAPI/product).

Kit-only example: does not create `elephant-xyz/system`, does not scrape on
request, and does not claim AWS readiness.

## Outcome

Given `address` or `parcelId`, return availability plus evidence. Unknown ids
fail closed. Prefer `POST /products/sale-availability/invocations` once Product
is available.

## Package

```text
examples/sale-availability/
  system.manifest.json
  emits/product/product.definition.stub.json
  emits/product/flow-templates/sale_availability_lookup.stub.json
  emits/product/product-flows/default.stub.json
  emits/product/invocation.contract.md
  emits/lexicon/catalog.stub.json
  emits/connect/partner.stub.json
  emits/connect/activation.stub.json
  emits/transform/request.stub.json
  emits/deploy/environment.stub.json
```

`python3 scripts/check-system-manifest.py` validates the manifest and every
stub it references. The Connect stubs validate against Connect's
`flow.schema.json` and the Transform request against Transform's
`contracts.schema.json`.

## Intended shape

| Layer | Agent | Role |
| --- | --- | --- |
| Product orchestration | Conkeldurr (+ Machamp) | Product definition, schemas, flow template, flow, optional waterfall |
| Lexicon | Conkeldurr | Languages + mapping for sale-availability fields |
| Connect | Lapras | Partner configuration + disabled activation on the existing `partner-file-intake` flow |
| Transform | Kecleon | Source language → sale-availability language |
| Deploy | Conkeldurr | Activation remains false until authorized |

### Flow template sketch

1. Validate request against Product request schema.
2. `StaircaseService` (or leaf batch precompute) resolve curated artifact /
   Transform output for the key.
3. Map to response schema; on miss → Fail closed.
4. Optional Persist collection write for audit.

Precompute via Connect/Transform batch is valid: the Product flow then becomes
a lookup over curated artifacts (still Product-shaped, not a new ETL engine).

## Non-goals

- Live website scrape in the request path
- Legacy default connector pipeline without `flow_template_name`
- Marketplace registration from this skeleton alone

## Follow-on

Apply emits to a Product deployment; wire real Connect/Transform refs; keep
activation off until pilot evidence exists.
