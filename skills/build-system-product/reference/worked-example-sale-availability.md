# Worked example — sale-availability (skeleton)

Skeleton configuration hosted by **System** for a sale-availability outcome.
It composes curated Connect → Transform data using the Product domain model
observed in [StaircaseAPI/product](https://github.com/StaircaseAPI/product).

Kit-only example: it does not scrape on request and does not claim AWS
readiness.

## Outcome

Given `address` or `parcelId`, return availability plus evidence. Unknown ids
fail closed. Invoke through
`POST /system/products/sale-availability/invocations`.

## Package

```text
examples/sale-availability/
  system.manifest.json
  product.definition.json
  schemas/request.schema.json
  schemas/response.schema.json
  flow-templates/sale-availability-lookup.json
  product-flows/default.json
  invocation.contract.md
  emits/lexicon/catalog.stub.json
  emits/connect/partner.stub.json
  emits/connect/activation.stub.json
  emits/transform/request.stub.json
  emits/deploy/environment.stub.json
```

The skill-local validator checks the manifest schema and System invariants;
`python3 scripts/check-system-manifest.py` also resolves every referenced
artifact. The Connect stubs validate against Connect's `flow.schema.json` and
the Transform request against Transform's `contracts.schema.json`.

## Intended shape

| Layer | Agent | Role |
| --- | --- | --- |
| System runtime | Zygarde | Product definition, schemas, Flow Template, Product Flow, invocation |
| Lexicon | Conkeldurr | Languages + mapping for sale-availability fields |
| Connect | Lapras | Partner configuration + disabled activation on the existing `partner-file-intake` flow |
| Transform | Kecleon | Source language → sale-availability language |
| Deploy | Conkeldurr | Activation remains false until authorized |

### Flow template sketch

1. Validate request against the System-hosted Product request schema.
2. `StaircaseService` (or leaf batch precompute) resolve curated artifact /
   Transform output for the key.
3. Map to response schema; on miss → Fail closed.
4. Optional Persist collection write for audit.

Precompute via Connect/Transform batch is valid: the System flow then becomes a
lookup over curated artifacts, not a new ETL engine.

## Non-goals

- Live website scrape in the request path
- Legacy default connector pipeline without `flow_template_name`
- Marketplace registration from this skeleton alone

## Follow-on

Add the package under `configurations/sale-availability/`, wire real
Connect/Transform refs, compile its Flow Template, and keep activation off
until pilot evidence exists.
