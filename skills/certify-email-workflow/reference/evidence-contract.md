# Email Workflow Certification Evidence Contract

Collect evidence without changing source, infrastructure, data, queues, executions, or provider state.

## Evidence record

Assign every observation an ID:

```text
Evidence ID: GH-01 | AWS-01 | DOC-01
Observed at: ISO-8601 UTC
Environment: source | dev | prod
Revision: immutable commit SHA when applicable
Source: URL, ARN, or PII-safe object key
Observation: concise factual result
Limitations: missing linkage, access, freshness, or scale
```

Documentation evidence proves declared intent only. Test evidence proves the tested path. Runtime evidence proves only the deployed revision and observed population.

## GitHub evidence

Resolve and record:

- repository URLs;
- email PR number and head SHA;
- SMS reference SHA;
- check names, conclusions, and run URLs;
- changed files and relevant SMS and Email implementation paths, handlers, control symbols, tests, synthesized templates, and artifact digests;
- the source-designated top-level state machine construct, its effective `STANDARD` type, and its substantive sequencing definition; collect an exact CloudFormation logical resource ID from a commit-linked synthesized template when one is available, not by guessing from raw CDK construct IDs;
- contracts, ADRs, operations guides, agent guidance, tests, and deployment workflows;
- unresolved review findings and release prerequisites.

Use read-only `gh` operations such as:

- `gh repo view`
- `gh pr view`
- `gh pr checks`
- `gh api` with `GET`

Do not comment, review, label, merge, close, rerun, dispatch, edit, create, or push.

## AWS identity and environment

Ask for or reuse an operator-selected profile. Never embed a developer profile name in the agent or report.

Before evidence collection:

```bash
AWS_PROFILE=<selected-profile>
AWS_REGION=us-east-2
aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"
```

Expected environment identities:

- DEV account: `951132547414`
- PROD account: `014948052063`
- primary region: `us-east-2`

If identity or region differs, stop AWS collection and mark it `Blocked`. Do not attempt role changes or credential repair.

## Allowed AWS evidence

Use control-plane and PII-safe metadata reads only.

### STS

- `GetCallerIdentity`

### CloudFormation

- `DescribeStacks`
- `DescribeStackEvents`
- `GetTemplate`
- `ListStacks`
- `ListStackResources`

Capture status, timestamps, tags, outputs, template digests, relevant control properties, and resource identities. Prefer discovery from stack outputs/tags over guessed physical names. Do not print resolved sensitive parameters or dynamic references.

For top-level orchestration proof, record `LogicalResourceId`, `ResourceType`, `ResourceStatus`, and `PhysicalResourceId` from `ListStackResources`. Require `ResourceType == AWS::StepFunctions::StateMachine` and `ResourceStatus` equal to `CREATE_COMPLETE`, `UPDATE_COMPLETE`, or `IMPORT_COMPLETE`; a stack output or workflow-like physical name is not resource-type evidence. Use Gate 1 provenance to bind the deployed stack to pinned source when no commit-linked synthesized template is available.

### Step Functions

- `ListStateMachines`
- `DescribeStateMachine`
- `ListExecutions`
- `DescribeExecution`
- `GetExecutionHistory`

Use an existing execution. Never call start, stop, redrive, or callback APIs. Do not print execution input/output if it contains PII; extract only counts, statuses, safe reason codes, policy versions, artifact prefixes, and provenance.

For top-level orchestration proof, record `DescribeStateMachine.stateMachineArn`, `type`, and `status`. Require `type == STANDARD` and `status == ACTIVE`. Inspect the Amazon States Language definition and PII-safe execution-history state/event metadata to prove substantive cross-boundary sequencing; never print execution payloads.

Bind `DescribeExecution.stateMachineArn` to the deployed ARN by exact equality or by documented alias/version qualification. Record `stateMachineAliasArn` and `stateMachineVersionArn` when present, strip only the documented trailing alias or version qualifier, and require the unqualified base to equal the deployed ARN exactly. Do not use generic prefix matching or infer type or ownership from a name. `EXPRESS` is acceptable only for explicitly bounded child workflows.

