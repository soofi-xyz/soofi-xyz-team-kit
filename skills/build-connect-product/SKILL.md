---
name: build-connect-product
description: "Build Connect, the only layer that talks to external systems, as configurable blocks: generic verbs (LIST, FETCH, PUT, MOVE, CALL, POLL, WAIT_FOR_WEBHOOK, DECRYPT) over typed connections (http, sftp, azure_blob, s3, drop_zone) with renewing OAuth token profiles, shared options (ledger, pagination, file landing), partner configurations, activations (schedule, drop zone, webhook) and a job API, compiled to Step Functions. Use for Connect engine changes, drivers and verbs; use Wingull for partner configurations."
---

Use [the Connect capability map](../guide-product-work/reference/iterations/connect.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

Follow [guide-product-work](../guide-product-work/SKILL.md). Lapras builds the engine; Wingull owns partner and flow configuration using existing capabilities.

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
5. For source-table ingestion, read
   [table ingestion](reference/table-ingestion/PRD.md) and its contracts.
6. Prove changes with [verification](reference/verification.md).

## Decide the cost of a request

Classify every request before designing anything:

| Request | Deliver |
| --- | --- |
| Existing driver/compiler defect | Lapras: reproduce, fix the engine and run relevant regression checks |
| New partner of a known kind | Hand to Wingull: partner configuration + activation. No engine code |
| Known partner, new interaction | Hand to Wingull: new flow from existing verbs and options |
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
- Own partner credentials through the Connect credentials API
  ([architecture](reference/architecture.md) §7). Connections name a
  credential; flows never do. Target Connect-owned EventBridge Connections
  used by native HTTP Tasks for HTTP auth; Connect main still stores every
  credential in its own Secrets Manager prefix and calls from the HTTP worker
  ([AWS runtime](reference/aws-runtime.md) §6).
- Renew user-scoped tokens in the HTTP driver (`oauth2_refresh_token`,
  `oauth2_jwt_bearer`, [blocks](reference/blocks.md) §3). Own the missing
  engine subject allowlist; until it ships, configurations pin the users a job
  may name in the flow's `parameters` schema.
- Verify signed inbound webhooks with `signed_token` against the partner's
  published keys; never store a secret for them
  ([flow specification](reference/flow-spec.md) §2).
- Land payloads in the Connect bucket and return file pointers with checksums.
  Keep inline responses within `MaxInlineBytes`.
- Require `limits` on every flow and `Concurrency` on every `Map`.
- Make everything runtime-operable: flows, partner configurations, connections,
  credentials and activations change through the API, never through a CDK deploy or
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

## Table ingestion

Build source-table ingestion from
[`reference/table-ingestion/`](reference/table-ingestion/PRD.md) (JDBC and file
reads, record deltas, entity bundles, acknowledgement-gated checkpoints,
Iceberg snapshots) whenever a product needs registered source tables. End each
run at `EXTRACTED`; the calling product runs Transform/Persist and acknowledges.
Name source credentials through the credentials API like any connection.

## Return

Return the request classification, flows, partner configurations and
activations added or changed, drivers or options added with their evidence,
schema validation output, compiler and driver test results, and deployment or
live-run evidence reported separately.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Own flow, partner-configuration and activation lifecycle APIs; keep shared installer execution in Deploy and registration separate from partner jobs.
