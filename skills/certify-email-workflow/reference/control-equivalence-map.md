# Channel-Neutral Control Equivalence Map

Use this map to compare the pinned SMS reference with Email Workflow. Record exact
CloudFormation and code-control evidence on each side, then compare the
channel-independent invariant.

Do not require identical names, logical IDs, topology, language, provider SDK, or
resource count across channels. Require exact identity inside each channel's own
source-to-deployment chain. One SMS control may map to multiple Email resources
or the reverse.

## Required controls

Every certification must resolve all required rows:

| Control ID | Invariant | Dimensions |
|---|---|---|
| `ORCH-01` | An active top-level `STANDARD` Step Functions workflow substantively owns cross-boundary sequencing. | 7, 8 |
| `AUD-01` | Filter owns audience eligibility and send-time freshness. | 1 |
| `IDENTITY-01` | Stable action/message identity prevents duplicate logical sends. | 2 |
| `SCHEDULE-01` | Legal timing, capacity, deterministic ordering, and overflow fail closed. | 3 |
| `RENDER-01` | Reviewed templates render deterministically, preserve action/interaction identity, produce a complete handoff, and keep row failures durable. | 4 |
| `SEND-01` | Shared backlog, quota/rate controls, legal deadlines, bounded retries, terminal outcomes, and observable DLQs govern provider attempts. | 5 |
| `SEND-02` | Submission is idempotent and ambiguous outcomes never trigger blind resend. | 5, 7 |
| `FEEDBACK-01` | Provider feedback enters through a durable ingress, is normalized, and remains durable and replayable when unresolved. | 6 |
| `FEEDBACK-02` | Provider IDs correlate to stable local message and interaction IDs, with unresolved correlation kept durable. | 6 |
| `PERSIST-01` | A named internal writer closes lifecycle state in the internal system of record before reporting. | 6 |
| `PERSIST-02` | Failed persistence writes are durably parked, retried/redriven idempotently, and cannot repeat provider submission. | 6, 7 |
| `REPLAY-01` | Replay resumes at the failed boundary without duplicate facts or provider side effects. | 7 |
| `OPS-01` | DLQs, retention, redrive consumers, alarms, and reconciliation expose unresolved work. | 7, 8 |
| `SEC-01` | IAM, encryption, transport, and PII controls enforce least privilege. | 8 |
| `PROV-01` | Pinned source, synthesized resources, deployed identities, assets, and executions are immutably linked. | 8 |

## Inventory and coverage

Define the inventory closure from the pinned deployment command, environment,
region, CDK context, and stack selection used for the evaluated deployment. If
that closure cannot be reproduced or linked to deployment, classify `PROV-01`
as `BLOCKED`.

Inventory:

- every resource in each synthesized root stack selected by that deployment,
  recursively including every nested `AWS::CloudFormation::Stack`;
- CDK-generated roles, log groups, custom resources, and other generated
  resources present in those templates;
- every state in every `AWS::StepFunctions::StateMachine` in that inventory,
  including Map/Parallel branch paths;
- every Lambda handler, Glue script entrypoint, and custom-resource handler
  configured by an inventoried resource or ASL integration.

Do not count external/imported resources that the templates do not create.
Record each referenced external dependency in the relevant row instead. Do not
count transitive helper functions in code coverage; cite control-bearing helper
symbols in the row's `code` evidence, while the deterministic code total counts
deployed entrypoints.

Use exact identity keys:

- CloudFormation: `<stack-path>::<logical-id>`;
- ASL: `<stack-path>::<state-machine-logical-id>::<full-state-path>`;
- code entrypoint: `<source-sha>::<repository-path>::<handler-or-script-entry>`.

Give each item an evidence ID. Map every item to one or more required rows or to
an `EXTRA_JUSTIFIED` supplemental row. Do not silently ignore conditional or
provider-specific resources in the evaluated synth; map them as channel
adaptations or justified extras.

Report total, mapped, and unmapped counts for CloudFormation resources, ASL
states, and code controls on each side. Full certification requires
`mapped == total` and an empty unmapped list for both channels. In focused mode,
report coverage only for the selected controls and label it partial.

## Row schema

Create one record per required control and one record per justified extra. Use
arrays for one-to-many and many-to-one mappings.

Use this complete channel-evidence object for both `sms` and `email`:

```yaml
source_sha: 40-character SHA
cloudformation:
  - stack: name
    template_digest: digest-or-null
    logical_id: exact-logical-id
    resource_type: AWS::...
    relevant_properties: PII-safe control properties
    physical_id: deployed-id-or-null
    deployment_status: exact-status-or-null
asl:
  - state_machine_arn: arn-or-null
    type: STANDARD-or-EXPRESS
    status: ACTIVE-or-other
    state_name: exact-state-name
    state_type: Task-or-Choice-or-other
    resource_integration: integration-or-null
    transition: next-choice-or-terminal
    retry: exact-retry-policy-or-null
    catch: exact-catch-target-or-null
    timeout: exact-timeout-or-null
    terminal_outcome: outcome-or-null
code:
  - path: repository-relative-path
    symbol: handler-or-control-symbol
    artifact_digest: deployed-digest-or-null
owner:
  capability_boundary: Xatu-or-Oranguru-or-Wigglytuff-or-Chatot-or-release-engineering
  component: concrete-component
retry:
  errors: []
  attempts: null
  interval: null
  backoff: null
  timeout: null
  catch_target: null
  redrive_target: null
  terminal_semantics: null
idempotency:
  key_expression: null
  claim_store: null
  conditional_operation: null
  duplicate_behavior: null
  ambiguous_outcome_behavior: null
  protected_side_effects: []
persistence_feedback:
  correlation_key: null
  normalized_event: null
  internal_system_of_record: null
  writer: null
  closure_condition: null
  unresolved_path: null
  replay_entrypoint: null
operations:
  queue: null
  max_receive_count: null
  retention: null
  replay_consumer: null
  alarm_metric: null
  alarm_threshold: null
  alarm_window: null
  alarm_actions: []
security:
  role: null
  actions: []
  resources: []
  conditions: {}
  encryption: null
  transport_enforcement: null
  public_access: null
provenance:
  requested_ref: ref
  resolved_sha: 40-character SHA
  synth_digest: null
  asset_digest: null
  deployment_identity: null
  execution_binding: null
  evidence_ids: []
  observed_at: ISO-8601 UTC
```