### Glue

- `GetJob`
- `GetJobRun`
- `GetJobRuns`
- `GetWorkflow`
- `GetWorkflowRun`

Capture job/run identity, state, timestamps, execution time, worker configuration, and safe errors. Never start or stop a run.

### S3

- `ListBucket` / `ListObjectsV2`
- `HeadObject`
- `GetObject` only for explicitly PII-free metadata

Allowed object content:

- `_metadata/*.json`
- `_metadata/completed.json`
- `run_summary/run_summary.json`
- other manifests explicitly documented and verified as PII-free

Never read selected, overflow, hourly, rendered, send, provider-event, or population rows. Never write, copy, tag, restore, or delete objects.

### CloudWatch and logs

- `ListMetrics`
- `GetMetricData`
- `GetMetricStatistics`
- `DescribeAlarms`

Do not read application log events during routine certification because logs may contain protected data. If a required conclusion depends on logs, mark it `Blocked` and request an approved PII-safe evidence extract.

### SQS

- `GetQueueAttributes`
- `ListQueues`
- `ListQueueTags`

Capture approximate depth, age-related metrics through CloudWatch, redrive policy, encryption metadata, and queue identity. Never call `ReceiveMessage`, `DeleteMessage`, `PurgeQueue`, or visibility APIs.

### SES

- `GetAccount`
- `GetSendQuota` where supported
- `ListConfigurationSets`

Capture quota and configuration metadata only. Never call send, test-render, identity mutation, or suppression mutation APIs.

### IAM and KMS

Prefer CloudFormation templates and resource policies already visible in source. If needed, use metadata-only `GetRole`, `ListRolePolicies`, `GetRolePolicy`, `ListAttachedRolePolicies`, `DescribeKey`, and `GetKeyPolicy`. Never create sessions, decrypt data, or change policies.

### Secrets Manager

Do not call `GetSecretValue` or `BatchGetSecretValue`. Existence may be established from source wiring, CloudFormation references, or metadata-only description when explicitly allowed. Never expose secret ARNs when the report does not need them.

## Control-equivalence evidence

Populate every field required by `control-equivalence-map.md` for the pinned SMS and Email revisions. For each row:

1. Inventory every workflow-owned synthesized/deployed CloudFormation resource, ASL state, and deployed code entrypoint using the closure and identity keys in `control-equivalence-map.md`.
2. Map source paths and symbols to synthesized CloudFormation logical IDs, resource types, relevant properties, ASL states/transitions, handlers, and ownership.
3. Link synthesized resources to deployed physical identities, healthy status, asset digests, and existing runtime evidence.
4. Record exact retry/catch/timeout, idempotency, persistence/feedback, operations, security, and provenance controls that apply.
5. Assign exactly one allowed classification with evidence IDs. For `CHANNEL_ADAPTED`, require a non-empty list of row-allowed `adapted_fields` tokens and exactly the row-specific `non_exempt_controls_proven` key set from the map contract, with every value a non-empty evidence-ID array. Explain every `CHANNEL_ADAPTED`, `EXTRA_JUSTIFIED`, or `BLOCKED` result.
6. Record total, mapped, and unmapped inventory counts for CloudFormation, ASL, and code on each side. Every item must link to a required row or justified extra.

Require exact identity within each channel's provenance chain. Across channels, allow one-to-many or many-to-one semantic mappings; do not compare names or counts as if they were identities.

Provider SDK/API, native status vocabulary, quota mechanism, rendering format, and feedback transport may support `CHANNEL_ADAPTED`. Never use channel adaptation to omit submission idempotency, ambiguous-outcome protection, provider correlation, unresolved-event durability, internal lifecycle persistence, persistence failure handling, replay safety, closure, operations, security, or provenance.

