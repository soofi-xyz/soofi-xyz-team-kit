# Chief of Staff

`slowking` is the Cursor-facing Chief of Staff system builder.

## What it owns

- the repo-side Chief of Staff agent contract
- the approved Cursor-vs-backend boundary
- the runtime contract expected from the downstream backend
- the dependency expectations around Connect, Persist, and Lexicon

## What it does not own

- provider OAuth flows inside the prompt layer
- a fallback graph store
- final backend-side drafted prose in v1

## When to use it

- when adding or refining the Slowking / Chief of Staff agent in this plugin repo
- when scoping the downstream backend contract
- when checking whether Connect/Persist/Lexicon dependencies are satisfied

## Example prompts

- `Use slowking to summarize the Cursor-vs-backend boundary`
- `Use slowking to outline the runtime contract for RetrieveExecutiveContext`
- `Use slowking to check whether Chief of Staff can ship without Connect`

## Backend build capability

When the user wants the deployed AWS backend planned or scaffolded, `slowking`
loads `build-chief-of-staff-runtime` and emits the target-repo file structure,
runtime contract expectations, dependency gates, and validation checklist.