Use that object on both sides of every row:

```yaml
control_id: ORCH-01
invariant: channel-independent requirement
scorecard_dimensions: [7, 8]
gate_required: true
sms: complete-channel-evidence-object
email: complete-channel-evidence-object
classification: REQUIRED_EQUIVALENT
adapted_fields: []
non_exempt_controls_proven: {}
exemption_reason: null
blocker: null
```

Use `null` only when a field does not apply or evidence is unavailable. Explain
unavailable required evidence in `blocker`; do not silently omit it.

## Classifications

Assign exactly one classification:

- `REQUIRED_EQUIVALENT`: both channels prove the same invariant and protection,
  although names, topology, or resource counts may differ.
- `CHANNEL_ADAPTED`: provider-specific mechanics differ, but every
  channel-independent control and required evidence is equivalent.
- `MISSING`: a required control is absent, contradicted, bypassed, or lacks
  evidence that should exist.
- `EXTRA_JUSTIFIED`: a supplemental channel-specific control has a documented
  purpose and does not replace a required row. Use only for non-required rows.
- `BLOCKED`: equivalence is plausible, but access or immutable provenance
  prevents resolution.

Do not use `BLOCKED` to soften known absence. Do not let an extra compensate for
a missing required control. An unjustified extra that bypasses a required
control makes the required row `MISSING`.

## Channel adaptation boundary

`adapted_fields` may contain only these tokens and only on the listed rows:

| Adapted field | Allowed rows |
|---|---|
| `provider_api_and_auth` | `SEND-01`, `SEND-02` |
| `provider_quota_and_routing` | `SEND-01` |
| `provider_rendering_format` | `RENDER-01` |
| `provider_feedback_transport` | `FEEDBACK-01` |
| `provider_native_status_vocabulary` | `FEEDBACK-01` |
| `provider_identifier_field_shape` | `FEEDBACK-02` |
| `provider_event_semantics` | `FEEDBACK-01` |

These tokens cover SES SDK/API versus Quiq HTTP/API, SES configuration
sets/SNS/EventBridge versus Quiq webhook/S3 ingress, native identifiers and
statuses, quota/routing primitives, MIME versus SMS rendering, and
bounce/complaint/unsubscribe versus deliverability/opt-out/conversation events.

For a `CHANNEL_ADAPTED` row, `adapted_fields` must be non-empty and
`non_exempt_controls_proven` must contain exactly the required keys below. Every
value must be a non-empty evidence-ID array.

| Row | Exact required `non_exempt_controls_proven` keys |
|---|---|
| `RENDER-01` | `reviewed_template_source`, `deterministic_rendering`, `stable_interaction_identity`, `complete_execution_handoff`, `durable_render_failure` |
| `SEND-01` | `shared_backlog`, `provider_attempt_capacity`, `legal_deadline_enforcement`, `bounded_retry_terminal_outcome`, `observable_dlq` |
| `SEND-02` | `stable_submission_identity`, `duplicate_suppression`, `ambiguous_outcome_no_blind_resend` |
| `FEEDBACK-01` | `durable_feedback_ingress`, `normalized_feedback`, `unresolved_event_durability`, `replayable_feedback` |
| `FEEDBACK-02` | `provider_internal_correlation`, `stable_local_message_identity`, `stable_interaction_identity`, `unresolved_correlation_durability` |

`adapted_fields` and `non_exempt_controls_proven` must both be empty for every
other classification. Rows not listed above cannot be `CHANNEL_ADAPTED`.

Never exempt:

- top-level `STANDARD` Step Functions ownership;
- stable submission identity and duplicate suppression;
- ambiguous-submission handling without blind resend;
- provider-to-internal correlation and normalized feedback;
- unresolved-event durability and internal lifecycle persistence;
- persistence failure parking, retry, redrive, and deduplication;
- replay without duplicate facts or provider attempts;
- lifecycle closure, reconciliation, DLQs, alarms, IAM, encryption, PII
  boundaries, and immutable provenance.

Do not copy unsafe provider behavior merely for similarity. For example, SMS
failed-delivery resend behavior does not justify resending bounced or complained
email.

## Gate and scoring rules

In certification mode:

1. Resolve every required row against the pinned SMS and Email SHAs.
2. Pass Gate 2 only when every required row is `REQUIRED_EQUIVALENT` or
   `CHANNEL_ADAPTED` with the evidence required by that row.
3. Treat any `MISSING` required row as Gate 2 `Failed`.
4. Treat any `BLOCKED` required row as Gate 2 `Blocked` only when no required row
   is `MISSING`.
5. Never use `EXTRA_JUSTIFIED` to satisfy a required row.

`SEND-02`, `PERSIST-02`, and `REPLAY-01` require existing commit-linked failure
evidence. `PERSIST-02` must identify the concrete writer and orchestration
handoff, show a failed write durably parked and redriven to exactly one internal
fact, and prove that provider submission was not repeated. Slowbro must inspect
existing evidence; it must never induce the failure.

In focused mode, include only requested rows and their mapped dimensions. Apply
the scorecard evidence caps, return no gate outcome, and never imply complete
workflow parity.
