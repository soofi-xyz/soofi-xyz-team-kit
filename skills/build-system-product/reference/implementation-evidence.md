# Implementation evidence — Staircase Product to System

Use [StaircaseAPI/product](https://github.com/StaircaseAPI/product) as observed
behavioral evidence for Base System. Do not claim it is CDK or copy its
Python/Serverless packaging. Do not call a tenant API without authorization.

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

## Behaviors to preserve

1. **Configuration over code** — new business outcomes are Product + flow
   configurations, not orchestration microservices.
2. **`StaircaseService` composition** — templates call relative platform paths
   and receive host/credentials at runtime.
3. **Waterfall failover** — ordered `order` + `flow_name` (or vendor default
   flow) tried until COMPLETED.
4. **Correlation** — `transaction_id` and Persist collection ids thread
   request/response across services.
5. **Schemas/OpenAPI** — Product request/response schemas drive validation and
   per-Product documentation.
6. **Durable lifecycle** — invocation, callback, debug, and status records are
   explicit rather than inferred from logs.

## System target versus observed legacy

| Topic | Staircase Product | Base System target |
| --- | --- | --- |
| Executable flows | Template **or** mortgage-default SM | **Template only** (`flow_template_name` required) |
| Packaging | Python + Serverless, split modules | TypeScript + CDK, three ordered stacks |
| Base path | `/product` | `/system` |
| Deployment identity | Product | System |
| Connector pipeline | Hard-wired translate→connector→translate | Express via Flow Template DSL |
| Configuration in git | API data primarily | API data plus validated `configurations/<id>/` bundles |

Follow the **Base System target** column. Use legacy fixtures only as DSL shape
evidence (for example
`valid_flow_template.json` Language → Connector → Translate → email-on-failure).

## Example template shape (evidence)

From `main_module/tests/unit/fixtures/valid_flow_template.json` (abbreviated):

- `TranslateInputData` → `StaircaseService` `POST language/translations`
- `RunConnectorFlow` → `StaircaseService` `POST connector-jobs/vendors/{vendor}/flows/{flow}/jobs`
- Failure branch → a Product-owned email route

Base System initially excludes Product's email/report/widget modules, so replace
those steps with a typed failure or an external leaf Product reference. Never
hardcode Staircase hostnames.

## Target CDK evidence

This topology is already implemented in `prismteam-ai/system`. Zygarde does
not recreate it. The target topology comes from the canonical Product rebuild
contract:

```text
SystemDataStack
  → SystemWorkflowStack
    → SystemApiStack
```

Preserve the reference service's separate storage, compile/invocation
workflows, and HTTP surfaces through typed stack props rather than legacy
Serverless exports.

## Verification levels

| Level | Meaning |
| --- | --- |
| Spec | Agent/skill contracts and configuration artifacts are reviewable |
| Synth | Tests pass and all three CDK stacks synthesize |
| Deployed | CloudFormation deployed and configuration seed completed |
| Live | A real invocation completed through `/system` |

Do not report a higher level without evidence.
