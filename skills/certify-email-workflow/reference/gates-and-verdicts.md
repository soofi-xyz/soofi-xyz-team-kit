# Email Workflow Certification Gates

Evaluate every gate before assigning the final verdict. Continue diagnostic scoring after a failed gate.

Apply certification gates and verdicts only in full certification mode. In focused diagnostic mode, report source linkage, access, safety, and runtime limitations only when they affect a selected dimension. Do not assign gate outcomes or infer a certification verdict from a partial assessment.

Use:

- `Pass`: direct evidence satisfies the gate.
- `Failed`: the evaluated implementation or release path is absent, unsafe, or contradicts the gate.
- `Blocked`: evaluator access or missing immutable provenance prevents a conclusion.

Do not use `Blocked` to soften a known implementation failure.

## Gate 1: Source and runtime traceability

Pass only when:

- email and SMS refs resolve to immutable commit SHAs;
- the report identifies the exact evaluated email PR or commit;
- existing DEV runtime evidence carries a deployed commit SHA, image digest, asset manifest, or equivalent immutable provenance;
- policy and contract versions are present on run evidence.

Mark `Blocked` when the runtime is healthy but cannot be linked to a source revision. A nearby deployment timestamp is not sufficient.

## Gate 2: End-to-end DEV runtime

This gate has a non-substitutable orchestration invariant. Pass only when all of the following identify the same top-level Email communication orchestrator:

- pinned source designates the top-level state machine construct and its effective `STANDARD` type; when available, a commit-linked synthesized template supplies its logical resource ID and `AWS::StepFunctions::StateMachine` resource type;
- Gate 1 provenance binds the deployed stack to that pinned source revision;
- CloudFormation `ListStackResources` supplies the deployed logical resource ID and physical ARN, reports `ResourceType == AWS::StepFunctions::StateMachine`, and reports `ResourceStatus` as `CREATE_COMPLETE`, `UPDATE_COMPLETE`, or `IMPORT_COMPLETE`;
- Step Functions `DescribeStateMachine` reports the deployed ARN with `type == STANDARD` and `status == ACTIVE`;
- `DescribeExecution` binds the evaluated end-to-end DEV execution to that deployed state machine, either by exact unqualified ARN or by documented alias/version qualification whose unqualified base exactly matches it;
- commit-linked Amazon States Language or PII-safe execution history proves that Step Functions explicitly controls the major audience, scheduling, rendering, provider, and lifecycle transitions, directly or through bounded child workflows.

Record `stateMachineAliasArn` and `stateMachineVersionArn` when present. Normalize only the documented trailing alias or version qualifier; generic prefix matching is not evidence.

Names, documentation, stack-output keys, or ARN-shaped strings do not prove the resource type. A solver or another child state machine cannot substitute for the top-level orchestrator. A one-task wrapper that delegates cross-boundary orchestration to a monolithic Lambda, Glue job, EventBridge/SQS chain, or other non-Step-Functions sequencer also does not satisfy the invariant. A bounded child workflow may be `EXPRESS`, but the top-level orchestrator may not.

Mark this gate `Failed` when source or runtime evidence proves that the top-level orchestrator is absent, unhealthy, inactive, is not an `AWS::StepFunctions::StateMachine`, is `EXPRESS`, does not own the evaluated execution after valid alias/version normalization, or is only a ceremonial wrapper. Mark it `Blocked` only when authorization, discovery, or immutable source linkage prevents resolving a resource that could otherwise satisfy the invariant; do not use missing evidence to soften a known mismatch.

After the orchestration invariant passes, require one existing successful DEV run to prove:

```text
eligible audience
  -> reduction and legal scheduling
  -> reviewed template rendering
  -> controlled SES/provider submission
  -> provider feedback or deterministic provider simulator feedback
  -> internal lifecycle persistence
```

Require count reconciliation and durable evidence across every boundary. A solver-only run fails this gate even when its artifacts are correct.

Use an approved deterministic provider simulator for DEV when real sending is unsafe. Do not create that run during certification.

## Gate 3: Compliance and freshness

Pass only when:

- Filter evaluates email-address-level rules;
- consent, unsubscribe, DNC/contact restrictions, invalidity, and suppressions are owned explicitly;
- the campaign population is evaluated on its actual send date;
- queued work receives a final pre-submission freshness check;
- an ineligible address is excluded without suppressing unrelated valid addresses unless policy explicitly requires debt-level exclusion;
- the final decision and reason are auditable.

An accepted design that knowingly sends from stale Filter output fails certification even if Solver correctly treats Filter as authoritative.

## Gate 4: PII and security

Pass only when evidence shows:

- no email addresses, message bodies, debt/person identifiers, provider payloads, or task tokens in logs, Step Functions state, metrics dimensions, PagerDuty, or review/control queue messages;
- sensitive artifacts are encrypted and private;
- IAM permissions match capability boundaries;
- manifests and reports expose only PII-safe counts, hashes, statuses, and references;
- unresolved-event evidence remains useful without leaking protected content.

If the implemented provider or feedback stages do not yet exist, mark this gate `Blocked` only when no unsafe behavior is present and their absence is already captured by the end-to-end gate. Mark `Failed` when a known path exposes protected content.

## Gate 5: Production safety

Pass only when:

- certification itself cannot send or mutate;
- PROD deployment requires explicit release approval after documented prerequisites;
- merging an implementation PR cannot automatically provision or enable an unapproved provider path;
- sender enablement, quotas, credentials, dependencies, alarms, and rollback are preflighted;
- shadow/scale certification evidence is complete before production activation;
- no real provider send is required to evaluate the agent.

An unconditional deploy-on-merge path while readiness prerequisites remain open fails this gate, even when no current PROD stack exists.

## Verdict decision

Apply in order:

1. If any gate is `Failed`, return `NOT_CERTIFIED`.
2. Otherwise, if any gate is `Blocked`, return `BLOCKED`.
3. Otherwise, require total `>= 85`, every dimension `>= 75%`, and all three scale runs.
4. If those scoring requirements pass, return `CERTIFIED`.
5. Otherwise return `NOT_CERTIFIED`.

Always report diagnostic scores. Gate failure changes the verdict, not the arithmetic.
