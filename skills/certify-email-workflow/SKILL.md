---
name: certify-email-workflow
description: "Certifies Email Workflow through an exact CloudFormation and code-control map against pinned SMS revisions, allowing only provider-specific channel adaptations. Use for focused diagnostics, workflow readiness, handoff quality, or production certification."
---

> Retained supporting procedure. Historical specialists named below are preserved
> in `archive/agents/` and are not installed agents. For explicitly requested work,
> execute this procedure directly; treat those names as historical role references,
> not delegation targets. Resolve current product ownership through
> [the product workflow](../guide-product-work/SKILL.md). Do not restore an agent
> or change a product's ownership implicitly.

# Certify Email Workflow

Use this skill to certify an existing end-to-end Email Workflow or diagnose explicitly selected capabilities. Do not use it to implement or repair the workflow.

## Load first

Read these companion skills before collecting evidence:

1. `skills/apply-engineering-guidelines/`
2. `skills/select-communication-audience/`
3. `skills/assemble-communication-runtime/`
4. `skills/manage-channel-templates/`
5. `skills/manage-communication-activity/`

Then read every reference in this skill:

- `reference/control-equivalence-map.md`
- `reference/parity-scorecard.md`
- `reference/evidence-contract.md`
- `reference/gates-and-verdicts.md`
- `reference/report-contract.md`
- `reference/scoring-examples.md`

Read `reference/calibration-email-workflow-pr-1.md` only when comparing a later assessment with the initial version 1 calibration. It is a frozen historical record and does not validate the version 3 control-equivalence contract.

## Required inputs

Collect:

- Email Workflow repository or PR URL
- Email Workflow ref to evaluate
- optional SMS Workflow reference repository and ref; default to `Spring-Oaks-Capital-LLC/sms-workflow@main`
- target environment and AWS region
- operator-selected AWS profile
- optional existing DEV execution ARN
- optional focused capability, control IDs, or scorecard dimensions

Resolve both refs to commit SHAs and record them before scoring. When the SMS reference is omitted, resolve the current HEAD of `Spring-Oaks-Capital-LLC/sms-workflow@main` once at the start of the run. A branch name is input convenience, not report identity; score only the resolved SHA and do not re-resolve it during the run.

## Select the mode

Use **certification mode** unless the operator explicitly asks to compare or score only particular capabilities.

Use **focused diagnostic mode** for an explicit partial-scope request:

1. Map the requested scope to canonical control IDs and one or more of the eight existing scorecard dimensions.
2. State the mapping before collecting evidence.
3. Resolve only the selected control rows and score only those dimensions with the standard bands and point lookup.
4. Report each selected result as `points/weight`.
5. Do not calculate a subtotal or overall `/100` score.
6. Label the report `FOCUSED_DIAGNOSTIC`; do not return `CERTIFIED`, `NOT_CERTIFIED`, or a full-workflow readiness claim.

Ask one focused question only when the requested capability cannot be mapped unambiguously. Do not invent or reweight dimensions.

Map a direct question about orchestration implementation or AWS resource type to `ORCH-01` and dimensions 7 (`reliability_replay_and_overflow`) and 8 (`observability_security_and_evidence`). Use the row-to-dimension mapping in `control-equivalence-map.md` for other focused requests. Do not expand an unrelated focused diagnostic solely to evaluate unselected controls.

## Capability model

Evaluate the full workflow through these boundaries:

```text
Filter / Xatu audience
  -> Email runtime reduction and legal scheduling / Oranguru
  -> reviewed template selection and rendering / Wigglytuff
  -> shared backlog, provider submission, correlation, feedback / Chatot
  -> internal lifecycle persistence, metrics, reconciliation, replay
```

Use SMS as the exact control reference, not a demand for identical cross-channel identities:

- record exact CloudFormation, ASL, handler, retry/catch, idempotency, persistence, operations, security, and provenance evidence within each pinned channel revision;
- compare channel-independent invariants across channels using the required classifications; names, topology, language, and resource counts may differ;
- provider-specific SES-versus-Quiq APIs, statuses, quota primitives, rendering formats, and feedback transports may be `CHANNEL_ADAPTED`;
- email does not require OR-Tools when the business decision is to schedule every eligible debt;
- the top-level Email communication orchestrator must still be an active, deployed AWS Step Functions state machine of effective type `STANDARD` whose definition or PII-safe execution history shows substantive control of the major workflow transitions; `EXPRESS` is allowed only for explicitly bounded child workflows;
- email still requires deterministic identity, legal timing, capacity, overflow, submission idempotency, ambiguous-outcome protection, feedback correlation, lifecycle persistence, failure redrive, replay safety, operations, security, and provenance;
- solver-only output is not an end-to-end communication.

## Phase 1: intent, refs, and gates

