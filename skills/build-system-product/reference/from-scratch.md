# Recreate a System outcome (Product-shaped)

Use this guide when composing a business outcome. Prefer configuring the
**Product** service; keep leaf Product engines with their specialists.

## 1. Intake

> Use Zygarde to compose this outcome as a Product configuration. Follow
> `build-system-product`. Read Product runtime mapping and StaircaseAPI/product
> evidence. Keep `build-product-service` for platform integrate-vs-provision.
> Template-backed flows only.

Collect:

- Outcome statement and callers (sync API? async invocation? waterfall?)
- Whether Product is already deployed (integrate) or must be provisioned
- Leaf Products needed (Lexicon, Connect, Transform, Persist)
- Success criteria and failure modes

## 2. Emit sequence

1. **Draft manifest** — validate against `composition.manifest.schema.json`.
   Set `orchestration.mode` to `product-service` unless Product is unavailable.
2. **Product emits** — definition + schemas + flow template DSL + product flow
   (`flow_template_name`) + optional waterfall + invocation contract.
3. **Leaf emits** — Lexicon / Connect / Transform / Persist stubs the template
   will call.
4. **Deploy posture** — inactive activation; no hardcoded AWS profile names.
5. **Apply** — Conkeldurr applies Product configs (Machamp verifies compile /
   waterfall). Lapras/Kecleon implement leaf wiring.
6. **Verify** — schema-valid manifest; template compiles; invocation criteria
   listed; evidence levels separated.

## 3. Optional target package layout

When storing emits in git (not required to be named `system`):

```text
systems/<systemId>/
  system.manifest.json
  emits/product/...
  emits/lexicon|connect|transform|persist|deploy/...
  fixtures/                    # only if thin-package-deferred
```

## 4. Shared dependencies

| Dependency | Use |
| --- | --- |
| [Engineering](../../apply-engineering-guidelines/SKILL.md) | Quality defaults |
| [Product service](../../build-product-service/SKILL.md) | Orchestration platform |
| [Lexicon](../../build-lexicon-product/SKILL.md) | Languages/mappings |
| [Connect](../../build-connect-product/SKILL.md) | Source / connector jobs |
| [Transform](../../build-transform-product/SKILL.md) | Spark language pairs |
| [Batch](../../build-batch-workflows/SKILL.md) | Capacity outside waterfalls |

## 5. Stop conditions

- Manifest invalid → fix before handoffs.
- No Product and user refuses thin package → stop and ask to provision Product.
- Missing leaf engine → do not invent under System; open Lapras/Kecleon work.
