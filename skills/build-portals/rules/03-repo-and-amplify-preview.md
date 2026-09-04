---
title: Repository Creation and Amplify Preview
impact: CRITICAL
tags: github, repository, amplify, preview, turborepo
---

# Repository Workflow and Amplify Preview

Prepare either a new repository or an existing-project feature branch only
after `portal-spec.json` is schema-valid and contains `openQuestions: []`.
Never infer a destination.

## Preflight

Run the GitHub access checks before repository writes:

```bash
gh auth status
gh repo view "$TARGET_REPOSITORY"
```

Run AWS checks only when deployment is in scope:

```bash
AWS_PROFILE="$SELECTED_AWS_PROFILE" aws sts get-caller-identity
AWS_PROFILE="$SELECTED_AWS_PROFILE" aws configure get region
```

Confirm the AWS account and region match the portal spec when applicable.

For `existing_repository`, inspect the selected project and follow
`rules/06-existing-repository-changes.md`. Do not run `gh repo create`, replace
its workspace layout, or add Amplify/CDK unless the change request requires it.

For `new_repository`, if the destination already exists, stop and ask whether
the user intended `existing_repository`; do not overwrite, delete, or silently
choose another name.

## Create the repository and branch

In `new_repository` mode, after preflight and explicit confirmation:

```bash
gh repo create "$GITHUB_ORG/$REPOSITORY_NAME" \
  --"$REPOSITORY_VISIBILITY" \
  --description "$USER_SUPPLIED_DESCRIPTION" \
  --clone
cd "$REPOSITORY_NAME"
git switch -c feat/portal-v1
```

Use `private`, `internal`, or `public` only when that exact visibility is in
the portal spec. Do not add organization-specific defaults to this skill.

## Scaffold

Generate this minimum Turborepo layout on `feat/portal-v1`:

The required workspaces are `apps/web`, `apps/api`, and `packages/shared`.

```text
apps/
  web/                  # frontend application
  api/                  # Lambda handler and API tests
    cdk/                # PortalApiStack and deployment entry point
packages/
  shared/               # API contracts and shared types
amplify.yml             # frontend preview build configuration
package.json
pnpm-workspace.yaml
turbo.json
```

Copy the normalized `portal-spec.md` and `portal-spec.json` into the new
repository. Copy the deterministic Lambda reference into `apps/api/cdk` and
replace placeholders only from the portal spec.

Commit the scaffold to the feature branch and push it:

```bash
git add .
git commit -m "feat: scaffold portal frontend and API"
git push --set-upstream origin feat/portal-v1
```

## Amplify preview

Apply this section only to new portals or existing-project changes whose scope
includes hosting or deployment.

Use the operator's selected AWS profile and the Amplify app named or approved
in the portal spec. If no app exists, create it only when the spec explicitly
authorizes Amplify provisioning. Connect `feat/portal-v1` as a preview branch
and use the repository's `amplify.yml`.

Set the frontend runtime API variable, such as `NEXT_PUBLIC_API_URL`, to the
deployed **feature-branch API** URL. Preview verification must reject a
production API URL, a localhost URL, or a mock endpoint. Record the feature API
deployment output before starting the frontend build.

Read the preview URL from the Amplify deployment output or branch/job response.
Never construct a preview URL from an embedded Amplify app ID, customer domain,
or guessed branch hostname. Store the returned preview URL in handoff evidence,
not in this generic skill.

## Required order

1. Deploy `apps/api/cdk` into the approved feature environment.
2. Capture its API URL from CloudFormation deployment output.
3. Configure the Amplify preview branch with that API URL.
4. Start the Amplify build from `feat/portal-v1`.
5. Read the preview URL from deployment output.
6. Run integration and BrowserStack flows against that preview URL.

Stop if the API deployment fails or if the preview resolves to any API other
than the recorded feature environment.

## Version-one boundary

A custom domain, DNS records, certificates, and production cutover are out of scope
for version one. Deliver only the Amplify preview URL. Custom domain work requires
a separate approved story after preview acceptance.
