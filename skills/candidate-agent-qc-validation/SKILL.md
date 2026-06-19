---
name: candidate-agent-qc-validation
description: "Evaluate hiring-candidate-built agents against a user story, acceptance criteria, requirements repo, candidate repo, required integrations, and user acceptance outcomes. Prompts for assignment-sent datetime, fetches last-commit timestamp via GitHub API, scores structure/runtime/agent-network usage, applies scalability discounts, computes weighted overall performance %, and recommends starting compensation capped at $250,000. Use for candidate agent QC, hiring assessment, or Asana tasks that ask to assess an agent against requirements. Not for designing new agents from scratch — use the appropriate agent-building skill for that."
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

Produce a concise, evidence-backed evaluation that supports a hiring decision. Default to the shortest useful answer: **verdict first**, then only the evidence needed to justify it.

The evaluation must show:

1. Sources reviewed and timing (assignment sent → last commit).
2. Setup/tests attempted.
3. Required integrations and whether they passed, failed, or were blocked.
4. **Every** user-story acceptance criterion with `Pass` / `Partial` / `Fail` / `Blocked` / `Not Applicable` and evidence.
5. Dimension scores for agent structure, runtime performance, and agent network usage.
6. Scalability compromises and applied discounts.
7. Weighted overall performance % and compensation recommendation (capped at $250,000).
8. Hiring-relevant strengths, weaknesses, and 2–4 follow-up questions.

## Inputs to Collect

Before evaluating, identify and record these inputs:

- **Assessment task**: task title, task URL or ID, assignee, due date, parent story, comments, and notes.
- **Assignment-sent datetime**: when the assignment was sent to the candidate (not tracked in Asana — **prompt the evaluator early**).
- **Candidate artifact**: repository URL, branch, commit SHA if available, documentation, deployment URL, demo, or packaged files.
- **Requirement source**: user story, acceptance criteria, requirements repository, README, product brief, tests, or linked issue.
- **Integration expectations**: APIs, OAuth providers, MCP servers, databases, external services, local environment variables, browser/session requirements, or scheduling hooks.
- **Expected user outcomes**: workflows a real user should be able to complete with the agent.
- **Constraints**: unavailable credentials, private services, time limits, missing instructions, or inaccessible systems.

If an input is missing, continue with available evidence and mark the affected checks as `Blocked` rather than inventing results.

## Evaluation Workflow

### Collect Timing Inputs

Do this **before** deep inspection so submission speed can be scored or marked blocked early.

1. **Prompt the evaluator** for the assignment-sent datetime (ISO 8601 preferred; timezone required). This is not in Asana. If the environment supports asking the user a question, use it. If the evaluator does not provide a start time, mark processing speed as `Blocked` and continue evaluating remaining criteria.
2. Parse the candidate repo URL into `{owner}/{repo}`.
3. **Fetch the last commit timestamp** on the default branch via the GitHub API:
   ```bash
   gh api repos/{owner}/{repo} --jq .default_branch
   gh api "repos/{owner}/{repo}/commits?per_page=1" --jq '.[0].commit.committer.date'
   ```
   Prefer `committer.date`; fall back to `author.date` if committer is missing.
4. If `gh` is unavailable, use unauthenticated `GET https://api.github.com/repos/{owner}/{repo}/commits?per_page=1` for public repos.
5. On 404, rate-limit, or auth-required private repos, mark processing speed as `Blocked`, record the reason, and continue other scoring.
6. When both timestamps are available, compute elapsed duration (human-readable + total hours) from assignment-sent to last-commit.

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

**Every** user-story acceptance criterion must appear in the output table with status and evidence. Do not merge or omit required criteria.

Each criterion receives one of these statuses:

- `Pass`: clear evidence shows the criterion is satisfied.
- `Partial`: some evidence supports the criterion but important gaps remain.
- `Fail`: evidence shows the criterion is not satisfied.
- `Blocked`: the criterion cannot be evaluated because required access, credentials, data, or environment capability is unavailable.
- `Not Applicable`: the criterion does not apply to the provided artifact or assessment task; explain why.

Never mark a criterion `Pass` solely because the repository claims support. Prefer demonstrated behavior over documentation claims.

### Score Agent Dimensions

Score each dimension 0–100 with one-line evidence. Use the `build-ai-agents` skill as the baseline for structure and network expectations.

**Agent structure (0–100)** — canonical repo layout, typed contracts, tests, setup docs, secrets handling, CDK/deploy path, error handling. High scores require alignment with the rules-agent layout in `build-ai-agents`.

**Runtime performance (0–100)** — Lambda-friendliness, observed latency/cost signals (runs, logs, benchmarks), reliability patterns (idempotency, retries, timeouts), observability (LangSmith/logging).

**Agent network usage (0–100)** — effective use of the soofi-xyz agent network:
- `@soofi-xyz/chat-adapter-asana` and `@soofi-xyz/chat-state-dynamodb` (or justified alternative),
- Vercel AI SDK `ToolLoopAgent` on Bedrock,
- LangSmith telemetry and AgentCore memory separation,
- delegation to appropriate plugin agents/skills vs reinventing platform capabilities,
- Pokémon naming and rules-agent patterns when applicable.

Compute `network_score` as the average of applicable sub-checks; exclude N/A sub-checks from the denominator.

Structure and runtime scores inform the hiring narrative but do **not** enter the weighted overall formula.

### Detect Scalability Compromises

Search code, tests, and run configs for shortcuts that reduce data volume or use sampling. Record each with file/command evidence and apply discounts to the overall score:

