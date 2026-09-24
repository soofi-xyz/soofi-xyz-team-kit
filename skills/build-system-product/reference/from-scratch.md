# Recreate a System package in a target repository

Use this guide when the user asks to **scaffold a System package** in a target
repo (for example a future `elephant-xyz/system`). This skill still ships only
instructions and contracts — create code in that repository.

Kit-only Story A stops at a validated composition manifest and emit stubs in
this skill. Do not create the Elephant System repo unless the user explicitly
requests that follow-on story.

## 1. Intake

Use this initial instruction:

> Use Zygarde to compose a System for this outcome. Follow
> `build-system-product` PRD, contracts, and emit shapes. Keep Lapras/Kecleon/
> Conkeldurr for product engines. Prefer curated artifacts over scrape-on-request.

Collect:

- Outcome statement and callers (API? batch? both?)
- Which Products already exist (Lexicon / Connect / Transform / Deploy)
- Success criteria and failure modes (unknown id, stale data)
- Target repo path and whether CDK may be stubbed inactive

## 2. Emit sequence

1. **Draft manifest** — validate against `composition.manifest.schema.json`.
2. **Lexicon emits** — language/mapping stubs → Conkeldurr (`build-lexicon-product`).
3. **Connect emits** — source registration stubs → Lapras (`build-connect-product`).
4. **Transform emits** — from/to + mapping refs → Kecleon (`build-transform-product`).
5. **System package layout** (target repo only):

```text
systems/<systemId>/
  system.manifest.json
  openapi.yaml          # when serving HTTP
  fixtures/             # curated stand-ins for Transform output
src/                    # thin TypeScript lookup/handlers
lib/                    # CDK stub, activationEnabled false
AGENTS.md
README.md
```

6. **Deploy posture** — Conkeldurr: inactive activation, cost ceiling, region
   from environment — never hardcode a developer AWS profile name.
7. **Verify** — schema validate manifest; fixture criteria listed; assert no
   scrape in request path for curated-lookup Systems.

## 3. Shared dependencies

| Dependency | Apply it to |
| --- | --- |
| [Engineering](../../apply-engineering-guidelines/SKILL.md) | TypeScript API/CDK quality |
| [Lexicon](../../build-lexicon-product/SKILL.md) | Catalog and mapping publication |
| [Connect](../../build-connect-product/SKILL.md) | Source acquisition configs |
| [Transform](../../build-transform-product/SKILL.md) | Language translation configs |
| [Batch](../../build-batch-workflows/SKILL.md) | When workflow needs Distributed Map |

## 4. Stop conditions

- Manifest invalid → fix before product handoffs.
- Missing Product engine → do not invent one under System; open product work.
- User asked kit-only composition → stop after manifest + emits; do not scaffold
  a System repo unprompted.
