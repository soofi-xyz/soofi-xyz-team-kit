---
title: Reliability, Observability, and Verification
impact: HIGH
tags: rate-limit, retry, dlq, metrics, langsmith, pagerduty, cost-gate, testing, verification, ci-cd
---

## Reliability, Observability, and Verification

The service touches public data endpoints, a human review queue, and the production website repo. It must be observable, must fail loudly on real failures, and must be provable end to end before it runs unattended.

### Cost gate and throttling

- Make the **first** workflow step predict and gate run cost against a per-env `cost-ceiling` (per `build-batch-workflows` cost gate). Pause for approval above the ceiling.
- Throttle every upstream read via the `ElephantDataGateway`: bounded concurrency, jitter, and exponential backoff on 429/5xx. A throttle is a non-fact outcome, not a retry storm.
- Respect the data owner's documented rate limits from the Phase 1 contract; make limits configuration, not hard-coded.

### Idempotency and recovery

- Snapshot writes are conditional on `datasetRevision`; ledger transitions are conditional on the current state.
- Candidate → review → publish is keyed by `candidateRevision + fingerprint` so retries and redrives never create duplicate review tasks or PRs.
- The Step Functions execution is redrivable; only failed states retry.

### Metrics (register in Lexicon + main dashboard)

Emit per-run and per-unit business metrics, and register each in Lexicon (`cloudwatch-metrics.json`) and on the main dashboard (no metric exists in code without both):

- `DatasetChecked`, `DatasetChanged`
- `CandidateVerified`, `CandidateRejected`
- `ApprovalCreated`, `ApprovalApproved`
- `HeroFactPublished`, `HeroFactFailed`
- plus durations for scan, verify, and publish

### Tracing

- Powertools Logger/Tracer/Metrics + X-Ray on every Lambda and the state machine.
- LangSmith traces for the AI editorial turns, grouped by Asana task id (human interactions) and by run/candidate id (scheduled work). Flush before returning.

### Alerting policy (PagerDuty)

Page on-call via PagerDuty (Events API v2) for **terminal/critical** failures only:

- failed scheduled run
- Elephant data source unreachable beyond retries
- failed approval webhook (cannot complete a task token)
- failed GitHub PR creation
- non-empty DLQ

Rejected/stale candidates, partial coverage, and normal approval waits are **metrics only** — never pages, to avoid alarm fatigue. Add one self-resolving CloudWatch alarm per DLQ that clears on drain.

### Configuration and secrets

- Non-secret config in SSM under `/watchog-agent/<env>/`; runtime ARNs under `/watchog-agent/<env>/runtime/*`.
- Secrets in Secrets Manager: Asana bot (`ASANA_PAT`, `ASANA_WORKSPACE_GID`), GitHub App key, LangSmith key, PagerDuty routing key, and any data-gateway credentials.
- Fail closed with a "configuration missing" error that names the exact parameter/secret. DEV and PROD are fully independent (separate Asana bots, projects, approvers, endpoints).

### CI/CD

Follow `integrate-ci-cd`: a root `justfile` with the required recipes plus a `run-now ENV=<env>` recipe wrapping `aws stepfunctions start-execution`, and the shared DEV/PROD caller workflows wired by `TARGET_ENV`. The pipeline deploys code and infrastructure only; operators seed SSM/Secrets out of band.

### Layered tests

- **Unit** (fixtures): version diff, recipe calculation, rounding/format, prompt/wording bounds, evidence-schema and `resultHash` mismatch, stale-revision prevention, ledger transitions, approver authorization, dedupe/idempotency, PR-payload generation.
- **Gateway integration**: run against versioned fixtures for coverage, snapshots, and aggregate queries; assert throttle/backoff on simulated 429.
- **Workflow/webhook**: authorized approval, non-approver denial, timeout/expiry, duplicate-webhook replay (`TaskDoesNotExist` no-op).

### End-to-end verification (DEV, before unattended runs)

1. Dry run creates exactly **one** review task and **no** PR.
2. An authorized approval opens exactly **one** content-only draft PR containing a verified known fact.
3. An unauthorized completion **cannot** publish.
4. A source change between draft and approval invalidates the pending approval (`stale`).
5. A duplicate Asana webhook is a harmless no-op.
6. After merge + deploy, the live hero **exactly** matches the frozen approved payload.
7. LangSmith traces, Chat SDK locking, and AgentCore Memory all verify in a real Asana DEV flow.

Do not declare the service done until steps 1–7 have actually run in DEV against a real Asana project and the website repo (or an explicitly approved sandbox).

### References

- `skills/apply-engineering-guidelines/rules/observability-pagerduty-alerting.md`
- `skills/apply-engineering-guidelines/rules/observability-dlq-alarms.md`
- `skills/build-batch-workflows/rules/principle-cost-gate.md`
- `skills/build-batch-workflows/rules/principle-failure-alerting.md`