For `SEND-02`, `PERSIST-02`, and `REPLAY-01`, require existing commit-linked failure evidence. `PERSIST-02` evidence must identify the concrete writer and orchestration handoff, the stable idempotency key, durable pending or DLQ location, redrive entrypoint, exactly one resulting internal fact, zero repeated provider submissions, and final pending/DLQ reconciliation. Use PII-safe counts, hashes, statuses, and references only. Never create the failure during certification.

## Top-level orchestrator proof

Build one linked proof chain for the resource whose execution owns the end-to-end Email Workflow:

1. Pinned source designates the top-level state machine construct, its effective `STANDARD` type, and Amazon States Language that explicitly sequences the major communication boundaries.
2. Gate 1 provenance binds the deployed stack to that pinned source revision. A commit-linked synthesized template may additionally map the construct to an exact logical resource ID, but raw CDK source need not expose the synthesized ID.
3. `ListStackResources` supplies the deployed logical ID and binds `AWS::StepFunctions::StateMachine`, healthy `ResourceStatus`, and physical state machine ARN.
4. `DescribeStateMachine` binds the same ARN to effective type `STANDARD` and status `ACTIVE`.
5. `DescribeExecution` binds the evaluated end-to-end execution to the deployed ARN exactly or through a recorded alias/version ARN whose unqualified base is an exact match.
6. The definition and PII-safe execution-history metadata prove that Step Functions controls the major audience, scheduling, rendering, provider, and lifecycle transitions directly or through bounded child workflows.

Do not substitute documentation, stack-output names, Lambda functions, Glue workflows/jobs, EventBridge or SQS chains, a solver/child state machine, or a ceremonial one-task wrapper for any link. When direct evidence establishes a non-Step-Functions resource, an unhealthy or inactive resource, a top-level `EXPRESS` state machine, an absent deployed resource, an execution-ARN mismatch after valid qualifier normalization, or delegated non-Step-Functions sequencing, record a Gate 2 failure. When the implementation could satisfy the invariant but authorization, discovery, or immutable provenance prevents completing the chain, record a blocker.

## DEV runtime proof

Require:

- complete SMS and Email CloudFormation/ASL/code inventory coverage with mapped counts equal to totals and no unmapped items;
- all required control-map rows with exact SMS and Email source/deployment evidence, classifications, and evidence IDs;
- top-level source construct, logical resource ID, CloudFormation resource type/status, state machine ARN/type/status, alias/version ARNs when present, normalized execution binding, and substantive sequencing evidence;
- deployed commit SHA, image digest, asset provenance, or equivalent immutable source link;
- successful end-to-end execution ARN;
- Glue/provider/lifecycle child identities;
- completion state and timestamps;
- safe selected, overflow, rendered, submitted, terminal-feedback, and persisted counts;
- immutable manifest/digest reconciliation;
- existing failure evidence for submission ambiguity, persistence-write recovery, and replay without repeated provider side effects;
- metrics and DLQ state for the observed interval.

Nearby CI and deployment timestamps are not enough to link a runtime to a commit.

## Scale proof

Require existing evidence for 100, 10,000, and 100,000 input rows. For each:

- input count and fixture/profile identity;
- selected plus overflow equals unique eligible action population;
- hourly artifacts equal selected actions;
- rendered plus render failures equals selected actions;
- submitted plus pre-submit exclusions plus failures equals rendered actions;
- terminal plus unresolved-provider equals accepted provider submissions;
- persisted plus persistence-pending equals normalized terminal events;
- duration, cost, throttling, and DLQ observations;
- commit and policy version.

## PROD boundary

PROD evidence is control-plane only:

- whether stacks/workflows exist;
- deployment status and revision metadata;
- alarms and queue attributes;
- release-gate configuration.

Do not read PROD S3 artifacts, workflow payloads, provider events, logs, message bodies, or population data.

## Access denial

After one definitive authorization or authentication denial:

1. record the denied action and environment without credentials;
2. stop that evidence path;
3. mark the affected gate/dimension `Blocked`;
4. continue independent read-only evidence paths.
