---
name: build-system-product
description: "Build or maintain the System orchestration framework with TypeScript, CDK and Step Functions. Includes per-flow S3 event triggers and per-key ordered event triggers. Use Zygarde for runtime changes and a guided mock-first build; use Celebi for outcome configuration."
---

Use [the System capability map](../guide-product-work/reference/iterations/system.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Build System

Use `zygarde` to build the reusable **System** service. Use `celebi` with
[configure-system-product](../configure-system-product/SKILL.md) for a business
outcome on an existing deployment. Follow
[guide-product-work](../guide-product-work/SKILL.md) for interactive stages.

## Read by task

1. Read [current scope](reference/PRD.md) and [runtime mapping](reference/product-runtime.md).
2. For a new build, follow [the staged build](reference/from-scratch.md) and
   [three mock scenarios](reference/mock-scenarios.md).
3. For fixtures and configurations, use [contracts](reference/contracts.md),
   [emit shapes](reference/emit-contracts.md) and the version 2
   [manifest schema](reference/composition.manifest.schema.json).
4. Use [sale availability](reference/worked-example-sale-availability.md) as a
   configuration example, not a statement of deployment or product readiness.
5. Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
6. For flows started by S3 object events, read [S3 triggers](reference/s3-triggers.md).
7. For event triggers whose later events must not be undone by earlier ones, read
   [ordered triggers](reference/ordered-triggers.md).

## Ownership

Build System's definitions, schemas, flow-template compiler, template-backed
flows, waterfalls, invocations, correlation, retries and telemetry. Use the
current `/system` runtime; do not require a second historical Product service.
Every executable flow names a template. Do not port the historical reports,
SMS/email, blobs, widgets, short links, partner ordering or marketplace packaging.

Compose leaf products through their supported boundaries. Keep Connect with
Lapras/Wingull, Transform with Kecleon/Silvally, Persist with Conkeldurr/Uxie and
Rule with Gallade/Meditite. Resolve other ownership from the product catalog.
Use retained specialists for supporting work without reassigning product ownership.
Never invent leaf engines inside System.

## Result callbacks

Own the result-callback framework on the sale-availability client facade:
URL validation, the invocation-record field, the dispatcher, retries, DLQ and
alarms. See [result callbacks](../configure-system-product/reference/result-callbacks.md).
Keep these rules:

- Accept only URLs under a client's allowlisted prefixes, HTTPS on port 443,
  without credentials or fragments.
- Refuse redirects and hosts that resolve to non-public addresses.
- Read the environment API key from Secrets Manager on every delivery; never log it.
- Deliver at least once with a stable `X-System-Delivery-Id`; bound retries and
  send exhausted deliveries to a DLQ with alarms.
- Send exactly the GET result body and document it as an OpenAPI `callbacks` entry.

Celebi owns per-client configuration and delivery tests.

## S3 triggers

Own per-flow S3 triggers as a second entry point beside the invocation API; see
[S3 triggers](reference/s3-triggers.md). Keep these rules:

- Accept only the fixed `events` and `inputMode` options and literal
  prefix/suffix filters; no free-form predicates or per-source code.
- Assume only the trigger's `roleArn` with the documented `ExternalId`; store no
  credentials.
- Validate at registration, create nothing on failure and never invoke the flow.
- Start runs through the API's invocation path with an idempotency key per
  object version, and record the trigger as the invocation `source`.
- Bound retries into a DLQ with alarms; log key hashes, never keys or bodies.

Celebi owns per-flow trigger configuration and tests.

## Ordered event triggers

Own per-key ordering of event triggers (`order: {key, version}`); see
[ordered triggers](reference/ordered-triggers.md). Keep these rules:

- Run events with the same key one at a time, newest last: supersede older
  versions, keep only the newest pending event, release on every terminal run.
- Never let a redrive bypass the lane: refuse a superseded or lane-busy redrive
  and claim the lane for an allowed one; detect Step Functions redrives that
  bypass System.
- Never leave a pending event waiting for another event: sweep on a schedule,
  find pending lanes with a query, and alarm on old pending events and the
  release DLQ.
- State the lane retention limit; log key hashes, never raw keys.

Celebi owns `order` on concrete flows and their tests.

## Acceptance

Derive usable feature increments from the System capability map and the requested
scope. Keep template invocation, binding reuse, sequencing, branching, retry
policy, waterfalls and lifecycle behavior separately inspectable where selected.
Split further by complexity; do not force every outcome into the same count.
For each piece, demonstrate relevant mock behavior, implement only that increment,
and have the person run its framework configuration and inspect execution/logs.
Wait for their observation before implementing the next piece. Use the scenario
pack where applicable and add tests for uncovered capabilities. Four fixture
configurations are examples, not four implementation stages or full coverage of
all System features. Rerun cumulative acceptance for the entire selected scope.
Add real integrations only after mock acceptance within scope.

Run `python3 scripts/check-system-manifest.py` for artifact validation. This
checks configuration structure only. Do not treat it as a runtime test or count
unexecuted/deferred scenarios as acceptance. Build product code in the target
repository; this kit supplies the workflow, contracts and test scenarios.

Return framework changes, test results, progress through the shared stages,
observed mock acceptance, real-integration evidence and remaining gaps.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Own configuration lifecycle APIs and pinned leaf-reference validation; installing definitions must not invoke business flows.
