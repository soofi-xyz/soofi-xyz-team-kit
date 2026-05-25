---
name: build-chief-of-staff-runtime
description: "Guides construction of the deployed Chief of Staff backend in a target application repo. Covers the AWS runtime boundary, Connect/Persist dependency gates, runtime contract rules, auth by plane, file-structure output, and verification expectations. Use when chief-of-staff is asked to design, scaffold, review, or refine the backend/runtime implementation."
---

# Build Chief of Staff Runtime

Use this skill when `chief-of-staff` is asked to build or review the deployed backend.

The backend is a separate implementation target. Do not build it in this plugin repo.

## Required loading order

1. Load `../build-chief-of-staff-system/` first for the product boundary.
2. Then load this skill for target-repo backend construction.

## Workflow

1. Read these rules first:
   - `rules/01-runtime-architecture-and-boundaries.md`
   - `rules/02-runtime-contract-and-policies.md`
   - `rules/03-platform-dependency-gates.md`
   - `rules/04-auth-and-operator-setup.md`
2. Read these references before emitting a target-repo plan:
   - `reference/runtime-file-structure.md`
   - `reference/runtime-validation-checklist.md`
3. Confirm the target repo or target workspace where backend code should live.
4. Keep final synthesis and draft generation in Cursor for v1.
5. Keep backend ownership limited to retrieval, auth/linking, sync, scope/session, provenance, and source health.
6. Treat Connect and Persist as hard platform dependencies.
7. Emit an exact target-repo file structure, concrete tasks, concrete tests, CDK resources, and operator setup steps.
8. Refuse fallback OAuth planes, fallback graph stores, or backend-authored final prose in v1.

## Deliverables

Return:

- target-repo file structure
- runtime contract summary
- dependency-gate decision tree
- auth-by-plane summary
- validation and rollout checklist