1. State the one-sentence business intent.
2. Pin the email and SMS commit SHAs.
3. Identify the evaluated email scope, the designated top-level orchestrator, and its runtime components.
4. Inventory every workflow-owned CloudFormation resource, ASL state, and deployed code entrypoint using the deterministic closure and identity keys in `control-equivalence-map.md`.
5. Create every required control-map row and map every inventory item to a required row or justified extra.
6. Create the evidence registry and link each inventory item and map field to evidence IDs.
7. In certification mode, evaluate all five gates using `gates-and-verdicts.md`.
8. In focused mode, record only source linkage, access, safety, or runtime limitations that materially constrain the selected rows and dimensions. Do not assign certification-gate outcomes.
9. For certification findings, distinguish:
   - `Failed`: implementation or submitted evidence contradicts the requirement;
   - `Blocked`: evaluator access or missing provenance prevents a conclusion;
   - `Pass`: direct evidence resolves the gate.

Do not stop diagnostic scoring because a gate failed.

## Phase 2: product and runtime evidence

Collect only the evidence allowed by `evidence-contract.md`. In focused mode, inspect only the selected capabilities and the dependencies necessary to evaluate them; do not expand the run into full certification.

Evaluate:

- every in-scope control-equivalence row, including exact source, CloudFormation, ASL, code, ownership, retry, idempotency, persistence, operations, security, and provenance fields;
- pinned-source and deployed proof that the same active top-level `STANDARD` Step Functions state machine substantively owns the evaluated execution, allowing only documented alias/version qualification when binding ARNs;
- email-level eligibility, consent, suppression, and send-time freshness;
- deterministic one-email-per-debt identity and duplicate behavior;
- timezone-correct legal windows, daily/hourly capacity, and overflow;
- reviewed template inventory and deterministic rendering;
- shared backlog admission, provider quotas/rate limiting, and submission idempotency;
- local-to-provider-to-interaction correlation;
- delivery, bounce, complaint, unsubscribe, and response ingestion;
- idempotent internal persistence, failed-write parking, duplicate-safe redrive, and unresolved-event recovery without provider resubmission;
- replay, redrive, partial failure, and reconciliation;
- metrics, alarms, DLQs, cost limits, PII boundaries, and source provenance.

Runtime evidence must be linked to the evaluated email commit. A successful execution from an unknown deployment revision is useful context but cannot prove that revision.

In certification mode, require existing successful evidence at:

- 100 rows;
- 10,000 rows;
- 100,000 rows.

For each size, require input, selected, overflow, and hourly count reconciliation plus immutable manifest or digest evidence. In focused mode, require these scale runs only when the selected dimension's band criteria depend on them. Never start these runs during evaluation.

## Phase 3: independent review and score

Ask only the relevant agents for read-only findings against the same refs:

- Xatu for audience and compliance;
- Oranguru for runtime, scheduling, outputs, and scale;
- Wigglytuff for templates and rendering;
- Chatot for provider execution and lifecycle closure.

Each reviewer returns:

- resolved commit SHAs;
- relevant control IDs and recommended classifications;
- relevant evidence IDs;
- dimension bands it recommends;
- strengths, failures, and blockers;
- confidence.

Reconcile conflicts from evidence, not majority vote. Score implementation only after product/runtime findings are complete.

In certification mode, resolve every required control-map row, score all eight dimensions, evaluate every gate, and apply the verdict thresholds.

In focused mode:

- score only the mapped dimensions;
- include only the selected control rows;
- retain each dimension's original weight;
- apply evidence caps and scale requirements that belong to that dimension;
- mark unavailable evidence as a limitation or blocker for that dimension;
- use the focused report shape in `report-contract.md`;
- do not apply certification gates or verdict thresholds.

## Safety

- Do not modify repositories, comments, checks, branches, or pull requests.
- Do not start, stop, retry, redrive, or approve AWS workflows.
- Do not invoke Lambda, Glue, SES, EventBridge, or provider APIs.
- Do not write or delete S3 objects.
- Do not receive, delete, or change SQS messages.
- Do not call Secrets Manager `GetSecretValue`.
- Do not read population rows or message bodies.
- Do not inspect PROD data-plane artifacts.
- Keep PII and secrets out of prompts and reports.

## Completion checklist

- both source revisions are immutable SHAs;
- evidence is timestamped and identified;
- certification mode gives all gates concrete reasons, scores all eight dimensions, sums points exactly, and follows the verdict rules;
- focused mode names the selected dimensions, scores only those dimensions, and omits certification verdicts and aggregate scores;
- every scored dimension uses an allowed band and exact point lookup;
- solver evidence is not presented as full-workflow proof;
- every required control row is present and classified with exact SMS and Email evidence;
- CloudFormation, ASL, and code-control inventory coverage is complete on both channels with no unmapped items;
- only non-empty row-whitelisted provider fields use `CHANNEL_ADAPTED`, and exactly the row-mandated non-exempt keys have evidence; no channel adaptation exempts send safety, feedback, persistence, replay, operations, security, or provenance;
- `PERSIST-02` identifies the writer/handoff and existing failure evidence proving durable parking, one idempotent internal fact, and no repeated provider submission;
- certification records the top-level source construct, CloudFormation logical resource ID/type/status, state machine ARN/type/status, alias/version qualification, execution binding, and sequencing evidence;
- report follows `report-contract.md`;
- no mutation or protected-data action occurred.
