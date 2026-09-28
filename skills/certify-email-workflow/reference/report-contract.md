# Email Workflow Certification Report Contract

Return a factual Markdown report using the shape for the selected mode. Keep it pasteable into a PR, task, or handoff record.

Use sections 1–9 below only for full certification mode.

## 1. Verdict

```text
Verdict: CERTIFIED | NOT_CERTIFIED | BLOCKED
Total: n/100
Certification profile: email-workflow-certification-v2
```

Add one sentence naming the decisive evidence or gap.

## 2. Scope and immutable revisions

Include:

- Email repository, PR, and commit SHA
- SMS requested ref and reference repository, plus the resolved commit SHA
- environment and region
- existing execution ARN when evaluated
- top-level source construct, logical resource ID, and state machine ARN
- CloudFormation resource type/status and Step Functions state machine type/status
- `DescribeExecution.stateMachineArn`, `stateMachineAliasArn`, and `stateMachineVersionArn` when present
- execution binding result: exact unqualified match, valid alias/version base match, mismatch, or unresolved
- evidence IDs proving substantive Step Functions sequencing across the major communication boundaries
- observation timestamp

Never report only a branch name. Never treat a workflow name or stack output as proof of resource type.

## 3. Gates

| Gate | Status | Evidence IDs | Why |
|---|---|---|---|
| Source and runtime traceability | Pass/Failed/Blocked | IDs | concise reason |
| End-to-end DEV runtime | Pass/Failed/Blocked | IDs | concise reason |
| Compliance and freshness | Pass/Failed/Blocked | IDs | concise reason |
| PII and security | Pass/Failed/Blocked | IDs | concise reason |
| Production safety | Pass/Failed/Blocked | IDs | concise reason |

## 4. Scorecard

| Dimension | Weight | Band | Points | Evidence IDs | Why |
|---|---:|---:|---:|---|---|
| Audience and compliance | 15 | allowed band | exact lookup | IDs | concise reason |
| Deterministic recipient identity | 10 | allowed band | exact lookup | IDs | concise reason |
| Legal scheduling and capacity | 15 | allowed band | exact lookup | IDs | concise reason |
| Rendering and handoff | 10 | allowed band | exact lookup | IDs | concise reason |
| SES backlog and send controls | 15 | allowed band | exact lookup | IDs | concise reason |
| Correlation, feedback, and lifecycle closure | 15 | allowed band | exact lookup | IDs | concise reason |
| Reliability, replay, and overflow | 10 | allowed band | exact lookup | IDs | concise reason |
| Observability, security, and evidence | 10 | allowed band | exact lookup | IDs | concise reason |
| **Total** | **100** | | **n** | | |

Bands must be `0%`, `25%`, `50%`, `75%`, or `100%`. Use the point lookup in `parity-scorecard.md`.

## 5. Capability findings

For each capability boundary, state:

- observed behavior;
- expected parity behavior;
- status: `Proven`, `Partial`, `Missing`, or `Blocked`;
- evidence IDs;
- material limitation.

Order: audience, runtime, templates, provider execution, feedback/persistence.

## 6. Scale reconciliation

| Input size | Commit linked | End-to-end | Reconciled | Evidence IDs | Result |
|---:|---|---|---|---|---|
| 100 | Yes/No | Yes/No | Yes/No | IDs | Pass/Failed/Blocked |
| 10,000 | Yes/No | Yes/No | Yes/No | IDs | Pass/Failed/Blocked |
| 100,000 | Yes/No | Yes/No | Yes/No | IDs | Pass/Failed/Blocked |

Do not substitute a unit/performance test for deployed end-to-end evidence.

## 7. Evidence registry

List each cited ID with:

- source URL, ARN, or PII-safe key;
- observation timestamp;
- observed fact;
- limitation.

Do not include raw population rows, message content, protected identifiers, secrets, or task tokens.

## 8. Missing capabilities and remediation

List findings in certification-blocking order. Each item includes:

- failed or blocked gate/dimension;
- concrete missing evidence or capability;
- owning boundary: Xatu, Oranguru, Wigglytuff, Chatot, or release engineering;
- evidence required for closure.

Do not implement fixes during certification.

## 9. Safety statement

End with:

```text
Safety: evaluation used read-only GitHub and AWS evidence; it did not start,
redrive, deploy, send, receive queue messages, retrieve secrets, or mutate DEV
or PROD.
```

If an action was not observable, say `not observed`; never claim safety from absence of access alone.

## Focused diagnostic report

For focused diagnostic mode, return this shorter shape:

