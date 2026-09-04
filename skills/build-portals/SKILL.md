---
name: build-portals
description: "Portal delivery and maintenance playbook for creating new repositories or incrementally changing existing portal frontend, backend, infrastructure, tests, and deployments through pull requests."
---

# Build Portals

Use this skill when Hoopa must create a portal repository or modify an existing
portal project. Resolve that intent before collecting mode-specific inputs.

Also load `skills/apply-engineering-guidelines/` on every run.

## Consumes

- `deliveryMode` — exactly one of `new_repository` or `existing_repository`
- `changeRequest` — summary, affected scopes, and acceptance criteria
- `designSource` — required only for `new_repository`; exactly one primary source among `figma`, `portal_url`, `other_design`, or `source_repo`
- `repositoryContext` — required for `existing_repository`; repository, base branch, feature branch, and optional current PR
- `deliveryContext` — org-supplied GitHub, AWS, Amplify, auth/API, test, and verification inputs

## Produces

- A schema-valid portal spec: committed in a new repository, or kept as a
  transient planning artifact for an existing repository unless requested
- A new repository or an incremental feature branch in the existing repository
- A pull request for review; never merge it without explicit approval
- Zero unresolved `openQuestions` before repository writes begin

Read `rules/01-intake-and-portal-spec.md` for intake, hard-stop fields, Figma MCP routing, and normalization rules. Validate JSON against `reference/portal-spec.schema.json`.

## Delivery-mode decision

At the start, determine or ask whether the user wants:

1. `new_repository` — create and scaffold a new portal, or
2. `existing_repository` — inspect the current project, increment its code, and
   open or update a pull request.

Do not default to new-repository creation. An explicit request to update the
current portal or manage its backend selects `existing_repository`. Backend-only
changes are supported and do not require design input.

## Primary design sources for new repositories

| `sourceType` | How to read it |
| --- | --- |
| `figma` | **Figma MCP**. Prefer section-level frames |
| `portal_url` | Fetch public pages; stop on gated auth without access |
| `other_design` | Screenshots, UX notes, inventories, exported frames |
| `source_repo` | Accessible repository the user points at |

Exported Figma screenshots are `other_design`, not `figma`. Do not fake Figma access.

## Required delivery context

Never invent these values. For `new_repository`, missing fields are hard stops:

- GitHub org, visibility, and repository name
- Confirmation to **create a new repo**
- AWS account and region, or permission to emit placeholders
- Amplify app to attach, or permission to configure Amplify preview hosting
- Auth model and API contract, or explicit copy-from-reference instruction
- `testPersonas` and `datasetRef` for live latency checks
- BrowserStack project credentials when full-flow verification is required and creds are absent

For `existing_repository`, require repository access, a concrete change request,
base/feature branch resolution, and permission to push and create a PR.
Deployment, dataset, Figma, Amplify, and BrowserStack inputs are required only
when the requested scope or acceptance criteria need them. Do not block a
backend-only code change on an unrelated design or browser gate.

Record unresolved items in `openQuestions`. Stop and ask the user. **Do not
scaffold or modify code** while `openQuestions` is non-empty.
For existing-project work, keep later deployment/verification credential gaps
out of `openQuestions` when local implementation can proceed; report them as
gate blockers before the external step.

## Nine-stage workflow

Run these stages in order. Do not advance past a failed or blocked stage.

1. **Intake.** Resolve `deliveryMode`, `changeRequest`, affected scopes, and mode-specific context.
2. **Normalize.** Validate the portal spec. Commit it in a new repo; keep it transient for existing-project work unless requested. Stop if `openQuestions` is non-empty.
3. **Prepare repository.** Create the approved new repo, or preserve the existing checkout and create an isolated feature branch/worktree.
4. **Plan or scaffold.** Scaffold the new portal, or inspect the existing architecture and plan the minimum necessary change.
5. **Frontend.** Implement only when frontend is in scope; use Figma/design tests when supplied or required.
6. **Backend.** Implement only when backend is in scope; follow the repository's existing API/IaC patterns before applying new-portal defaults.
7. **Integrate or deploy.** Wire and deploy only the requested surfaces and only with explicit environment authorization.
8. **Verify.** Run gates that apply to the changed scopes and the repository's required CI suite.
9. **Pull request and handoff.** Push the feature branch, open or update a PR, and return evidence plus blockers. Never merge without approval.

## Stop-before-scaffold rule

Stages 3 onward require a schema-valid `portal-spec.json` with `openQuestions: []`.

Hard stop and ask when:

- **Figma MCP cannot read** a Figma source required by the change
- A required reference portal needs sign-in and no access method was provided
- The delivery mode or change request is ambiguous
- New-repository destination or creation permission is missing
- Existing-repository access, base branch, feature branch, or PR permission is missing
- A required auth/API contract cannot be discovered in the existing repo and was not supplied or delegated to a named reference
- `datasetRef` is missing when latency verification applies
- BrowserStack credentials are missing when a browser flow applies
- Any step would place tenant secrets or customer data into generic kit files

On stop, list exact missing fields. Do not scaffold past the last successful stage.

## Specialist delegation

| Domain | Delegate to | Load |
| --- | --- | --- |
| Monorepo, Amplify frontend, Lambda/CDK scaffolding | `metagross` patterns | `skills/build-frontend-backends/` |
| Figma extraction and frontend adaptation | Figma MCP + `sylveon` patterns | `skills/figma-to-code/` |
| Responsive design tests | `smeargle` patterns | `skills/responsive-design-tests/` |
| Deterministic Lambda template | this skill | `rules/02-deterministic-lambda-template.md` |
| Existing-project incremental changes | this skill | `rules/06-existing-repository-changes.md` |
| Full-flow preview tests | generated repo Playwright BrowserStack configs | — |

Default backend style is HTTP API Gateway + Lambda. Use tRPC only when the user explicitly requests it.

## Portal spec fields

Required in every `portal-spec.json`:

- `deliveryMode`: `new_repository` | `existing_repository`
- `sourceType`: `figma` | `portal_url` | `other_design` | `source_repo`
- `changeRequest`: summary, affected scopes, acceptance criteria
- `repositoryContext`: required for existing-project changes

Required for new portals and included for existing-project changes only when
relevant:

- `screens[]`: route, purpose, required states when UI is in scope
- `breakpoints[]`: mobile, tablet, desktop widths for design tests
- `auth`: mode plus callback env keys
- `apis[]`: path, method, shapes, upstreams, latency budget
- `secrets[]`: name, purpose, discovered-or-placeholder status
- `infra`: memory, timeout, provisioned concurrency, log retention
- `testPersonas[]` and `datasetRef` when their gates apply
- `hosting`: required for new portals or hosting changes
- `openQuestions[]`: unresolved blockers (must be empty before scaffold)

## Credential rule

1. Discover approved secrets when they already exist in the environment or stores the user pointed at.
2. If missing, emit `SECRET_PLACEHOLDER_<NAME>` in CDK/env examples and a secrets checklist in the PR.
3. Never hardcode passwords, tokens, customer records, or live account identifiers into generic kit files.

## Related rules

- `rules/02-deterministic-lambda-template.md`
- `rules/03-repo-and-amplify-preview.md`
- `rules/04-verification-gates.md`
- `rules/05-sanitization.md`
- `rules/06-existing-repository-changes.md`
