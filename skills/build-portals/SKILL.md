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

- `portal-spec.md` and schema-valid `portal-spec.json` in the target repository
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

## Nine-stage workflow

Run these stages in order. Do not advance past a failed or blocked stage.

1. **Intake.** Collect `designSource` and `deliveryContext`. Stop on missing required fields, gated Figma access, or inaccessible reference portals.
2. **Normalize.** Write `portal-spec.md` and `portal-spec.json`. Stop if `openQuestions` is non-empty — ask the user first.
3. **Create repo.** Create the GitHub repository with user-supplied org/name/visibility. Add feature branch `feat/portal-v1`.
4. **Scaffold.** Turborepo layout, frontend app, API app, CDK stack skeleton, env examples with placeholders.
5. **Frontend.** Figma MCP + `figma-to-code` patterns, or copy structure from the provided URL/repo. Match spec breakpoints.
6. **Backend.** Implement spec APIs on Lambda. Wire discovered secrets or placeholders. Attach the user-provided dataset in the feature environment.
7. **Integrate.** Point the frontend at the feature-branch API base URL. Deploy Amplify preview and the feature-environment CDK stack.
8. **Verify.** Run verification gates against preview and live feature-branch backend. Use `responsive-design-tests` patterns for breakpoint checks.
9. **Handoff.** Return repo URL, feature branch, Amplify preview URL, coverage summary, BrowserStack result, latency evidence, and secrets checklist.

## Stop-before-scaffold rule

Stages 3 onward require a schema-valid `portal-spec.json` with `openQuestions: []`.

Hard stop and ask when:

- **Figma MCP cannot read** the file
- A reference portal requires sign-in and no access method was provided
- GitHub org, repository name, or permission to create a repo is missing
- Auth model or API contract is missing and the user did not instruct copy-from-reference
- `datasetRef` for the latency check is missing
- BrowserStack credentials are missing when full-flow verification is required
- Any step would place tenant secrets or customer data into generic kit files

On stop, list exact missing fields. Do not scaffold past the last successful stage.

## Specialist delegation

| Domain | Delegate to | Load |
| --- | --- | --- |
| Monorepo, Amplify frontend, Lambda/CDK scaffolding | `metagross` patterns | `skills/build-frontend-backends/` |
| Figma extraction and frontend adaptation | Figma MCP + `sylveon` patterns | `skills/figma-to-code/` |
| Responsive design tests | `smeargle` patterns | `skills/responsive-design-tests/` |
| Deterministic Lambda template | this skill | `rules/02-deterministic-lambda-template.md` |
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

## Related rules (later tasks)

- `rules/deterministic-lambda-template.md`
- `rules/repo-and-amplify-preview.md`
- `rules/verification-gates.md`
- `rules/sanitization.md`
