---
name: manage-channel-templates
description: "Managing message templates for SMS and email — creating, updating, organizing, and synchronizing template inventories from operational stores."
---

# Manage Channel Templates

Use this skill for template systems and template inventory workflows. Do not use it for audience selection, scheduling, or provider delivery.

## Core Responsibilities

`Jigglypuff` owns:

- template CRUD
- template metadata and schema normalization
- active/inactive state
- family/variant organization
- Git-backed template source of truth
- one-time or recurring sync from an operational template source into Git

## Default Pattern

Prefer this split:

1. operational systems may author or store templates
2. GitHub becomes the reviewed source of truth for runtime consumption
3. sync jobs normalize operational data into the Git contract
4. runtime systems read the reviewed Git contract instead of querying the source system ad hoc

## Single Source Of Truth At Runtime — No Fallbacks

Once a Git template repo is declared the source of truth for a channel, runtime systems MUST read templates from that repo and only that repo. Specifically:

- Do **not** ship a baked-in template snapshot inside the runtime artifact (no bundled JSON inside the Lambda zip, the Glue job zip, the Spark egg, or the application image) and do **not** fall back to it when the Git fetch fails.
- Do **not** fall back to the operational source system (Postgres, Snowflake, vendor API, file share) at runtime. The sync job is the one and only writer; the runtime is a reader.
- Do **not** fall back to a previously cached copy on disk, in S3, or in a SSM/Secrets payload. A stale template silently rendered is worse than a loud failure.
- If the Git source is unreachable, the runtime MUST fail loudly (exception, alarm, page) so the issue is visible and operators can fix the Git access path.
- A `LocalTemplateRepository`-style class is acceptable strictly as a test/dev escape hatch, gated behind an explicit caller-supplied path. It MUST NOT be reachable from the production code path without that explicit override, and the production deploy MUST NOT pass that override.

### Anti-Pattern: The Bundled Snapshot Mistake

A previous SMS solver build wired its Glue job as `FallbackTemplateRepository(GitHubTemplateRepository, BundledTemplateRepository)`, where `BundledTemplateRepository` was a directory of JSON files baked into the Glue job's Python package. If GitHub auth failed or rate-limited, the solver silently rendered SMS using the baked-in copy — which had a fixed, stale subset of templates and was last updated whenever the artifact was last redeployed. The operator-visible behavior was "it works"; the consumer-visible behavior was "wrong template body, wrong family mix, no new templates ever." The fix was to delete the bundled snapshot directory entirely, remove the `BundledTemplateRepository` and `FallbackTemplateRepository` classes from the codebase, and let GitHub fetch failures surface as solver job failures. Treat any future "fallback to a bundled / cached / mirrored copy at runtime" proposal as the same anti-pattern.

## Template Contract Rules

Define and document:

- required template identifier
- family and variant fields
- language and channel fields
- active/inactive state
- render variables
- compliance text or required disclosures
- versioning or review metadata

Keep the runtime-facing template contract stable even if the source system has extra fields.

## Sync Workflow

When a source system must be synchronized into Git:

1. define the source query and ownership boundary
2. filter to the records that should exist in Git
3. normalize records into the Git contract
4. drop source-only fields that the runtime should not depend on
5. write deterministic files
6. open a PR instead of mutating `main` directly

## Channel-Specific Configuration Lives In The Prompt

Jigglypuff is channel- and store-agnostic. Anything specific to a single
channel instance — the operational source (Postgres, Snowflake, vendor API,
file), real column names, derived fields, family/variant rules, runtime
contract shape, target GitHub repo — must live in the per-instance golden
prompt, not in this skill.

When building a new template inventory (e.g. SMS, email, push), the prompt
specifies:

- the operational source and its connection contract
- the real source columns and types
- which records to keep
- which derived/synthetic fields to compute (and how)
- the runtime JSON contract written to GitHub
- the target GitHub repo and branch convention

This skill only governs the reusable how-to: CRUD, normalization, source-only
field stripping, deterministic output, and PR-based review.

## Runtime Hand-off

Expose a runtime-friendly inventory that downstream systems can trust:

- one normalized file shape
- explicit variable list
- explicit active state
- explicit family/variant semantics
- no hidden dependence on operational-only columns

## Email Templates From Figma

When a requester provides a Figma design for an email body, use the Cursor
workflow in [figma-to-email-template](../figma-to-email-template/SKILL.md):

1. Read the email frame through the Figma MCP in the user's Cursor. Figma only
   serves approved MCP clients, so no Jigglypuff, Console or local process reads
   Figma directly.
2. Call Jigglypuff's hosted MCP server, signed in with company single sign-on,
   for image export and hosting, validation, previews, the template pull
   request, certification, Spanish translation and the approval request. The
   server enforces the same gates as the Asana path. Its contract is in
   [jigglypuff-mcp-contract.md](../figma-to-email-template/reference/jigglypuff-mcp-contract.md).
3. Keep approval and merge in Asana. Jigglypuff creates and owns the PR, so no
   adoption is needed.

Until the Jigglypuff MCP server is deployed, open the PR from Cursor and ask
Jigglypuff in the Asana story to take it over, as the skill's interim path
describes.

Console's authoring job API with `output: email-html` remains the future fully
automated path once Figma approves Console's MCP client. When it exists, send
the Figma node, declared variables, template language and, for an edit, the
current HTML with its `content_sha256`; reject a result that drops or adds a
variable; then continue through the same pull request, certification and
approval flow. Console does not commit, approve or send. Both paths follow the
[Console email HTML target](../build-console-product/reference/component-authoring.md#email-html-target).

## Boundaries

`Jigglypuff` does not own:

- who receives a communication
- when a communication is sent
- provider routing and send execution
- delivery feedback loops

Those belong to audience, runtime, or communication-activity skills.

## Checklist

Before considering the template capability ready, confirm:

- the Git template contract is documented
- template CRUD path is defined
- sync behavior is defined if an operational source exists
- normalized output is deterministic
- source-only fields are not leaked into the runtime contract
- template review happens through PRs or an equivalent auditable flow
- runtime consumers can read templates without reaching back into the source system