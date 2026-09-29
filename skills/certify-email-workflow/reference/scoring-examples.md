# Email Workflow Certification Scoring Examples

Use these examples to keep repeated evaluations consistent. They are anchors, not substitutes for evidence.

Dimension order:

1. audience/compliance — 15
2. recipient identity — 10
3. scheduling/capacity — 15
4. rendering/handoff — 10
5. provider backlog/send — 15
6. feedback/lifecycle — 15
7. reliability/replay — 10
8. observability/security/evidence — 10

## A. Full certified workflow

- Evidence: pinned refs, complete CloudFormation/ASL/code inventory coverage on both channels, every required control row is `REQUIRED_EQUIVALENT` or `CHANNEL_ADAPTED`, linked top-level `STANDARD` Step Functions proof, commit-linked DEV flow owned by that exact state machine, every boundary reconciled, all five gates pass, required scale and failure runs pass, production approval gate exists.
- Bands: `100, 100, 100, 100, 100, 100, 100, 100`
- Points: `15 + 10 + 15 + 10 + 15 + 15 + 10 + 10 = 100`
- Verdict: `CERTIFIED`

## B. Solver implemented; delivery lifecycle missing

- Evidence: Filter contract, deterministic reduction, scheduling, overflow, and small solver run exist. Rendering, backlog, SES submission, feedback, and persistence do not.
- Control map: `RENDER-01`, `SEND-01`, `SEND-02`, `FEEDBACK-01`, `FEEDBACK-02`, `PERSIST-01`, and `PERSIST-02` are `MISSING`.
- Bands: `25, 50, 50, 0, 0, 0, 50, 25`
- Points: `4 + 5 + 8 + 0 + 0 + 0 + 5 + 3 = 25`
- Gates: end-to-end DEV runtime `Failed`; compliance freshness may also fail.
- Verdict: `NOT_CERTIFIED`

## C. Stale Filter population

- Evidence: end-to-end flow exists, but Monday's Filter output may send Wednesday without rerun or pre-submit suppression check.
- Audience band: at most `25%` / `4` points.
- Gate: compliance and freshness `Failed`.
- Verdict: `NOT_CERTIFIED` regardless of total.

## D. Healthy runtime cannot be linked to evaluated commit

- Evidence: a successful execution exists, but stack/output/artifact metadata has no commit SHA or immutable build provenance.
- Source gate: `Blocked`.
- Runtime-dependent dimensions cannot exceed `25%` from that execution; independently proven code/test evidence may still receive diagnostic bands.
- Verdict: `BLOCKED` unless another gate conclusively fails.

## E. PII in workflow state or alerts

- Evidence: email address, body, debt ID, person ID, or task token appears in Step Functions state, CloudWatch dimensions, PagerDuty, or a review/control message.
- Observability/security band: `0%` / `0`.
- PII/security gate: `Failed`.
- Verdict: `NOT_CERTIFIED`.

## F. End-to-end small run; scale evidence missing

- Evidence: commit-linked 100-row flow reconciles through feedback and persistence; 10,000 and 100,000 runs are absent.
- Relevant capability bands may reach `75%`, but scheduling/capacity and observability/evidence cannot reach `100%`.
- Scale rows: 100 `Pass`; 10,000 and 100,000 `Failed` when required evidence was never produced, or `Blocked` only when evidence exists but evaluator access is denied.
- Verdict: `NOT_CERTIFIED` because all required scale runs are mandatory.

## G. AWS evidence access denied

- Evidence: source review reveals no known failure; verified account access receives a definitive read authorization denial before runtime evidence can be collected.
- Affected gates/dimensions: `Blocked`.
- Verdict: `BLOCKED` when no independent failed gate exists.
- Do not retry with other identities or request broader privileges inside the certification run.

## H. Automatic production deployment before readiness

- Evidence: merge to the default branch unconditionally runs production deployment while documented provider, alarm, metric, compliance, or scale prerequisites remain open.
- Production safety gate: `Failed`.
- Verdict: `NOT_CERTIFIED`, even when no PROD stack currently exists.

## I. Focused template-rendering diagnostic

- Request: compare only Email template rendering and handoff with the pinned SMS reference.
- Mapping: dimension 4, `rendering_and_handoff` — weight 10.
- Evidence: reviewed Git inventory, deterministic renderer tests, and a commit-linked small DEV artifact exist, but durable per-row rendering-failure evidence is absent.
- Band: `50%`.
- Score: `5/10`.
- Mode: `FOCUSED_DIAGNOSTIC`.
- Certification verdict: not evaluated.
- Overall score: not calculated.

Do not score the other seven dimensions or evaluate certification gates. This result does not establish end-to-end readiness.

## J. End-to-end behavior uses a non-Step-Functions orchestrator

- Evidence: pinned source and deployed CloudFormation resources show that Lambda, EventBridge, Glue, or another mechanism is the top-level orchestrator. A solver or child Step Functions execution may also exist and the observed business counts may reconcile.
- Gate: end-to-end DEV runtime `Failed` because the top-level resource is not `AWS::StepFunctions::StateMachine`; the child execution cannot substitute for it.
- Verdict: `NOT_CERTIFIED` regardless of behavior parity or diagnostic total.

## K. Top-level state machine is EXPRESS or execution belongs to a child

