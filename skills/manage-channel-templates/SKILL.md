---
name: manage-channel-templates
description: "Manage channel templates in Git-backed inventories, including template CRUD, metadata normalization, active/inactive state, family/variant structure, and one-time or recurring synchronization from operational stores into GitHub. Use when building or refactoring template-management agents, template repositories, template sync jobs, or channel template workflows for SMS or email."
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