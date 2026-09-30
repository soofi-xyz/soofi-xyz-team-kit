# Add a System configuration

Use this guide to add a configuration to the existing System runtime at
[prismteam-ai/system](https://github.com/prismteam-ai/system). Do not scaffold
a second System service.

## 1. Intake

> Use Zygarde with `build-system-product`. The runtime already exists. Treat
> Staircase Product as behavioral evidence. Template-backed flows only.

Collect:

- Outcome statement and callers
- Leaf Products needed (Lexicon, Connect, Transform, Persist)
- Success criteria and failure modes
- `single_flow` or `waterfall`

## 2. Configuration sequence

1. Draft `composition.manifest.json` with `orchestration.mode` set to
   `system-service` and `invocationMode` set to `single_flow` or `waterfall`.
2. Add Product definition and request/response schemas.
3. Add one or more Flow Templates and Product Flows. Set
   `flow_template_name` on every flow.
4. Add a waterfall only for alternate-flow failover.
5. Add leaf references and owner handoffs. Connect sources use kind
   `connect-source`. Activation stubs and Persist collection references use
   kind `other`, because those are the kinds the runtime schema accepts.
6. Keep activation false; validate paths and the manifest.

## 3. Package layout

```text
configurations/<systemId>/
  composition.manifest.json
  product.definition.json
  schemas/
  flow-templates/
  product-flows/
  waterfall.json
  invocation.contract.md
  emits/
```

## 4. Shared dependencies

| Dependency | Use |
| --- | --- |
| [Engineering](../../apply-engineering-guidelines/SKILL.md) | Quality defaults |
| [Lexicon](../../build-lexicon-product/SKILL.md) | Languages/mappings |
| [Connect](../../build-connect-product/SKILL.md) | Source / connector jobs |
| [Transform](../../build-transform-product/SKILL.md) | Spark language pairs |
| [Batch](../../build-batch-workflows/SKILL.md) | Capacity outside waterfalls |

## 5. Stop conditions

- Manifest invalid → fix before handoffs.
- Flow omits `flow_template_name` → reject it.
- Template includes an absolute host or secret → reject it.
- Missing leaf engine → do not invent under System; open Lapras/Kecleon work.
- No deployment authorization → stop at a validated package and report `spec`.