- Evidence: CloudFormation identifies the designated state machine, but `DescribeStateMachine.type` is `EXPRESS`, or the execution binding differs from the designated top-level ARN after valid alias/version normalization.
- Gate: end-to-end DEV runtime `Failed`. `EXPRESS` is permitted only for an explicitly bounded child, and an execution from a child cannot prove the top-level runtime.
- Verdict: `NOT_CERTIFIED`.

## L. Focused orchestration diagnostic

- Request: determine whether the Email Workflow is implemented as the required Step Functions orchestrator.
- Mapping: dimensions 7, `reliability_replay_and_overflow`, and 8, `observability_security_and_evidence`.
- Evidence: report the source construct, CloudFormation logical ID/type/status, state machine ARN/type/status, alias/version fields, normalized execution binding, and substantive sequencing evidence.
- Mode: `FOCUSED_DIAGNOSTIC`; report both selected dimensions separately without gates, an aggregate score, or a certification verdict.
- Finding: state explicitly whether the invariant is proven, contradicted, or blocked. Do not infer it from a workflow name, stack output, or child state machine.
- Bands: a contradicted architecture is exactly `0%` / `0/10` for both selected dimensions.
- Blocked runtime: source intent with unavailable runtime proof is exactly `25%` / `3/10` for each selected dimension, with a `Blocked` capability finding.
- Proven narrow scope: complete orchestration proof with the remaining dimension criteria outside the requested scope is exactly `25%` / `3/10` for each selected dimension, with the requested invariant marked `Proven`. This narrow proof does not establish either whole dimension.

## M. Ceremonial Step Functions wrapper

- Evidence: an active `STANDARD` state machine owns the execution ARN, but its definition or history contains one orchestration task and a Lambda, Glue job, EventBridge/SQS chain, or another mechanism performs the cross-boundary sequencing.
- Gate: end-to-end DEV runtime `Failed`; resource identity alone does not prove substantive Step Functions orchestration.
- Verdict: `NOT_CERTIFIED`.

## N. Alias- or version-qualified execution

- Evidence: the execution reports a documented alias or version ARN, the qualifier is recorded, and removing only that qualifier yields the exact active deployed top-level state machine ARN.
- Gate effect: the execution binding portion of Gate 2 passes. Do not fail a valid qualified execution or accept generic prefix matching.
- Verdict: determined by the remaining gate and score evidence.

## O. SES-native implementation maps to Quiq controls

- Evidence: Email uses SES configuration sets and EventBridge while SMS uses Quiq feedback ingress. Both prove stable submission identity, ambiguous-outcome handling, correlation, normalized feedback, unresolved-event durability, and lifecycle closure.
- Control map: provider-mechanism rows may be `CHANNEL_ADAPTED` only with non-empty row-whitelisted `adapted_fields` and exactly the row-mandated, evidence-backed `non_exempt_controls_proven` keys.
- Gate effect: channel adaptation does not lower Gate 2 or the score by itself.

## P. Persistence redrive is missing

- Evidence: successful internal writes exist, but no durable failed-write parking, idempotent redrive, single-fact proof, or provider-resubmission guard exists.
- Control map: `PERSIST-02` is `MISSING`; dimensions 6 and 7 are `0%`.
- Gate: end-to-end DEV runtime `Failed`.
- Verdict: `NOT_CERTIFIED`.

## Q. Reporting substitutes for internal closure

- Evidence: provider outcomes reach an external report, but no named internal writer closes lifecycle state in the internal system of record.
- Control map: `PERSIST-01` is `MISSING`. Reporting is not an internal persistence substitute.
- Gate: end-to-end DEV runtime `Failed`.
- Verdict: `NOT_CERTIFIED`.

## R. Map evidence is inaccessible

- Evidence: source suggests equivalent controls, but authorization or immutable deployment provenance prevents resolving required deployed fields.
- Control map: affected required rows are `BLOCKED`, not `MISSING`, unless independent evidence proves absence.
- Gate: `Blocked` when no required row is `MISSING`.
- Verdict: `BLOCKED`.

## S. Additional SES controls

- Evidence: Email adds SES suppression or configuration resources beyond the SMS topology while preserving every required control.
- Control map: supplemental rows are `EXTRA_JUSTIFIED` with their purpose recorded.
- Scoring: extras add no points and cannot replace required rows.

## T. Different topology proves equivalent controls

- Evidence: SMS uses separate queues and workers while Email combines bounded functions, but both inventories have complete coverage and both sides have exact source-to-deployment identity and prove the same retry, idempotency, persistence, operations, and security invariants.
- Control map: required rows are `REQUIRED_EQUIVALENT` or, for provider mechanics only, `CHANNEL_ADAPTED`.
- Result: different names and resource counts do not cause failure.

## U. Persistence replay repeats provider submission

- Evidence: redriving a failed internal persistence write re-enters provider submission or can emit another provider attempt.
- Control map: `PERSIST-02` and `REPLAY-01` are `MISSING`.
- Gate: end-to-end DEV runtime `Failed`.
- Verdict: `NOT_CERTIFIED`.

## V. Channel adaptation masks a missing safety control

- Evidence: a row is labeled `CHANNEL_ADAPTED`, but `adapted_fields` is empty or contains an unlisted token, or `non_exempt_controls_proven` differs from the row's exact required key set or contains an empty evidence list.
- Control map: reject the channel-adapted classification and mark the affected required control `MISSING` when the control is known absent, or `BLOCKED` only when access/provenance prevents resolution.
- Gate: apply normal Gate 2 precedence; provider differences never excuse missing safety controls.
