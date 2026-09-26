---
title: Prompt Module Edit Guide
impact: high
tags:
  - prompts
  - hypno
---

# Prompt modules

Edit the smallest file that owns the behavior change.

## `asana-agent.md`

Use for persona, tone, when to ask clarifying questions, and high-level operating principles.

**Correct:** add a rule that the bot must confirm before bulk initiative creation.

**Incorrect:** add tool parameter schemas here — those belong in `lib/tools.ts` and `asana-tools.md`.

## `asana-integrations.md`

Use for Asana data model rules: initiative representation, date mapping, AC section parsing, legacy vs new project model.

## `asana-tools.md`

Use when adding or changing tool **invocation policy** — when to call, when not to call, confirmation gates.

Always update this file when adding a tool in `lib/tools.ts`.

## `output-format.md`

Use for Chat response structure, markdown conventions, and link formatting.
