---
name: groom-stories
description: "Grooming a story with Kirlia in the chat (Cursor, Claude, Codex) without touching Asana — turn an idea into a WOW story, keep developing it, break it into 30-minute subtasks, and answer questions in plain language."
---

# Groom Stories In Chat

Use this skill when someone wants to write, groom, refine, or task a story **in the chat**
instead of in Asana. Kirlia's runtime in `soofi-xyz/kirlia-agent` grooms live Asana tasks
on `@mention`; this skill applies the same rules here so people can shape a story before it
goes anywhere.

## Ground Rules

- Never create, update, or comment on anything in Asana. Grooming stays in the chat.
- Only add a story to Asana when the person explicitly asks for it, and then only through the
  Kirlia MCP `create_story` tool after they confirm the final draft. Without that tool, give them
  the text to paste.
- To add an image or screenshot to a story you created, follow
  [`attach-asana-images`](../attach-asana-images/SKILL.md): `create_story` has no image field.
- Print the story and the subtasks in full in the chat whenever they are created or changed, or
  when the person asks to see them. Never just summarize them.
- Talk like a helpful teammate: plain, everyday words, short sentences, no jargon. Lead with the
  answer. Say "the done-checks overlap", not "the criteria aren't MECE".
- Never invent facts, names, numbers, people, links, or systems. Keep every URL exactly.

## Tools

When the Kirlia MCP server is connected (tools `draft_story`, `task_story`, `ask_kirlia`), use
it: it runs Kirlia's own prompt and validator.

| Need | Call |
|---|---|
| Groom an idea or a pasted story | `draft_story` with the person's words in `idea` |
| Answer Kirlia's questions | `draft_story` again with the answers in `context` |
| Change a draft | `draft_story` with the current markdown as `idea` and the change as `instruction` |
| Break it into subtasks | `task_story` with the title and the current markdown |
| Questions ("is this ready?", "which agent?") | `ask_kirlia` with the question and the story |

Show each result exactly as returned. When the MCP server is not connected, groom by hand with
the rules below. Do not stop to set the server up unless the person asks.

## Workflow

1. Read what the person gave you. If the outcome (what should exist or change when the work is
   done) is unclear, ask **at most 3** short, friendly questions, then stop and wait.
   Otherwise write the story, and name any key gap in Context as an "Assuming …" sentence.
2. Print the story (format below) and one line on what you did.
3. Offer the next step in one short sentence, for example "Want me to break this into subtasks?"
4. On feedback, change only what the feedback touches and copy the rest word for word. When the
   feedback changes the outcome, audience, or approach, rewrite around it. Print the whole story
   again and say in one sentence what changed.
5. On "task this" (or similar), print the subtasks (format below) without changing the story.
6. Remember the person's answers for the rest of the chat. Never ask the same thing twice.

## Story Format

Three sections, in this order:

1. **Context**: one short paragraph (about 600 characters at most). Explain why the work exists
   and which product, repository, or finished work it builds on. End with a sentence that begins
   "The goal is to".
2. **Description**: one short, verb-first paragraph (about 400 characters at most) describing
   the outcome. Do not repeat the Context, and never use "as a user".
3. **Acceptance Criteria**: 1–8 single-sentence, verb-first checks of done, each 160 characters
   at most. They are MECE: no two overlap, and together they cover everything the Description
   promises.

Title: imperative, at most 80 characters, no trailing period.

### Agents

Name 0–4 team-kit agents on an **Agents:** line under Description. Use only agents that exist in
`agents/`, and pick them by product **and** action:

- Use the product's **build** agent when the work changes the base product itself (its code,
  engine, API, or behavior).
- Use its **configure** agent when the work only sets up or verifies an existing deployment.
- Use a specialist agent when the work is squarely its area.

Find the owners in `skills/guide-product-work/reference/product-catalog.json` and the routing
rules in `agents/arceus.md`. Never give one product's work to another product's agent, and never
name an agent for a product that has none yet; name the ownership gap instead. When the person
writes a near spelling (for example "Evee"), use the real name (`eevee`).

When the work needs a build agent, add a final criterion:
"Update the team kit so <Agent> learns the skills and rules this change adds."

### Print It Like This

```markdown
# <Title>

## Context

<paragraph ending with "The goal is to …">

## Description

<verb-first paragraph>

**Agents:** Conkeldurr (builds Persist), Uxie (configures Persist)

## Acceptance Criteria

- <verb-first check>
- <verb-first check>
```

## Subtasks

- Write 2–12 subtasks, in the order to do them, each about 30 minutes of work for one person.
- Give each a 5–7 word name: verb-first, plain words, no trailing period.
- Give each a **Done when:** check, one short sentence naming what proves it is finished.
- Give a subtask an agent **only** when it builds or configures a product, or is squarely a
  specialist's area. Leave out the agent on review, discussion, decisions, docs, and manual
  checks.
- Do the smallest testable piece first, and make each next subtask add one testable piece.
  Together the subtasks cover every criterion, and no two of them do the same work.
- When the story needs a build agent, the last subtask is "Update team kit for <Agent>", done
  when a merged `soofi-xyz-team-kit` pull request gives that agent the skills and rules the work
  added.

Print them as a checklist:

```markdown
## Subtasks

- [ ] **Map Gmail labels to Persist facts** (Agent: Conkeldurr (builds Persist))
  Done when: A query returns a message's labels.
- [ ] **Review label names with Finance**
  Done when: Finance approves the label list.
- [ ] **Update team kit for Conkeldurr**
  Done when: A merged soofi-xyz-team-kit pull request gives Conkeldurr the skills and rules this work added.
```

## Answering Questions

Answer questions about the story, the work, our products and agents, or what Kirlia can do in
2–5 plain sentences. Answer first, and suggest a next step only when it helps.

## Connect The Kirlia MCP Server

The team kit ships the Kirlia server (`https://kirlia.prismteam.ai/api/mcp`), so there is
nothing to install and no key to paste. The first time a Kirlia tool is used, the app asks the
person to sign in with their `prismteam.ai` Google account:

- Claude Code: run `/mcp`, pick `kirlia`, and choose **Authenticate**.
- Cursor: open **Settings → MCP**, find `kirlia`, and click **Connect** (or **Login**).

Only `prismteam.ai` accounts that are in Asana can sign in. Until someone signs in, groom by hand
with the rules above.
