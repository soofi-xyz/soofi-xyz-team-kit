# System runtime mapping from Staircase Product

Map the domain model in
[StaircaseAPI/product](https://github.com/StaircaseAPI/product) onto the Base
System target. Preserve behavior while changing service identity and
implementation technology.

## Service mapping

```text
Staircase Product                         Prism System
Python + Serverless                      TypeScript + AWS CDK
/product                                 /system
product + flow-template modules          one CDK app, three ordered stacks
Product configuration                    Product configuration
Flow Template DSL                        same DSL contract
compiled Step Functions                  compiled Step Functions
single_flow | waterfall invocation     single_flow | waterfall invocation
```

System keeps Product as the inner business noun. The outer deployed product is
**System**; each hosted business outcome remains a named Product.

## Configuration mapping

| Configuration artifact | System API/runtime surface |
| --- | --- |
| `product.definition.json` | Product row and request/response schema refs |
| `schemas/*.schema.json` | request/response validation and OpenAPI metadata |
| `flow-templates/<name>.json` | compile/upsert workflow and state machine |
| `product-flows/<name>.json` | executable binding requiring `flow_template_name` |
| `waterfall.json` | ordered alternate-flow failover |
| `invocation.contract.md` | start/status/callback acceptance |
| `composition.manifest.json` | bundle identity, leaf refs, gates, and evidence |

The public route for a configured outcome is
`POST /system/products/{product_name}/invocations`.

## Flow Template contract

The compiler accepts:

- `StaircaseService`
- `Choice`, `Map`, `Parallel`, `Wait`, `Fail`, `Succeed`
- `SendCallback`, `PatchEvent`, `DownloadPublicContent`

`StaircaseService`:

- stores a relative service URL, HTTP method, body, headers, and JSONPath
  substitutions;
- receives tenant host and API credentials at invocation time;
- reads from `$.flow_input`, `$.product`, `$.product_flow`, and prior state
  outputs;
- carries `transaction_id`, invocation id, collection ids, and callback token;
- supports bounded retries/catches and callback waits.

Reject absolute service URLs and secret-bearing headers in configuration.

## Compile and invoke

1. Template upsert validates the DSL and persists an immutable revision.
2. The compile workflow produces ASL and creates or updates the template state
   machine.
3. Upsert status records the compiled ARN or a typed compile failure.
4. Product Flow create/update verifies the named template has compiled.
5. Invocation resolves either one Product Flow or the configured waterfall.
6. The execution writes durable status and emits correlation/telemetry.
7. A callback route resumes only the matching invocation and state token.

No code path may infer a legacy connector pipeline from vendor metadata.

## Waterfall boundary

Use the Flow Template for branching, maps, parallel work, retries, waits, and
callbacks within one implementation. Use the waterfall only for ordered
failover among alternate Product Flows. Advance after a terminal failed result;
stop on the first completed result.

## Configuration deployment

The same application supports API-managed and checked-in configurations.
Checked-in bundles are validated before synth and seeded idempotently during
deployment. Seeding must use the same domain validation as API writes, and
deleting a file must not silently delete live configuration.

## Agent boundary

The runtime already exists in `prismteam-ai/system`. Zygarde owns configurations for that runtime and does not rebuild it. Lapras owns Connect adapters,
Kecleon owns Transform mappings, Conkeldurr/Mew own Lexicon and Persist
contracts, and Machamp supports workflow/capacity analysis when a configuration
exceeds ordinary System execution.
