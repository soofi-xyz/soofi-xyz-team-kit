# System workflow definitions

A System workflow is a **configuration of the System product**, not code. Zygarde writes it; the
marketplace publishes it as a configuration; deploying that configuration pushes it to the System,
whose create-workflow API compiles it into a Step Functions state machine. One System deployment
runs many workflows. Agents never run inside a workflow: Zygarde composes, the System executes.

Validate every definition against [`system-workflow.schema.json`](system-workflow.schema.json)
(generated from the System repository, `schema/workflow-definition.schema.json`) and with
`scripts/check-system-manifest.py`, which also checks what the schema cannot.

## Where it lives

```text
configurations/<systemId>/
  workflow.json          # this definition; configRef kind `system-workflow`, product `system-runtime`
  system.manifest.json   # composition manifest
  emits/...              # drafts for the owning agents
```

`workflow.json` `id` equals the manifest `systemId`.

## Shape (`definitionVersion: 1`)

| Field | Meaning |
| --- | --- |
| `trigger` | The Persist process trigger that starts it: `id`, `version`, `detailType`, graph `element`, the `fields` it carries, optional `dataFilter` |
| `ledgerKey` | Trigger fields that identify one unit of work; the System finishes each key once |
| `enabled` | The System starts runs only for enabled workflows; keep demo and new workflows `false` |
| `startAt`, `states` | The workflow body |

## States

| `type` | Use |
| --- | --- |
| `Product` | Call a Prism product: `product`, `operation`, `parameters`. Today: `transform` `run` (a Transform v2 request). `delivers: true` marks a delivery; its output must include `uploaded` |
| `Choice` | Branch on `$.trigger.*` or `$.steps.*`: `StringEquals`, `NumericEquals`, `NumericGreaterThan`, `NumericLessThan`, `BooleanEquals`, `IsPresent` |
| `Map` | Run an `iterator` block per item of `itemsPath`, with `maxConcurrency`; inside it, `$.item` is the item |
| `Parallel` | Run 2–10 `branches` concurrently |
| `Wait` | Pause `seconds` |
| `Succeed` | The unit of work is complete |
| `Fail` | A final rejection (`error`, `cause`); redelivery and replay never retry it |

Every non-terminal state sets exactly one of `next` or `end`. Transitions stay inside their block,
and state names are unique across the whole definition because results land at
`$.steps.<Name>`. Parameter keys ending in `.$` take a JSONPath into the workflow state.

Branching, parallel work, and fan-out belong in the definition. The System only adds its frame
around it: claim the ledger row, run the definition as the claim owner, then complete, release on
failure, or reject on `Fail`.

## Composition rules

- Call products through `Product` states; never inline another product's engine, SQL, or credentials.
- A product operation the System does not support yet is a System product change, not configuration.
- A new workflow is data: publish and deploy it; do not change System code for it.
