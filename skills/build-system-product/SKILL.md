---
name: build-system-product
description: "Build or maintain the System orchestration framework with TypeScript, CDK and Step Functions. Includes per-flow S3 event triggers, per-key ordered event triggers, failure alerting, per-flow business metrics and the entity-creation-before-data-flow pattern. Use Zygarde for runtime changes and a guided mock-first build; use Celebi for outcome configuration."
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
8. For how event triggers are routed from EventBridge, read
   [event triggers](reference/event-triggers.md).
9. For flows that start on a cron, read
   [flow schedules](../configure-system-product/reference/flow-schedules.md).
10. For failed-run records, alarms and alert texts, read
   [failure alerting](reference/failure-alerting.md).
11. For creating people and companies before data flows, with deterministic
   identity matching, read [entity creation](reference/entity-creation.md).

## Ownership

Build System's definitions, schemas, flow-template compiler, template-backed
flows, waterfalls, invocations, correlation, retries and telemetry. Use the
current `/system` runtime; do not require a second historical Product service.
Every executable flow names a template. Do not port the historical reports,
SMS/email, blobs, widgets, short links, partner ordering or marketplace packaging.
Failure alerts to the people who run System are current scope.

Compose leaf products through their supported boundaries. Keep Connect with
Lapras/Wingull, Transform with Kecleon/Silvally, Persist with Conkeldurr/Uxie and
Rule with Gallade/Meditite. Resolve other ownership from the product catalog.
Use retained specialists for supporting work without reassigning product ownership.
Never invent leaf engines inside System.

## Invocation errors, step secrets and readable buckets

Keep these rules; see [invocation errors](../configure-system-product/reference/invocation-errors.md)
and [step secrets and readable buckets](../configure-system-product/reference/secrets-and-buckets.md):

- Never let an API route throw: API Gateway turns an unhandled error into a bare
  `502 Internal server error` that names no cause. State reused across requests
  in a warm Lambda (schema compilers, caches, clients) must accept the same
  configuration read again; test a save and an invocation repeated in one
  service instance. Keep System's own 502 for a failed run distinct in the body.
- Resolve a step's secret only in a System-owned function that sends the
  request; keep only the ARN in templates, state and logs, and redact a value a
  product echoes back. Scope secrets by an install parameter listing full ARNs
  (`StepSecretArns`), the same list in IAM, at save and at send. Refuse
  `Secrets` on steps Step Functions sends itself.
- Treat `ReadableBuckets` as an install prerequisite covering every bucket a
  flow reads. Warn, without refusing, at template and flow save when an
  `ItemsFile` or `ReadObject` reads outside it.
- Keep every change opt-in: no changed defaults, no new required parameters,
  and no stricter save that refuses what was accepted; warn instead. List what
  existing installs, configurations and callers see in the pull request, with a
  test that proves the unchanged behavior.

## Product-call settings under load

Keep these rules; see [product-call settings](reference/product-call-settings.md):

- Do not read Parameter Store (`/account/env-parameters`) on every product call
  without an opt-in cache: under bursts it throttles the account and the step
  fails with a raw `ThrottlingException` no template retries. Cache it behind an
  optional install parameter that defaults to off, and never cache a missing value.
- Never cache the shared API key; read it on every call so a rotation applies at once.
- Name transient settings-read failures `Product.Unavailable` behind the same
  opt-in, keeping missing values `Product.NotConfigured`.
- When runs fail in bursts, check `ProductCallFn` logs for `ThrottlingException`
  before tuning a flow's retries.

## Failure alerting

Own System's failure alerting; see [failure alerting](reference/failure-alerting.md).
Keep these rules:

- Write failed runs and this stack's alarms to Persist as `system_issue` records
  behind `IssuesToPersist`, after the Model `system` extension is installed.
- Keep reports and Console reading Persist, never CloudWatch.
- Send one message per person per flow failure, and none from flow alarms.
- Text registered contributors of the repository where the failure happened, with
  System's own alarms going to System's contributors. Fall back to every registered
  number when nobody matches, and send nothing for `mock-*`.
- Require no per-repository setup for a flow to be covered.
- Keep causes, alarm reasons and personal details out of messages and logs.
- Give a Lambda `handler` the event alone, and test the real export with a
  Lambda-context-shaped second argument.
- Treat an SMS accepted by SNS as unproven until delivery metrics or a phone show it.
  Check the spend limit, sandbox and number registration first.

Celebi owns each flow's `repository`, `upstream` and `alerts.contacts`.

## Flow bindings and Persist reads

Keep these rules; see [contracts](reference/contracts.md):

