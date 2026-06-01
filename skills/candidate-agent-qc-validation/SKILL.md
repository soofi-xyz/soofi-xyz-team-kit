---
name: candidate-agent-qc-validation
description: "Evaluate hiring-candidate-built agents against a user story, acceptance criteria, requirements repo, candidate repo, required integrations, integration tests, and user acceptance outcomes. Use for candidate agent QC, hiring assessment, agent-building validation, or Asana tasks that ask to assess an agent against requirements. Produces an evidence-backed verdict, integration setup UX rating, and hiring decision support. Not for designing new agents from scratch — use the appropriate agent-building skill for that."
---

# Candidate Agent QC Validation

## When to Use This Skill

Use this skill when the user asks you to evaluate a hiring candidate's agent or code submission against a defined user story, acceptance criteria, requirements repository, integration expectations, or user acceptance outcomes.

This skill is especially appropriate for tasks like:

- "Assess the candidate's agent against the requirements"
- "Validate a candidate-built agent"
- "Run QC on an agent-building hiring exercise"
- "Compare a submitted agent repo with a requirements repo"
- "Produce pass/fail evidence for hiring decisions"

## Core Outcome

Produce an evidence-backed candidate evaluation that supports a hiring decision. The evaluation must show:

1. What requirement sources were reviewed.
2. What candidate artifacts were reviewed.
3. What environment setup was attempted.
4. What integrations were required and whether they were configured, simulated, or blocked.
5. What human-assisted authentication or setup steps were requested from the tester.
6. How easy or difficult it was for the tester to connect required integrations.
7. What integration tests and user acceptance checks were executed.
8. Which acceptance criteria passed, failed, or were blocked.
9. What concrete evidence supports each result.
10. What risks, gaps, and follow-up questions remain.

## Inputs to Collect

Before evaluating, identify and record these inputs:

- **Assessment task**: task title, task URL or ID, assignee, due date, parent story, comments, and notes.
- **Candidate artifact**: repository URL, branch, commit SHA if available, documentation, deployment URL, demo, or packaged files.
- **Requirement source**: user story, acceptance criteria, requirements repository, README, product brief, tests, or linked issue.
- **Integration expectations**: APIs, OAuth providers, MCP servers, databases, external services, local environment variables, browser/session requirements, or scheduling hooks.
- **Expected user outcomes**: workflows a real user should be able to complete with the agent.
- **Constraints**: unavailable credentials, private services, time limits, missing instructions, or inaccessible systems.

If an input is missing, continue with available evidence and mark the affected checks as `Blocked` rather than inventing results.

## Evaluation Workflow

### Read the Work Item

1. Read the task title, description, comments/activity, parent task if relevant, and linked resources.
2. Extract the candidate artifact link and requirements link.
3. Restate the assignment in one concise sentence.
4. Build a checklist from explicit acceptance criteria and implied requirements.
5. Preserve exact source URLs in the output.

### Inspect Requirement Sources

1. Review the requirements repository or specification before judging the candidate repo.
2. Extract:
   - product purpose,
   - required user workflows,
   - required tools or integrations,
   - expected setup commands,
   - environment variables,
   - test commands,
   - acceptance criteria,
   - non-functional requirements such as reliability, security, observability, or usability.
3. Convert requirements into testable criteria. Keep each criterion observable.

### Inspect Candidate Artifact

1. Review the candidate repository or artifact for:
   - architecture and main entry points,
   - setup documentation,
   - dependency declarations,
   - configuration and secrets handling,
   - integration implementations,
   - tests and fixtures,
   - error handling and logging,
   - alignment with the required user workflows.
2. Record file paths, commands, and outputs that support findings.
3. Do not give credit for undocumented or unimplemented behavior unless it is demonstrated by code, tests, or a successful run.

### Stand Up the Product Environment

Attempt the lowest-risk setup path first:

1. Install dependencies using the documented package manager.
2. Copy or create safe local example configuration only when documentation supports it.
3. Do not request or expose secrets. If credentials are required and unavailable, mark the relevant integration checks as `Blocked`.
4. Prefer local dry-run, mocked, sandbox, or fixture-based execution when real external services are unavailable.
5. Capture the exact commands run and the observed outcome.

### Configure Required Integrations

For every required integration:

1. Identify its purpose in the product workflow.
2. Determine whether it is implemented in the candidate artifact.
3. Determine whether it can be configured in the current environment.
4. If it cannot be configured, explain what credential, service, account, or environment dependency is missing.
5. If a mock or dry-run path exists, use it and label the result as simulated.

### Request Human-Assisted Authentication When Needed

If task completion requires live integrations and those integrations need OAuth, API keys, device login, local browser sessions, MCP connector auth, cloud credentials, or other tester-controlled access, do not immediately mark the check as blocked. First prepare a safe human-assisted auth request for the tester.

The request must include:

1. The integration name and why it is required for the user story.
2. The exact action the tester should perform, such as running a setup wizard, opening an OAuth URL, setting an environment variable, connecting an MCP connector, or confirming access in a browser.
3. The minimum permission scopes needed, if known.
4. Test data needed, such as a sandbox calendar event, email thread, Asana task, or Telegram chat.
5. A clear warning not to paste secrets into chat or logs.
6. The command or UI action to run after authentication is complete.
7. What evidence the tester should report back, such as "validate passed", "connected account shown", or a screenshot-free textual observation.

If the execution environment supports asking the user a question, ask the tester to complete the auth/setup step and wait for confirmation before running live E2E. If the environment cannot interrupt for tester action, output the human-assisted auth request in the evaluation and mark the live check as `Blocked - waiting for tester auth`.

Never ask the tester to share secrets directly. Ask them to configure secrets locally, in the approved credential store, or through the product's setup flow.

### Evaluate Integration Setup UX

When a tester performs authentication or setup, evaluate the integration UX as part of QC. Capture:

- **Discoverability**: whether setup instructions are easy to find.
- **Clarity**: whether required accounts, scopes, env vars, and commands are clear.
- **Friction**: number of manual steps, unclear redirects, confusing CLI prompts, or repeated auth.
- **Error handling**: quality of validation errors, missing credential messages, and recovery instructions.
- **Security posture**: whether secrets are requested safely and not printed.
- **Completion confidence**: whether the tester can tell the integration is connected.
- **Time-to-connect**: approximate elapsed time when the tester reports it.

Use these statuses for setup UX:

- `Excellent`: tester can connect quickly with clear guidance and safe handling.
- `Good`: minor friction, but setup is understandable and recoverable.
- `Fair`: setup works but has confusing or brittle steps.
- `Poor`: setup is hard to complete, unsafe, or lacks actionable errors.
- `Blocked`: tester cannot evaluate because credentials, account access, or environment capabilities are unavailable.

### Execute Tests

Run checks in this order when feasible:

1. Static checks: dependency installation, linting, type checks, schema validation, security-sensitive config review.
2. Candidate-provided tests: unit tests, integration tests, end-to-end tests, smoke tests.
3. Requirement-derived tests: workflows or commands inferred from the requirements source.
4. Manual user acceptance checks: simulate the expected user journey and record whether the output satisfies the user outcome.

For each command or manual check, record:

- command or action,
- expected result,
- actual result,
- pass/fail/blocked status,
- supporting evidence.

### Map Results to Acceptance Criteria

Every acceptance criterion must receive one of these statuses:

- `Pass`: clear evidence shows the criterion is satisfied.
- `Partial`: some evidence supports the criterion but important gaps remain.
- `Fail`: evidence shows the criterion is not satisfied.
- `Blocked`: the criterion cannot be evaluated because required access, credentials, data, or environment capability is unavailable.
- `Not Applicable`: the criterion does not apply to the provided artifact or assessment task; explain why.

Never mark a criterion `Pass` solely because the repository claims support. Prefer demonstrated behavior over documentation claims.

## Output Format

Return the evaluation in Markdown using exactly these top-level sections:

```markdown
# Candidate Agent QC Evaluation

## Verdict

## Inputs Reviewed

## Requirement Summary

## Candidate Artifact Summary

## Environment and Integration Setup

## Human-Assisted Auth and Setup UX

## Tests and Checks Executed

## Acceptance Criteria Results

## Evidence Log

## Risks and Blockers

## Hiring Decision Support

## Recommended Follow-Ups
```

### Verdict Section

Include:

- overall result: `Pass`, `Partial Pass`, `Fail`, or `Inconclusive`;
- one-sentence rationale;
- confidence level: `High`, `Medium`, or `Low`;
- the biggest reason for the verdict.

Use `Inconclusive` when critical integrations or requirements are blocked and there is not enough evidence to judge fairly.

### Inputs Reviewed Section

List all sources with URLs and IDs where available:

- assessment task,
- parent story,
- candidate repo or artifact,
- requirements repo or specification,
- comments or notes reviewed,
- local commands or generated evidence files.

### Requirement Summary Section

Summarize the expected product behavior and convert requirements into a concise checklist. Keep this section factual and evidence-based.

### Candidate Artifact Summary Section

Summarize what the candidate built, the apparent architecture, and how it maps to the requested agent. Mention important missing pieces.

### Environment and Integration Setup Section

Use a table with columns:

| Area | Required? | Attempted Setup | Result | Evidence |
|---|---:|---|---|---|

### Human-Assisted Auth and Setup UX Section

Use this section when any live integration is required or when setup ease is part of the assessment. If no live integrations are required, state `No human-assisted auth required`.

First include a table with columns:

| Integration | Human Tester Action Requested | Required for Task? | Result | UX Rating | Evidence |
|---|---|---:|---|---|---|

Then include a short `Tester UX Notes` subsection covering discoverability, clarity, friction, error handling, security posture, completion confidence, and time-to-connect when known.

If tester action could not be requested or completed during the run, include the exact request that should be sent to the tester and mark the related live checks as `Blocked - waiting for tester auth`.

### Tests and Checks Executed Section

Use a table with columns:

| Check | Type | Expected | Actual | Status |
|---|---|---|---|---|

### Acceptance Criteria Results Section

Use a table with columns:

| Criterion | Status | Evidence | Notes |
|---|---|---|---|

### Evidence Log Section

Include command outputs, file paths, commit SHAs, inspected docs, and observations. Keep logs concise but sufficient for another reviewer to reproduce the assessment.

### Risks and Blockers Section

Separate:

- **Candidate gaps**: issues caused by the submitted artifact.
- **Assessment blockers**: missing credentials, unclear requirements, inaccessible services, or time/environment limitations.
- **Process risks**: gaps that could make the hiring signal unreliable.

### Hiring Decision Support Section

Provide a hiring-oriented summary without overclaiming. Include:

- strengths demonstrated,
- weaknesses demonstrated,
- suggested interview follow-up questions,
- whether the candidate appears to understand the agent network and required integrations based on available evidence.

### Recommended Follow-Ups Section

List concrete next actions, such as:

- ask candidate for missing setup instructions,
- request a demo,
- provide sandbox credentials,
- run a specific integration test,
- clarify ambiguous acceptance criteria,
- create an issue for a discovered defect.

## Quality Bar

The final evaluation must be:

- **Evidence-backed**: each substantive claim should point to a file, command, URL, or observed behavior.
- **Fair**: distinguish candidate failures from blocked assessment conditions.
- **Reproducible**: include enough commands and context for another evaluator to repeat the checks.
- **Hiring-useful**: clearly state what the result says about the candidate's ability to build agents using the required network.
- **Concise**: prefer direct findings over long narrative.

## Safety and Confidentiality

- Do not print secrets, tokens, cookies, private credentials, or personal data beyond what is already necessary in the assessment task.
- Do not send messages, update tasks, delete resources, create public posts, or change repositories unless the user explicitly requests that action and confirms it when required.
- Do not make purchases or call production integrations that could create real-world side effects.
- Use mocks, dry-runs, or read-only API calls when possible.

## Handling Incomplete Access

If credentials, private repos, external accounts, MCP servers, or production systems are unavailable:

1. Continue all checks that can be completed locally or from public sources.
2. Mark affected criteria as `Blocked`.
3. Explain exactly what is needed to unblock the check.
4. Avoid downgrading the candidate for assessment-infrastructure blockers unless the candidate failed to document required setup.

## Minimal Evaluation Path

If time or tooling is limited, complete at least:

1. Requirements extraction.
2. Candidate documentation review.
3. Candidate code structure review.
4. Dependency installation attempt.
5. Test command discovery and execution attempt.
6. Acceptance-criteria mapping.
7. Hiring decision support summary.

Do not stop with only a narrative review if executable checks are possible.