1. `Mode: FOCUSED_DIAGNOSTIC`
2. `Scope notice: Partial diagnostic; full certification was not evaluated`
3. `Overall score: Not calculated`
4. Requested capability scope and its mapping to existing scorecard dimensions
5. Email and SMS requested refs and resolved commit SHAs, environment, region, execution ARN when evaluated, and observation timestamp; when orchestration is selected, also include the full source/resource/status/execution-binding/sequencing proof required in certification mode
6. One row per selected dimension with its original weight, band, `points/weight`, evidence IDs, and reason
7. Capability findings limited to the requested scope, including observed Email behavior and expected SMS parity behavior
8. Evidence registry
9. Scope-specific limitations, blockers, and remediation
10. The standard safety statement

Do not include certification gates, unselected dimensions, a subtotal, normalized score, overall `/100` score, or a `CERTIFIED`, `NOT_CERTIFIED`, or `BLOCKED` verdict.

## Machine-readable mirrors

For full certification mode, return:

```json
{
  "profile": "email-workflow-certification-v2",
  "verdict": "CERTIFIED | NOT_CERTIFIED | BLOCKED",
  "total_points": 0,
  "observed_at": "ISO-8601 UTC",
  "scope": {
    "email_repository": "owner/repo",
    "email_pull_request": 0,
    "email_commit_sha": "40-character SHA",
    "sms_repository": "owner/repo",
    "sms_requested_ref": "main",
    "sms_commit_sha": "40-character SHA",
    "environment": "dev",
    "region": "us-east-2",
    "execution_arn": null,
    "orchestrator": {
      "source_construct": null,
      "logical_resource_id": null,
      "cloudformation_resource_type": null,
      "cloudformation_resource_status": null,
      "state_machine_arn": null,
      "state_machine_type": null,
      "state_machine_status": null,
      "execution_state_machine_arn": null,
      "state_machine_alias_arn": null,
      "state_machine_version_arn": null,
      "execution_binding": null,
      "sequencing_evidence_ids": []
    }
  },
  "gates": [
    {
      "name": "source_and_runtime_traceability",
      "status": "Pass | Failed | Blocked",
      "evidence_ids": ["GH-01"],
      "reason": "..."
    }
  ],
  "dimensions": [
    {
      "name": "audience_and_compliance",
      "weight": 15,
      "band": 0,
      "points": 0,
      "evidence_ids": ["GH-01"],
      "reason": "..."
    }
  ],
  "scale": [],
  "evidence": [],
  "remediation": [],
  "safety": {
    "read_only": true,
    "mutations_observed": []
  }
}
```

Emit all five gates and all eight dimensions. `total_points` must equal the dimension sum. Do not place protected data in JSON.

For focused diagnostic mode, return:

```json
{
  "profile": "email-workflow-certification-v2",
  "mode": "focused_diagnostic",
  "certification_verdict": null,
  "total_points": null,
  "observed_at": "ISO-8601 UTC",
  "requested_scope": "template rendering",
  "scope": {
    "email_repository": "owner/repo",
    "email_pull_request": 0,
    "email_commit_sha": "40-character SHA",
    "sms_repository": "owner/repo",
    "sms_requested_ref": "main",
    "sms_commit_sha": "40-character SHA",
    "environment": "dev",
    "region": "us-east-2",
    "execution_arn": null,
    "orchestrator": null
  },
  "dimensions": [
    {
      "name": "rendering_and_handoff",
      "weight": 10,
      "band": 0,
      "points": 0,
      "evidence_ids": ["GH-01"],
      "reason": "..."
    }
  ],
  "evidence": [],
  "limitations": [],
  "remediation": [],
  "safety": {
    "read_only": true,
    "mutations_observed": []
  }
}
```

Emit only selected dimensions. Keep `certification_verdict` and `total_points` null. Populate `scope.orchestrator` with the full orchestration object used by certification when orchestration is selected; otherwise keep it null. Use `execution_binding` values `exact`, `alias_base_match`, `version_base_match`, `mismatch`, or `unresolved`.

Classify qualifier fields deterministically:

- `exact`: `execution_state_machine_arn` equals the deployed unqualified ARN, and both qualifier fields are null;
- `alias_base_match`: `state_machine_alias_arn` is present and its unqualified base equals the deployed ARN; `state_machine_version_arn` may also be present when AWS resolves the alias to a version;
- `version_base_match`: `state_machine_version_arn` is present, `state_machine_alias_arn` is null, and the version ARN's unqualified base equals the deployed ARN.

## Arithmetic check

Before returning:

1. verify every band is allowed;
2. verify every point value matches the lookup;
3. in certification mode, sum points exactly and apply gate precedence;
4. in certification mode, verify `CERTIFIED` satisfies all thresholds;
5. in certification mode, verify every required orchestrator identity, health, execution-binding, and sequencing field is resolved before returning `CERTIFIED`; validate qualifier-field presence and nullability against the selected `execution_binding` classification;
6. in focused mode, verify no subtotal, overall score, gate outcome, or certification verdict value appears;
7. verify every scored claim cites at least one evidence ID.
