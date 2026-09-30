# Base System product contract

The System runtime already exists at
[prismteam-ai/system](https://github.com/prismteam-ai/system). It is the
Product-derived orchestration service for Prism. System owns the reusable
runtime and hosts many versioned business configurations. It does not depend on a separate Product deployment.

Zygarde authors those configurations. Zygarde does not rebuild the runtime.

[StaircaseAPI/product](https://github.com/StaircaseAPI/product) is the
behavioral reference. It proves the domain model and execution semantics, but
its Python/Serverless packaging is not the target. System uses TypeScript,
AWS CDK v2, Node.js Lambda, and the `/system` base path.

## 1. Mission

System must let an operator:

1. Create a named Product with request and response JSON Schemas.
2. upsert a Product Flow Template expressed in the supported DSL and compile
   it to an AWS Step Functions state machine.
3. bind the template to an executable Product Flow. `flow_template_name` is
   required.
4. configure an optional ordered waterfall of Product Flows.
5. invoke one flow or the waterfall and inspect durable status.
6. ship the same artifacts in a checked-in `configurations/<id>/` bundle.

New outcomes are configuration, not new orchestration microservices.

## 2. Ownership

The runtime in `prismteam-ai/system` owns:

- the CDK application and its three ordered stacks;
- Product, schema, Flow Template, Product Flow, waterfall, and invocation
  APIs;
- Flow Template compilation and invocation lifecycle;
- checked-in configuration discovery, validation, and idempotent seeding;
- API, storage, encryption, idempotency, status, telemetry, and tests.

Zygarde owns the configuration package that this runtime loads: the manifest,
Product definition and schemas, Flow Templates, Product Flows, optional
waterfall, invocation contract, and leaf references.

System calls but does not implement:

- Lexicon languages or mappings;
- Connect partner adapters and credentials;
- Transform Spark jobs;
- Persist graph/collection engines;
- Deploy or Marketplace control planes.

Delegate those leaf capabilities to their owning agents and skills.

## 3. API surface

Expose an API-key-protected REST API under `/system`:

- `POST/GET /products`
- `GET/PATCH/DELETE /products/{product_name}`
- `GET /products/{product_name}/request-schema`
- `GET /products/{product_name}/response-schema`
- `PUT/GET/DELETE /products/{product_name}/flow-templates/{template_name}`
- `GET /products/{product_name}/flow-templates`
- `POST/GET /products/{product_name}/product_flows`
- `GET/PATCH/DELETE /products/{product_name}/product_flows/{flow_name}`
- `PUT/GET/DELETE /products/{product_name}/waterfall`
- `POST /products/{product_name}/invocations`
- `GET /products/{product_name}/invocations/{invocation_id}`
- `POST /flow-invocations/{invocation_id}/states/{step_name}/webhooks`

Return stable typed error tags for validation, conflict, not found, inactive
configuration, compile failure, and invocation failure.

## 4. CDK architecture

The runtime deploys one CDK application in this order:

```text
SystemDataStack
  ├── KMS key
  ├── ProductsTable
  ├── FlowTemplatesTable
  ├── IdempotencyTable
  ├── ProductsBucket
  └── FlowTemplatesBucket

SystemWorkflowStack
  ├── template upsert/compile workflow
  ├── template invocation workflow support
  ├── waterfall invocation workflow
  └── status/callback workers

SystemApiStack
  ├── REST API at /system
  ├── CRUD and invocation Lambdas
  ├── Flow Template step Lambdas
  └── logs, alarms, and outputs
```

Declare `SystemWorkflowStack` dependent on `SystemDataStack` and
`SystemApiStack` dependent on `SystemWorkflowStack`. Pass resources through
typed stack props; do not use hard-coded CloudFormation export names.

All retained buckets and tables use encryption. Tables use on-demand billing
and PITR; transient idempotency/status records use TTL. Lambda roles receive
only the resources and actions needed by their handler.

## 5. Runtime model

Support these Flow Template states:

- `StaircaseService`
- `Choice`, `Map`, `Parallel`, `Wait`, `Fail`, `Succeed`
- `SendCallback`, `PatchEvent`, `DownloadPublicContent`

`StaircaseService` calls a relative platform route, carries correlation data,
supports JSONPath input/output injection, and can wait for a callback token.
Never store a hostname or API key in a template.

A Product Flow is executable only when it references an existing compiled
template. There is no fallback default connector state machine.

A waterfall is ordered `{order, flow_name}` failover. Branching and retries
inside a flow belong in the template; alternate-flow failover belongs in the
waterfall.

## 6. Configuration bundles

Use:

```text
configurations/<systemId>/
  composition.manifest.json
  product.definition.json
  schemas/
    request.schema.json
    response.schema.json
  flow-templates/
    <template>.json
  product-flows/
    <flow>.json
  waterfall.json              # only when used
  invocation.contract.md
  emits/
    lexicon|connect|transform|persist|deploy/
```

Validate every bundle before synth. Seed valid bundles idempotently. Keep every
Product Flow inactive until activation is explicitly authorized.

## 7. Deferred features

Base System does not initially implement Staircase Product reports, SMS,
email, blobs, widgets, short links, partner ordering, or Marketplace
publication. Keep route composition isolated so those capabilities can be
added without breaking core orchestration.

## 8. Acceptance

A configuration is ready for handoff when:

1. `skills/build-system-product/scripts/validate-manifest.py` and
   `scripts/check-system-manifest.py` pass, including local path and
   leaf-contract resolution;
2. `orchestration.invocationMode` is `single_flow` or `waterfall`, and every
   config ref kind is one the runtime schema accepts;
3. every Product Flow names a template and stays inactive;
4. evidence is reported as spec, deployed, or live without claiming a runtime
   synth this configuration did not run.
