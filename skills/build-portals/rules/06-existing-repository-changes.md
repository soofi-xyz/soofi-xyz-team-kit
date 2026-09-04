---
title: Existing Repository Changes
impact: CRITICAL
tags: repository, backend, feature-branch, pull-request, incremental
---

# Existing Repository Changes

Use this rule when `deliveryMode` is `existing_repository`. Modify the current
project incrementally; do not scaffold a replacement repository or force the
new-portal architecture onto established code.

## 1. Resolve and inspect the repository

Confirm the repository path or URL, base branch, requested change, affected
scopes, and acceptance criteria. Then inspect before planning:

```bash
git status --short --branch
git remote -v
git branch --show-current
git log -5 --oneline
```

Read the repository's `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, package
scripts, API handlers, infrastructure, tests, CI, and deployment conventions.
Follow the existing architecture unless the change explicitly requires a
reviewed migration. Do not replace an established backend framework merely
because Hoopa's new-portal default is Lambda plus HTTP API Gateway.

## 2. Preserve user changes

Preserve user changes exactly. Never run `git reset --hard`, `git clean`,
`git checkout --`, or silently stash another person's work.

If the checkout is dirty or another task is active, create an isolated worktree
from the approved base branch:

```bash
git fetch origin "$BASE_BRANCH"
git worktree add "$WORKTREE_PATH" -b "$FEATURE_BRANCH" "origin/$BASE_BRANCH"
```

Before using `-b`, check whether the feature branch or named PR already exists.
If it does, create the worktree from that existing branch/PR head; never
recreate, overwrite, or reset it.

If the requested change intentionally depends on uncommitted work, stop and ask
how it should be included. Do not copy unrelated changes into the feature
branch. If the checkout is clean and dedicated to this task, create or switch
to the approved feature branch normally.

Record the resolved repository, base branch, and feature branch in
`repositoryContext`. Keep the normalized spec as a transient planning artifact
unless the repository already tracks change specs or the user requests it.
Never commit Hoopa metadata merely to operate on a project. Never commit
directly to the default branch.

## 3. Plan the minimum change

Trace the existing request path, tests, infrastructure, and deployment surface.
Implement the minimum necessary change that satisfies the supplied acceptance
criteria. Reuse existing modules and patterns; avoid adjacent refactors unless
they are required for correctness.

For backend management:

- authenticate and authorize every new externally reachable mutation
- validate request inputs and preserve existing error contracts
- scope IAM and secret access to the resources the change actually needs
- update API contracts and generated clients together
- add structured logs, metrics, and alarms only where the repository's
  observability pattern or the requested behavior requires them
- keep production values out of code and test fixtures

## 4. Test before and after implementation

Write or update the narrowest test that proves the requested behavior. Confirm
it fails for the missing behavior when practical, implement the change, then
run targeted tests and the repository's own lint, typecheck, test, and build
gates. Add infrastructure synthesis or diff checks when IaC changes.

Do not require Figma, responsive design tests, BrowserStack, Amplify, a latency
dataset, or a full portal scaffold for backend-only work unless the change or
its acceptance criteria actually touch those surfaces.

## 5. Commit and open the pull request

Review the diff for unrelated files and secret material, then create coherent
commits on the feature branch:

```bash
git diff --check
git status --short
git push --set-upstream origin "$FEATURE_BRANCH"
gh pr create \
  --base "$BASE_BRANCH" \
  --head "$FEATURE_BRANCH" \
  --title "$PR_TITLE" \
  --body "$PR_BODY"
```

The pull-request body must describe the requested behavior, implementation,
tests, deployment impact, unresolved placeholders, and evidence. Link the PR in
the handoff.

If `repositoryContext.pullRequestUrl` names an active PR, update an existing PR
on its head branch instead of opening a duplicate, but only after confirming
that its scope matches the request.

Never merge, close, or deploy the pull request without explicit authorization.
Repository write permission authorizes branch and PR delivery, not production
mutation.

## Stop rules

Stop before code changes when:

- the repository or approved base branch cannot be resolved
- the requested behavior or acceptance criteria are ambiguous
- existing user changes overlap the requested files and inclusion is unclear
- branch pushes or pull-request creation were not authorized

List only blockers relevant to the requested scope. A missing UI design is not
a backend-change blocker, and missing deployment access does not prevent a
code-only PR when deployment was not requested.

If secrets, datasets, or credentials are missing only for a requested live
deployment or verification step, continue the safe local implementation and PR.
Report that gate as blocked and stop immediately before the external action.
