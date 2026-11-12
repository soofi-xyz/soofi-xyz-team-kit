---
name: configure-system-product
description: "Compose and test a business outcome as configuration of the existing System framework. Use Celebi for definitions, templates, flows, waterfalls, invocations and per-flow S3 triggers; use Zygarde for framework changes."
---

Use [the System capability map](../guide-product-work/reference/iterations/system.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Configure System

Use `celebi`. Follow [guide-product-work](../guide-product-work/SKILL.md).
Read [the System scope](../build-system-product/reference/PRD.md),
[composition contracts](../build-system-product/reference/contracts.md) and
[emit shapes](../build-system-product/reference/emit-contracts.md).

1. Discover the System deployment, target revision, outcome and available leaf
   products. System is the current product; historical Product names in wire
   fields are compatibility details. Do not default to a separate Product service.
2. Explain the composition with a small diagram and input/output example. Use
   [mock scenarios](../build-system-product/reference/mock-scenarios.md) to guide
   the person through invocation and Step Functions inspection.
3. Emit definition, schemas, reusable template, template-backed flow, optional
   waterfall and invocation fixtures. Produce a version 2 composition manifest
   and pin referenced artifacts. Use the target service's supported payloads.
4. Use `wingull`, `silvally`, `uxie` and `meditite` for leaf configuration. An
   unassigned product is a dependency gap, not permission to invent an owner.
5. Point the manifest's System configRefs at the documents that will be
   registered (System API payloads, named by configRef `name`); the checker
   rejects files under `emits/` that no configRef references.
   Run `python3 scripts/check-system-manifest.py <manifest>` from the kit, then
   exercise the configuration on the actual System framework with mocked leaves.
   Keep schema validity, local fixture checks and AWS execution evidence separate.
6. Record the person's observations and expected/actual results. Introduce real
   leaf services only after mock acceptance and within existing authorization.
   Route framework gaps to `zygarde`; do not build an alternative pipeline.

Return the composition, versions, validated files, actual scenario results,
learning stage, unresolved dependencies and readiness for real integration.

## Batch concurrency

Read [batch concurrency](reference/batch-concurrency.md) before writing a `Batch`
state: the default of 4, a fixed `MaxConcurrency`, or `MaxConcurrency.$` from an
invocation input, and how each is validated.

## Failures and redrive

Read [failures and redrive](reference/failures-and-redrive.md) before writing a
`Catch`, a `Fail` state or a business-rule failure: a template may not reach a
`Fail` state except by catching an error, `FailWhen` fails the step that decides,
and a failed run is resumed with `POST /invocations/{id}/redrive`.

## Human waits and Connect callbacks

Read [human waits](reference/human-waits.md) before a template waits on a person
or on a Connect job: chain products step to step with no event hand-offs, never
retry a `WaitForCallback` Connect step on timeout or 5xx, change its transaction
id on redrive, and await in rounds under the 86400 s run cap.

## Invocation errors

Read [invocation errors](reference/invocation-errors.md) before acting on a 5xx
from an invocation: tell API Gateway's `Internal server error` (System's API
Lambda threw) from System's own 502 for a failed run, join the access log to
the ApiFn log by `requestId`, and diagnose a child flow's answer in a parent step.

## Step secrets and readable buckets

Read [step secrets and readable buckets](reference/secrets-and-buckets.md) when a
step needs a secret value or a run reads S3: send secrets with `Secrets` on a
shared-domain api step and list their ARNs in `StepSecretArns`, never in input,
bindings or staged files; list every bucket a flow reads in `ReadableBuckets` as
an install prerequisite, and treat save `warnings` as a failed install check.

## Result callbacks

Read [result callbacks](reference/result-callbacks.md) to enable a client's
callbacks, test delivery and inspect the dispatcher, queue and DLQ.

## S3 triggers

Read [S3 triggers](reference/s3-triggers.md) to start a flow from S3 object
events: verify deployed support, choose the fixed options, prepare the bucket
role, register per flow and run the test sequence.

## Flow schedules

Read [flow schedules](reference/flow-schedules.md) when a flow must start at a
time: put `schedule` (cron, IANA timezone, input with `$.runDate`/`$.runKey`,
offset, `enabled`) in the flow, never a hand-made EventBridge rule or timer
caller. Verify with a short test schedule (on-time start, a skipped time
during a long run, no start after disabling) before the real cron, and install
through Marketplace and Puller.

## Entity creation before data flows

Read [entity creation](../build-system-product/reference/entity-creation.md)
before a flow creates people or companies, or a data flow links to them: one
entity-creation flow per source (Connect trigger plus daily sweep) matches
deterministically on email, E.164 phone and domain against identifiers read
from Persist; data flows write only edges to existing people through
`existing_identifiers`; unresolved rows go to one daily Asana review task;
declare per-run `metrics` on the flow; retry `States.TaskFailed` on Transform
steps for Glue concurrency.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md) when this work involves configuration bundles.
Compose pinned System and leaf documents; preserve scenario validation and hand bundle installation to Skarmory.
