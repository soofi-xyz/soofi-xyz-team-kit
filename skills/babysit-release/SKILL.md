---
name: babysit-release
description: "Use every time the user creates a PR. Also use when the user asks to babysit a PR through merge and production release, watch PR comments and CI/CD until mergeable, monitor the release/prod deployment after merge, or open and babysit a follow-up fix PR for a failed production release."
---

# Babysit Release

Use this skill when the user wants production-safe PR babysitting that continues after merge.

## PR Readiness

Your job is to get this PR to a merge-ready state.

Check PR status, comments, and latest CI and resolve any issues until the PR is ready to merge.

1. Merge conflicts: Intelligently resolve any merge conflicts, preserving the intent and correctness of changes on your branch and the base branch. If intents conflict, abort the merge and ask for clarification.
2. Comments: Review active unresolved comments (including Bugbot) and resolve change requests / bug reports where valid. When fetching GitHub comments, filter out resolved threads first. Read only each comment body and the minimum location/URL needed to act on it; do not read the entire JSON output or other unnecessary payload data. Carefully validate issues reported by Bugbot and only take action on those that are valid; explain when you disagree or are unsure.
3. CI: Fix CI issues caused by changes within this PR's scope. Never change CI checks/workflows just to make failures pass, or make unrelated code changes; if that would be required, report back instead. For merge-blocking failures that seem unrelated to this PR, check whether the branch is behind the base branch and merge latest changes, since another PR may have fixed them. Push scoped fixes and re-watch CI until mergeable + green + comments triaged.

After the PR is merge-ready, continue with the release flow below.

## Release Flow

1. Verify the PR is mergeable:
   - No unresolved change requests or blocking review threads.
   - Required checks are green.
   - The branch is up to date with the base branch, or GitHub reports it can be merged.
2. Merge the PR using the repository's normal merge method.
3. Watch the release or production CI/CD pipeline triggered from the merge to `main`.
4. If the production release succeeds, report the merge and successful release.
5. If the production release fails, classify the failure before acting.

## Production Failure Policy

Treat production failures as high-risk. Do not guess, bypass, retry blindly, or change configuration just to unblock the pipeline.

### Code-Derived Failure

If logs and code context show the failure is caused by a fixable code issue:

1. Check out `main`.
2. Pull the latest `main`.
3. Create a new branch from `main` for the release fix.
4. Make the smallest safe fix.
5. Add focused tests or validation when possible.
6. Open a PR for the fix.
7. Apply this skill again to monitor that fix PR through merge and release.

### External Configuration Failure

If the failure depends on an environment variable, secret, cloud resource, permission, account setting, third-party service setting, manual approval, or any external configuration that cannot be derived from the current code and repository context:

1. Stop changing code.
2. Ask the user for the exact missing value, configuration decision, permission change, or manual action.
3. Include the failing workflow/job, the relevant log excerpt, and the specific value or action needed.
4. Resume only after the user provides the required information or confirms the external action is complete.

Do not invent placeholder values. Do not infer production configuration from development values unless the repository explicitly documents that mapping.

## Safe Operating Rules

- Never skip required checks, disable branch protection, bypass reviews, force-push to protected branches, or edit CI/CD workflows solely to make a failing release pass.
- Retry a failed production job only when the evidence points to a transient infrastructure or service issue. Record why the retry is safe.
- Keep all follow-up fixes scoped to restoring the release. Defer unrelated cleanup.
- If a rollback is available and the production state appears impacted, report the situation and ask the user before initiating rollback unless the user has already granted explicit rollback authority.
- Prefer GitHub CLI evidence for PR status, review threads, workflow runs, jobs, and logs. Summarize only the relevant failure lines to the user.

## Completion Report

Report:

- PR merged, release succeeded, or release blocked.
- Commit, PR, and workflow run links when available.
- Any user-provided production configuration or manual action still required.
