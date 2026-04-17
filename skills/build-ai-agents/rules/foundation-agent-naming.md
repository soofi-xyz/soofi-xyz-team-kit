---
title: Agent Naming
impact: HIGH
tags: [naming, convention, identity]
---

# Agent Naming

Every agent MUST be named after a Roman/Greek poet, philosopher, or other significant historical figure.

## Rules

1. **Pick a meaningful name.** The figure's legacy should resonate with the agent's purpose.
2. **Use lowercase** for the repository and all code references (e.g., `ovid-agent`, not `Ovid-Agent`).
3. **Suffix with `-agent`** in the repository name (e.g., `ovid-agent`, `seneca-agent`).
4. **Do NOT reuse names.** Check existing agents before picking.
5. **Document the choice.** Add a one-line explanation in the README of why this figure was chosen.

## Naming Examples

| Agent Purpose | Good Name | Why |
| --- | --- | --- |
| Rules/compliance engine | **Ovid** | Roman poet known for *Metamorphoses* — transformation of rules |
| Data analysis/insights | **Aristotle** | Greek philosopher, father of empirical observation |
| Communication/messaging | **Cicero** | Roman orator, master of rhetoric |
| Scheduling/planning | **Chronos** | Greek personification of time |
| Security/auditing | **Argus** | Giant with a hundred eyes in Greek mythology |
| Knowledge management | **Hypatia** | Alexandrian scholar and librarian |

## ✅ Correct

```
Repository: spring-oaks-capital-llc/seneca-agent
README: "Named after Seneca the Younger — Stoic philosopher known for practical wisdom,
         fitting for an agent that provides actionable financial guidance."
```

## ❌ Incorrect

```
Repository: spring-oaks-capital-llc/data-processor-agent   # ❌ Generic name
Repository: spring-oaks-capital-llc/Agent2                  # ❌ Meaningless
Repository: spring-oaks-capital-llc/Ovid-Agent              # ❌ Wrong case
```
