# Delivery Phase

Run this phase only when the user wants implementation work delivered, not when they only want analysis or design.

## Repo Strategy

Treat delivery as potentially multi-repo:

- `lexicon` for canonical names and schema
- pipeline repo for ingestion and emission
- `main-dashboard` for shared dashboard rendering
- `skills` for workflow guidance updates

Do not assume one repo contains the whole change.

## Branch Strategy

Per target repo:

1. verify the git root and current branch
2. create a feature branch such as `metrics/<vendor>-<metric-family>`
3. keep unrelated repos or worktrees untouched

## Commit Strategy

- Group commits by repo and by logical phase.
- Keep lexicon, pipeline, dashboard, and skills changes understandable in isolation.
- Do not create one giant cross-repo commit when separate repos are involved.

## Validation Commands

Run the repo-native validation commands before pushing:

### `lexicon`

- follow the checks in `lexicon/README.md`
- include targeted tests for any schema changes

### `livevox-metrics-pipeline`

- `just format`
- `just lint`
- `just type-check`
- `just test`
- `just build` when infrastructure changes

### `main-dashboard`

- `just format`
- `just lint`
- `just type-check`
- `just test`
- `just build`

### `skills`

- proofread changed skill files
- ensure every linked rule or reference file exists
- keep `SKILL.md` concise and one level deep

## GitHub Workflow

When delivery includes remote updates:

- use `gh` for PR creation, PR status, workflow checks, and failing-run inspection
- keep branch, commit, push, and PR updates isolated per repo
- if the remote uses SSH but authentication is available through `gh`, prefer HTTPS push with `gh auth token` instead of changing git config

## CI Remediation Loop

When a PR check fails:

1. confirm the failing run is for the current PR head, not a stale commit
2. inspect the exact failing step and log before changing code
3. run the same failing command locally when possible
4. apply the smallest fix that resolves the current-head failure
5. rerun the focused local validation that matches the failure
6. amend or update the PR only when the user requested that delivery mode
7. if the failure is stale and the current head already contains the fix, rerun the workflow instead of editing code again

## PR Requirements

Each PR summary should explain:

- lexicon decision
- source contract and pipeline lane
- dashboard impact
- validation run
- any approved temporary mismatch or unresolved follow-up

## Stop Conditions

Stop and ask when:

- the requested delivery scope is analysis-only
- a repo is not a git repo
- multiple repos need PRs but the user expects a single-repo change
- validation fails and the next action is not obvious
- a failing CI check has not been traced to an exact current-head log and command
