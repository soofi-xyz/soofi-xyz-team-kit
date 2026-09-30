# Build System from scratch

Use this guide to create the Base System repository or add a configuration to
an existing System deployment.

## 1. Intake

> Use Zygarde with `build-system-product`. Treat Staircase Product as behavioral
> evidence and build the target with TypeScript/AWS CDK. Template-backed flows
> only.

Collect:

- Whether the request is Base System work, configuration work, or both
- Outcome statement and callers
- Leaf Products needed (Lexicon, Connect, Transform, Persist)
- Success criteria and failure modes

## 2. Base service sequence

1. Scaffold strict TypeScript, CDK v2, Node.js Lambda, Vitest, ESLint,
   Prettier, and repeatable `just` commands.
2. Create `SystemDataStack`, `SystemWorkflowStack`, and `SystemApiStack` with
   explicit dependencies.
3. Implement Product/schemas, Flow Templates, Product Flows, waterfalls, and
   invocation/status APIs under `/system`.
4. Implement the DSL compiler and callback/correlation lifecycle.
5. Add configuration discovery/validation and idempotent deployment seeding.
6. Add CDK assertions and handler/domain tests; strict synth all stacks.

## 3. Configuration sequence

1. Draft `composition.manifest.json` with `orchestration.mode` set to
   `system-service`.
2. Add Product definition and request/response schemas.
3. Add one or more Flow Templates and Product Flows. Set
   `flow_template_name` on every flow.
4. Add a waterfall only for alternate-flow failover.
5. Add leaf references and owner handoffs.
6. Keep activation false; validate paths and manifest before synth.

## 4. Repository layout

```text
bin/app.ts
lib/
  system-data-stack.ts
  system-workflow-stack.ts
  system-api-stack.ts
src/
  configuration/
  domain/
  handlers/
  runtime/
  workflow/
configurations/<systemId>/
  composition.manifest.json
  product.definition.json
  schemas/
  flow-templates/
  product-flows/
  waterfall.json
  invocation.contract.md
  emits/
test/
```

## 5. Shared dependencies

| Dependency | Use |
| --- | --- |
| [Engineering](../../apply-engineering-guidelines/SKILL.md) | Quality defaults |
| [Lexicon](../../build-lexicon-product/SKILL.md) | Languages/mappings |
| [Connect](../../build-connect-product/SKILL.md) | Source / connector jobs |
| [Transform](../../build-transform-product/SKILL.md) | Spark language pairs |
| [Batch](../../build-batch-workflows/SKILL.md) | Capacity outside waterfalls |

## 6. Stop conditions

- Manifest invalid → fix before handoffs.
- Flow omits `flow_template_name` → reject it.
- Template includes an absolute host or secret → reject it.
- Missing leaf engine → do not invent under System; open Lapras/Kecleon work.
- No deployment authorization → stop at tested synth and report `Synth`.
