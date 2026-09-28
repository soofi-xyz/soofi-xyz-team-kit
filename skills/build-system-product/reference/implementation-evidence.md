# Implementation evidence — StaircaseAPI/product

Observed reference for System composition. Distinguish **shipped behavior**
in [StaircaseAPI/product](https://github.com/StaircaseAPI/product) from the
Soofi **target** Product PRD (`build-product-service`), which requires
template-backed flows only and collapses legacy dual services into one CDK app.

This file is evidence for Zygarde authors. It is not authorization to call a
tenant API or to claim an Elephant deployment matches Staircase production.

## Repository layout (observed)

```text
StaircaseAPI/product/
  service.yml                 # name: Product; modules: flow_templates_module, main_module
  requirements/swagger.yml    # canonical OpenAPI
  main_module/
    src/products/             # product CRUD, schemas, OpenAPI generation
    src/flows/                # product flows
    src/flow_templates/       # DSL schemas + compile/upsert
    src/invocations/          # single-flow + waterfall invocations
    src/waterfalls/
    src/reports|sms|emails|blobs|partners/
    state_machines/
      flow_invocation.yml
      waterfall_invocation.yml
      upsert_flow_template.yml
    layers/pyproduct/.../staircase_products.py   # HTTP clients to peer services
    tests/unit/fixtures/valid_flow_template.json
  flow_templates_module/sources/common_steps.py  # StaircaseService runtime step
```

## Behaviors to preserve in composition design

1. **Configuration over code** — new business outcomes are Product + flow
   configs, not new microservices by default.
2. **`StaircaseService` composition** — templates call relative platform paths
   (Connect/connector-jobs, Language/Translate, Persist, Product emails/SMS).
3. **Waterfall failover** — ordered `priority` + `flow_name` (or vendor default
   flow) tried until COMPLETED.
4. **Correlation** — `transaction_id` and Persist collection ids thread
   request/response across services.
5. **OpenAPI owned by Product** — service swagger plus per-product schema merge.

## Target vs legacy (important)

| Topic | Observed legacy | Soofi Product PRD target |
| --- | --- | --- |
| Executable flows | Template **or** mortgage-default SM | **Template only** (`flow_template_name` required) |
| Packaging | Python + Serverless, split modules | TypeScript + CDK, one app |
| Connector pipeline | Hard-wired translate→connector→translate | Express via Flow Template DSL |

When emitting for Soofi/Elephant, follow the **target** column. Use legacy
fixtures only as DSL shape examples (for example
`valid_flow_template.json` Language → Connector → Translate → email-on-failure).

## Example template shape (evidence)

From `main_module/tests/unit/fixtures/valid_flow_template.json` (abbreviated):

- `TranslateInputData` → `StaircaseService` `POST language/translations`
- `RunConnectorFlow` → `StaircaseService` `POST connector-jobs/vendors/{vendor}/flows/{flow}/jobs`
- Failure branch → `StaircaseService` `POST product/{product_name}/emails`

Map Connect ingestion / Transform Spark to the correct modern leaf APIs in
the caller's platform; do not hardcode Staircase hostnames into Elephant
emits.

## Verification levels

| Level | Meaning |
| --- | --- |
| Spec | Manifest + emits reviewable in git |
| Config applied | Product APIs accepted definition/template/flow |
| Leaf ready | Connect/Transform/Lexicon acceptance for those refs |
| Live | Invocation COMPLETED against a real tenant |

Do not report a higher level without evidence.
