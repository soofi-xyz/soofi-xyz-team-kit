---
name: build-connect-product
description: "Build Connect, the only layer that talks to external systems, as configurable blocks: generic verbs (LIST, FETCH, PUT, MOVE, CALL, POLL, WAIT_FOR_WEBHOOK, DECRYPT) over typed connections (http, sftp, azure_blob, s3, drop_zone), shared options (ledger, pagination, file landing), partner configurations, activations (schedule, drop zone, webhook) and a job API, compiled to Step Functions. Use for partner APIs, webhooks, partner file intake or delivery, and adding partners, drivers or verbs."
---

# Build Connect Product

Use `lapras` for Connect. Connect talks to external systems only and hands
results to products through its job contract. It is a flow specification of
generic verbs over typed connections, compiled into Step Functions state
machines. Implement product code in the user's target repository; this skill
contains instructions, contracts and examples only.

## Read by task

1. Always read [architecture](reference/architecture.md) for the boundary,
   concepts, pipelines and caller contract.
2. To write or review a flow, partner configuration or activation, read
   [flow specification](reference/flow-spec.md) and
   [blocks](reference/blocks.md), and validate against
   [`contracts/flow.schema.json`](reference/contracts/flow.schema.json).
3. To onboard a partner or a new use case, start from
   [use cases](reference/use-cases.md) and the closest file in
   [examples](reference/examples/). Reuse an existing flow before writing one.
4. To implement or change the runtime, read
   [AWS runtime](reference/aws-runtime.md) and the
   [Connect service PRD](../build-connect-service/reference/PRD.md) it builds on.
5. Prove changes with [verification](reference/verification.md).

## Decide the cost of a request

Classify every request before designing anything:

| Request | Deliver |
| --- | --- |
| New partner of a known kind | Partner configuration + activation. No code |
| Known partner, new interaction | New flow from existing verbs and options |
| New storage system or auth scheme | One driver or auth profile, with conformance tests |
| New verb or option | Only with at least two use cases that cannot be composed from the catalog; record the evidence |
| Parsing, classification, graph writes, events, internal calls | Not Connect. Hand back to the product owner |

## Invariants

- Talk only to external systems. Never read or write Persist, publish to
  EventBridge, SNS or product queues, call internal services, or start from
  internal events.
- Name verbs for actions, never for providers, formats or partners. Keep
  provider details in connection types, tenant details in partner
  configurations, and shared behavior in options.
- Put auth and secrets on connections as Secrets Manager references. Flows
  never name secrets.
- Land payloads in the Connect bucket and return file pointers with checksums.
  Keep inline responses within `MaxInlineBytes`.
- Require `limits` on every flow and `Concurrency` on every `Map`.
- Make everything runtime-operable: flows, partner configurations, connections
  and activations change through the API, never through a CDK deploy or
  context flag.
- Pin flow versions in activations. Accept legacy task types only as aliases.
- Do not add a general `CODE` verb.

## Keep shared skills

- Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md) for
  TypeScript CDK, testing, observability and alerting.
- Use [batch workflows](../build-batch-workflows/SKILL.md) for fan-out capacity,
  throttling and cost gates.
- Use [inbound SFTP workflows](../build-inbound-sftp-workflows/SKILL.md) for
  Transfer Family connector details behind the `sftp` driver.

## Set-aside track

[`reference/table-ingestion/`](reference/table-ingestion/PRD.md) holds the
Stage-derived Interprose table-ingestion specification (JDBC reads, record
deltas, entity bundles, Persist-gated checkpoints, Iceberg snapshots). It is
not part of the block architecture and conflicts with the external-only
boundary. Do not build from it unless the user explicitly asks, and resolve
that boundary with them first.

## Return

Return the request classification, flows, partner configurations and
activations added or changed, drivers or options added with their evidence,
schema validation output, compiler and driver test results, and deployment or
live-run evidence reported separately.