| Type | Examples | Discount |
|---|---|---|
| Minor | capped page size, fixture-only demo data, single-record smoke test | −3% each (max −9%) |
| Major | hard sampling that skips required workflows, mocked integrations presented as live, disabled batch paths to avoid load | −7% each (max −21%) |

### Calculate Overall Performance and Compensation

**Acceptance criteria score (0–100):**

- `Pass` → 100 points; `Partial` → 50; `Fail` → 0
- Exclude `Blocked` and `Not Applicable` from the denominator
- `criteria_score = round(100 * sum(points) / (100 * applicable_count))`

**Processing speed score (0–100 or Blocked):**

When timing is available, map elapsed hours to `speed_score`:

| Elapsed time | speed_score |
|---|---|
| ≤ 24 hours | 100 |
| 25–48 hours | 85 |
| 49–72 hours | 70 |
| 73–96 hours | 55 |
| 97–120 hours | 40 |
| > 120 hours | 25 |

Use requirement SLA when specified instead of these defaults.

**Weighted overall performance %:**

```
base = 0.50 * criteria_score + 0.30 * network_score + 0.20 * speed_score
# If speed Blocked: base = 0.625 * criteria_score + 0.375 * network_score
overall_performance_pct = max(0, round(base - scalability_discounts))
```

**Compensation recommendation** (capped at $250,000):

| overall_performance_pct | Recommended starting compensation |
|---|---|
| ≥ 90% | $250,000 (cap) |
| 85–89% | $225,000 |
| 80–84% | $200,000 |
| 75–79% | $175,000 |
| 70–74% | $150,000 |
| 60–69% | $125,000 |
| 50–59% | $100,000 |
| < 50% | Below band — no compensation recommendation; cite gaps |

## Output Format

Return a concise Markdown evaluation using exactly these top-level sections:

```markdown
# Candidate Agent QC Evaluation

## Verdict

## Timing

## Inputs Reviewed

## Acceptance Criteria Results

## Dimension Scores

## Scalability Notes

## Setup and Tests

## Risks and Blockers

## Hiring Signal
```

Target **40–120 lines**. Lead with the verdict. Do not exceed 120 lines unless the user explicitly asks for a detailed audit.

### Verdict Section

Include:

- overall result: `Pass`, `Partial Pass`, `Fail`, or `Inconclusive`;
- `overall_performance_pct`;
- recommended starting compensation (or "below band");
- one-sentence rationale tied to the biggest scoring driver;
- confidence level: `High`, `Medium`, or `Low`.

**Verdict mapping:**

- `Pass` → overall ≥ 80% and no critical criterion `Fail`
- `Partial Pass` → 60–79% or mixed criteria with recoverable gaps
- `Fail` → < 60% or critical workflow `Fail`
- `Inconclusive` → >40% of criteria `Blocked` or insufficient access

### Timing Section

Include assignment-sent datetime, last-commit timestamp (GitHub API source), elapsed duration, `speed_score` or `Blocked` with reason.

### Inputs Reviewed Section

List material sources with URLs and IDs: assessment task, candidate repo, requirements repo, key comments, commit SHA, timing inputs.

### Acceptance Criteria Results Section

Full table — **every** user-story criterion:

| Criterion | Status | Evidence | Notes |
|---|---|---|---|

Statuses: `Pass`, `Partial`, `Fail`, `Blocked`, or `Not Applicable`.

### Dimension Scores Section

| Dimension | Score | Evidence |
|---|---|---|
| Agent structure | 0–100 | one line |
| Runtime performance | 0–100 | one line |
| Agent network usage | 0–100 | one line |

Include `criteria_score` and `network_score` used in the weighted formula.

### Scalability Notes Section

List compromises found, discount per item, total discount applied.

### Setup and Tests Section

Summarize install/bootstrap, static checks, candidate tests, requirement-derived tests, integration/auth status. Include integration setup UX rating when evaluated.

### Risks and Blockers Section

Separate when both exist:

- **Candidate gaps**: issues caused by the submitted artifact.
- **Assessment blockers**: missing credentials, unclear requirements, inaccessible services, or time/environment limitations.

### Hiring Signal Section

- strengths demonstrated,
- weaknesses demonstrated,
- whether the candidate appears to understand the agent network and required integrations,
- **2–4** concrete follow-up questions or actions.

## Detailed Mode

Use a fuller audit format only when the user asks for a "detailed", "full", "audit", or "reproducible" report. In detailed mode, you may add separate sections for requirement summary, candidate artifact summary, human-assisted auth/setup UX, evidence log, and recommended follow-ups.

## Quality Bar

The final evaluation must be:

- **Evidence-backed**: each substantive claim should point to a file, command, URL, or observed behavior.
- **Fair**: distinguish candidate failures from blocked assessment conditions.
- **Reproducible**: include enough commands and context for another evaluator to repeat the checks without dumping raw logs.
- **Hiring-useful**: clearly state what the result says about the candidate's ability to build agents using the required network.
- **Concise**: lead with the verdict, avoid raw output unless it changes the decision, and prefer bullets over long narrative.

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

1. Prompt for assignment-sent datetime and attempt GitHub last-commit fetch.
2. Requirements extraction.
3. Candidate documentation and code structure review.
4. Dependency installation attempt.
5. Test command discovery and execution attempt.
6. Acceptance-criteria mapping (every criterion).
7. Dimension scoring, overall performance %, compensation recommendation.
8. Hiring decision support summary.

Do not stop with only a narrative review if executable checks are possible.