- Do not bind an api slot to a product an install may list as another kind:
  `flowProblems` refuses the flow ("binding <slot> needs an api but <product>
  is not one"), and Marketplace review's sandbox lists `transform` as a
  workflow. Call that product as an unbound shared-domain api step whose
  `Request.Path` starts with its base path, such as `/transform/transactions`.
- Before pushing, check definitions, templates and flows with System's own
  model and compiler for an install that lists no products and for one that
  lists them as the sandbox does (`transform:workflow`). A check with no
  products listed passes a wrong-kind binding.
- Treat an Inference assertion as decided or tried when its Persist `status`
  index is `APPLIED`, `REJECTED`, `SKIPPED` or `FAILED`. The index is
  `PROPOSED` until an outcome exists, so a test for a non-empty status matches
  every assertion and applies nothing.

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

## Event trigger routing

Route only the events flows ask for; see [event triggers](reference/event-triggers.md).
Keep one EventBridge rule per triggered flow (source, detail-type and literal match
filters), managed with the flow and reconciled on install; never a rule that
matches by source alone. Celebi owns concrete triggers.

## Ordered event triggers

Own per-key ordering of event triggers (`order: {key, version}`); see
[ordered triggers](reference/ordered-triggers.md). Keep these rules:

- Run events with the same key one at a time, newest last: supersede older
  versions, keep only the newest pending event, release on every terminal run.
- Never lose an event whose run fails to start: restore it as pending after a
  thrown start or a 5xx/429 naming no run; alarm on a 4xx rejection instead of retrying.
- Never let a redrive bypass the lane: refuse a superseded or lane-busy redrive
  and claim the lane for an allowed one; detect Step Functions redrives that
  bypass System, and keep the recorded redrive count and the lane claim true
  when a redrive call fails.
- Never leave a pending event waiting for another event: sweep on a schedule,
  find pending lanes with a query, and alarm on old pending events and the
  release DLQ.
- State the lane retention limit; log key hashes, never raw keys.

Celebi owns `order` on concrete flows and their tests.

## Flow schedules

Own scheduled flow runs as the third entry point beside the API and triggers;
see [flow schedules](../configure-system-product/reference/flow-schedules.md).
Keep these rules:

- Keep the schedule in the flow configuration and one EventBridge Scheduler
  schedule per scheduled flow inside the System stack; never a hand-made rule,
  custom Step Functions workflow or outside timer caller.
- Start each time through the API's invocation path with the time's `runKey`
  as idempotency key, and derive `runDate` in the schedule's timezone.
- Skip and record, never queue, a time while a scheduled run of the flow is
  still running.
- Show the schedule, next run time and recent scheduled runs on
  `GET /flows/{name}`; disable without deleting.
- Leave flows without a schedule exactly as before, with no new install
  parameter, and verify on a deployment with a short test schedule.

Celebi owns schedules on concrete flows and their tests.

## Entity creation before data flows

Keep this pattern; see [entity creation](reference/entity-creation.md):

- One entity-creation flow per source creates people and companies before any
  data flow: a trigger on new Connect context (mode `job`) and a daily
  schedule sweep.
- Match deterministically: people on normalized email or E.164 phone,
  companies on URL/domain, reading existing identifiers from Persist with
  `gremlin-async`. Reuse exactly one match; never guess between several.
- Data flows only write edges to existing people through an
  `existing_identifiers` input and re-emit the person vertex as Persist holds it.
- Unresolved rows create nothing; the sweep opens one daily Asana review task
  through Connect `asana-create-task`.
- Declare per-run `metrics` on the flow (`System/FlowMetrics`, succeeded runs
  only); a daily per-source report shows new entities.
- Retry `States.TaskFailed` on Transform steps: Glue's
  `ConcurrentRunsExceededException` arrives under that name.

Celebi owns each source's entity-creation flow and its tests.

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

## Configuration provenance

Follow [configuration provenance: repo-linked Deploy installs](../guide-product-work/reference/configuration-provenance.md).
Put every new System configuration write route behind the gate in `src/configuration/provenance.ts` (headers, modes, checks), `src/configuration/store.ts` (stored `provenance`) and `src/handlers/api.ts`:
read the three headers, store and return `provenance`, and honor
`ConfigurationProvenance` (`Disabled` default, `Warn`, `Enabled` answering
400 `PROVENANCE_REQUIRED` with nothing written). Test all three modes, keep
the default unchanged and list the route in the PR's Compatibility section. Keep the IAM-only `DELETE /flows|templates|definitions/{name}` deletion claims and `RequireFlowRepository` as the reference describes.
