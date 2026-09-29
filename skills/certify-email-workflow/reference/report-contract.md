# Email Workflow Certification Report Contract

Return a factual Markdown report using the shape for the selected mode. Keep it pasteable into a PR, task, or handoff record.

Use sections 1–10 below only for full certification mode.

## 1. Verdict

```text
Verdict: CERTIFIED | NOT_CERTIFIED | BLOCKED
Total: n/100
Certification profile: email-workflow-certification-v3
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
| Provider backlog and send controls | 15 | allowed band | exact lookup | IDs | concise reason |
| Correlation, feedback, and lifecycle closure | 15 | allowed band | exact lookup | IDs | concise reason |
| Reliability, replay, and overflow | 10 | allowed band | exact lookup | IDs | concise reason |
| Observability, security, and evidence | 10 | allowed band | exact lookup | IDs | concise reason |
| **Total** | **100** | | **n** | | |

Bands must be `0%`, `25%`, `50%`, `75%`, or `100%`. Use the point lookup in `parity-scorecard.md`.

## 5. Control equivalence map

Include every required row from `control-equivalence-map.md` plus justified extras:

| Channel | CloudFormation mapped/total | ASL mapped/total | Code mapped/total | Unmapped IDs |
|---|---:|---:|---:|---|
| SMS | n/n | n/n | n/n | none or IDs |
| Email | n/n | n/n | n/n | none or IDs |

| Control ID | Dimensions | SMS evidence IDs | Email evidence IDs | Classification | Exemption or blocker |
|---|---|---|---|---|---|
| canonical ID | dimensions | IDs | IDs | allowed classification | concise reason or none |

Use only `REQUIRED_EQUIVALENT`, `CHANNEL_ADAPTED`, `MISSING`, `EXTRA_JUSTIFIED`, or `BLOCKED`. `EXTRA_JUSTIFIED` is valid only when `gate_required` is false. Each row must also carry the complete machine-readable source, CloudFormation, ASL, code, ownership, retry, idempotency, persistence/feedback, operations, security, and provenance objects specified by the map contract.

Do not classify differences in names, topology, or resource counts as failures by themselves. Every `CHANNEL_ADAPTED` row must include a non-empty list of row-whitelisted `adapted_fields` and exactly the row-mandated `non_exempt_controls_proven` keys with non-empty evidence-ID arrays. Both fields must be empty for other classifications. An extra cannot replace a required row.

## 6. Capability findings

For each capability boundary, state:

- observed behavior;
- expected parity behavior;
- status: `Proven`, `Partial`, `Missing`, or `Blocked`;
- evidence IDs;
- material limitation.

Order: audience, runtime, templates, provider execution, feedback/persistence.

## 7. Scale reconciliation

| Input size | Commit linked | End-to-end | Reconciled | Evidence IDs | Result |
|---:|---|---|---|---|---|
| 100 | Yes/No | Yes/No | Yes/No | IDs | Pass/Failed/Blocked |
| 10,000 | Yes/No | Yes/No | Yes/No | IDs | Pass/Failed/Blocked |
| 100,000 | Yes/No | Yes/No | Yes/No | IDs | Pass/Failed/Blocked |

Do not substitute a unit/performance test for deployed end-to-end evidence.

## 8. Evidence registry

List each cited ID with:

- source URL, ARN, or PII-safe key;
- observation timestamp;
- observed fact;
- limitation.

Do not include raw population rows, message content, protected identifiers, secrets, or task tokens.

## 9. Missing capabilities and remediation

List findings in certification-blocking order. Each item includes:

- failed or blocked gate/dimension;
- concrete missing evidence or capability;
- owning boundary: Xatu, Oranguru, Wigglytuff, Chatot, or release engineering;
- evidence required for closure.

Do not implement fixes during certification.

## 10. Safety statement

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
4. Requested capability scope and its mapping to canonical control IDs and existing scorecard dimensions
5. Email and SMS requested refs and resolved commit SHAs, environment, region, execution ARN when evaluated, and observation timestamp; when orchestration is selected, also include the full source/resource/status/execution-binding/sequencing proof required in certification mode
6. Complete control-map records for only the selected control IDs
7. One row per selected dimension with its original weight, band, `points/weight`, evidence IDs, and reason
8. Capability findings limited to the requested scope, including observed Email behavior and expected SMS parity behavior
9. Evidence registry
10. Scope-specific limitations, blockers, and remediation
11. The standard safety statement

Do not include certification gates, unselected control rows or dimensions, a subtotal, normalized score, overall `/100` score, or a `CERTIFIED`, `NOT_CERTIFIED`, or `BLOCKED` verdict.

## Machine-readable mirrors

For full certification mode, return:

```json
{
  "profile": "email-workflow-certification-v3",
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
  "control_inventory_coverage": {
    "scope": "full",
    "sms": {
      "cloudformation": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "asl": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "code": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "blocker": null
    },
    "email": {
      "cloudformation": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "asl": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "code": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "blocker": null
    }
  },
  "control_map": [
    {
      "control_id": "ORCH-01",
      "invariant": "...",
      "scorecard_dimensions": [7, 8],
      "gate_required": true,
      "sms": {
        "source_sha": "40-character SHA",
        "cloudformation": [],
        "asl": [],
        "code": [],
        "owner": {},
        "retry": {},
        "idempotency": {},
        "persistence_feedback": {},
        "operations": {},
        "security": {},
        "provenance": {}
      },
      "email": {
        "source_sha": "40-character SHA",
        "cloudformation": [],
        "asl": [],
        "code": [],
        "owner": {},
        "retry": {},
        "idempotency": {},
        "persistence_feedback": {},
        "operations": {},
        "security": {},
        "provenance": {}
      },
      "classification": "REQUIRED_EQUIVALENT | CHANNEL_ADAPTED | MISSING | EXTRA_JUSTIFIED | BLOCKED",
      "adapted_fields": [],
      "non_exempt_controls_proven": {},
      "exemption_reason": null,
      "blocker": null
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

Emit all five gates, inventory coverage, every required control-map row, justified extras, and all eight dimensions. Every map side must use the complete channel-evidence object from `control-equivalence-map.md`; the abbreviated empty objects above show placement only. When access prevents inventory resolution, use null totals/mapped counts and explain the limitation in that channel's `blocker`; do not report zero as if the inventory were empty. `total_points` must equal the dimension sum. Do not place protected data in JSON.

For focused diagnostic mode, return:

```json
{
  "profile": "email-workflow-certification-v3",
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
  "control_inventory_coverage": {
    "scope": "focused",
    "sms": {
      "cloudformation": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "asl": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "code": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "blocker": null
    },
    "email": {
      "cloudformation": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "asl": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "code": {"total": 0, "mapped": 0, "unmapped_ids": []},
      "blocker": null
    }
  },
  "control_map": [
    {
      "control_id": "RENDER-01",
      "invariant": "...",
      "scorecard_dimensions": [4],
      "gate_required": true,
      "sms": {},
      "email": {},
      "classification": "REQUIRED_EQUIVALENT | CHANNEL_ADAPTED | MISSING | EXTRA_JUSTIFIED | BLOCKED",
      "adapted_fields": [],
      "non_exempt_controls_proven": {},
      "exemption_reason": null,
      "blocker": null
    }
  ],
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

Emit only selected control-map rows and dimensions. Label inventory coverage as focused and count only items belonging to the selected controls. Every selected map row must use the complete channel-evidence object even though the example is abbreviated. Keep `certification_verdict` and `total_points` null. Populate `scope.orchestrator` with the full orchestration object used by certification when orchestration is selected; otherwise keep it null. Use `execution_binding` values `exact`, `alias_base_match`, `version_base_match`, `mismatch`, or `unresolved`.

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
5. in every certification report, verify all required rows are present, `EXTRA_JUSTIFIED` appears only on non-required rows, any required `MISSING` row yields `NOT_CERTIFIED`, and required `BLOCKED` rows yield `BLOCKED` only when no row is `MISSING`;
6. before returning `CERTIFIED`, verify both inventory blockers are null, CloudFormation/ASL/code mapped counts equal totals, unmapped lists are empty, and every required row is `REQUIRED_EQUIVALENT` or `CHANNEL_ADAPTED`;
7. for every `CHANNEL_ADAPTED` row, verify `adapted_fields` is non-empty and contains only row-whitelisted tokens and `non_exempt_controls_proven` has exactly the row-mandated keys with non-empty evidence-ID arrays; verify both fields are empty for other classifications;
8. before returning `CERTIFIED`, verify every required orchestrator identity, health, execution-binding, and sequencing field is resolved; validate qualifier-field presence and nullability against the selected `execution_binding` classification;
9. in focused mode, verify no unselected control row or dimension, subtotal, overall score, gate outcome, or certification verdict value appears;
10. verify every inventoried item, map field, and scored claim cites at least one evidence ID.
