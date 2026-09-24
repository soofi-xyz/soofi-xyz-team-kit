# Worked example — sale-availability (skeleton)

Skeleton composition for a **future** Elephant System that answers
"is this address or parcel available for sale?" from **curated** Connect →
Transform artifacts (or fixtures standing in for them).

This example is **kit-only**. It does not create `elephant-xyz/system`, does not
scrape websites on request, and does not claim AWS readiness.

## Outcome

Given `address` or `parcelId`, return availability plus evidence/source pointers
from curated datasets. Unknown ids fail closed.

## Manifest

See [examples/sale-availability.system.manifest.json](examples/sale-availability.system.manifest.json).
Validate it with the skill schema before treating the composition as ready.

## Intended product roles

| Product | Agent | Role in v1 |
| --- | --- | --- |
| Lexicon | Conkeldurr | Publish/source languages and mapping for sale-availability fields |
| Connect | Lapras | Batch ingest prepared source files (e.g. `s3-file`) into typed datasets |
| Transform | Kecleon | Map source language → sale-availability language |
| System runtime | Zygarde (later repo) | Lookup API over fixtures / curated prefix |
| Deploy | Conkeldurr | Inactive CDK stub until activation authorized |

## Explicit non-goals for this skeleton

- Live website scrape in the request path
- Full Glue pilot
- Marketplace registration
- Implementing the System API in this kit repository

## Follow-on (Story B — not this skill change)

When authorized: create the System target repo, copy this manifest under
`systems/sale-availability/`, add OpenAPI + fixtures, wire real Connect/Transform
config refs, keep activation off until pilot evidence exists.
