---
name: build-portals
description: "Portal delivery playbook for intake, normalized portal specs, repo creation, Lambda scaffolding, Amplify preview, and verification gates."
---

# Build Portals

Use this skill when Hoopa (or another orchestrator) must turn one primary design source plus delivery context into a new portal repository with frontend, Lambda backend, Amplify preview, and verified quality gates.

Also load `skills/apply-engineering-guidelines/` on every run.

## Consumes

- `designSource` — exactly one primary source among `figma`, `portal_url`, `other_design`, or `source_repo`
- `deliveryContext` — org-supplied GitHub, AWS, Amplify, auth/API, test, and verification inputs

## Produces

- `portal-spec.md` and schema-valid `portal-spec.json` in the target repo
- Zero unresolved `openQuestions` before scaffolding begins

Read `rules/01-intake-and-portal-spec.md` for intake, hard-stop fields, Figma MCP routing, and normalization rules. Validate JSON against `reference/portal-spec.schema.json`.

## Primary design sources

| `sourceType` | How to read it |
| --- | --- |
| `figma` | **Figma MCP**. Prefer section-level frames |
| `portal_url` | Fetch public pages; stop on gated auth without access |
| `other_design` | Screenshots, UX notes, inventories, exported frames |
| `source_repo` | Accessible repository the user points at |

Exported Figma screenshots are `other_design`, not `figma`. Do not fake Figma access.

## Required delivery context

Never invent these values. Missing fields are hard stops:

- GitHub org, visibility, and repository name
- Confirmation to **create a new repo**
- AWS account and region, or permission to emit placeholders
- Amplify app to attach, or permission to configure Amplify preview hosting
- Auth model and API contract, or explicit copy-from-reference instruction
- `testPersonas` and `datasetRef` for live latency checks
- BrowserStack project credentials when full-flow verification is required and creds are absent

Record unresolved items in `openQuestions`. Stop and ask the user. **Do not scaffold** while `openQuestions` is non-empty.

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

Required in `portal-spec.json`:

- `sourceType`: `figma` | `portal_url` | `other_design` | `source_repo`
- `screens[]`: route, purpose, required states
- `breakpoints[]`: mobile, tablet, desktop widths for design tests
- `auth`: mode plus callback env keys
- `apis[]`: path, method, shapes, upstreams, latency budget
- `secrets[]`: name, purpose, discovered-or-placeholder status
- `infra`: memory, timeout, provisioned concurrency, log retention
- `testPersonas[]` and `datasetRef`
- `hosting`: Amplify preview; custom domain `out_of_scope_v1`
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
