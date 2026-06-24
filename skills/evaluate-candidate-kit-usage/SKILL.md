---
name: evaluate-candidate-kit-usage
description: "Kit-conformance phase of candidate test-task evaluation, run as a dedicated subagent. Classify whether the candidate built the task using this soofi-xyz plugin (the agents and skills in this repository). First determine which kit agent(s) and skill(s) should have built a task like this by consulting arceus and README.md, then consult each of those building agents about how correctly the submission is implemented from a coding standpoint — services chosen, architecture, and adherence to that agent's patterns — and collect a score from each. Aggregate the scores into a kit-usage conformance score with evidence. Use after evaluate-candidate-intent (and usually alongside evaluate-candidate-product)."
---

# Evaluate Candidate Kit Usage

## When to Use This Skill

Use this skill as the **kit-conformance phase** of a candidate test-task evaluation. Run it as a **dedicated subagent**. Its job is to decide, with evidence, whether the candidate built the task **using this soofi-xyz plugin** — the agents and skills in this repository (the Cursor / Copilot / Codex kit) — and how correctly they applied the relevant patterns.

This phase scores *how* the product was built. It pairs with `evaluate-candidate-product`, which scores *what* the product does.

## Step 1 — Determine Which Kit Agents Should Have Built This

You cannot judge conformance without first knowing the right answer for this task.

1. Read the core intent and weighted criteria from `evaluate-candidate-intent`.
2. Consult `arceus` (the router) and `README.md` to determine which agent(s) and skill(s) in this kit are the correct fit for a task like this. Treat `arceus`'s routing as the reference answer for "what good looks like."
3. Record the **expected toolchain**: the primary agent, supporting agents, and the skills they load. Quote at most one sentence per source to justify each choice.
4. If several kit paths could plausibly build the task, list each and note which the candidate appears closest to.

## Step 2 — Gather Evidence of Kit Usage

Inspect the candidate's repository and submission for signals that the kit was actually used and that its patterns were followed:

- architecture, services, and infrastructure choices versus what the expected agents prescribe;
- file/module layout, naming, and conventions that match the kit's skills;
- whether the candidate followed the engineering baseline in `apply-engineering-guidelines`;
- commit history, docs, or notes that reference kit agents/skills (helpful but not required — judge the code, not the mention).

Record concrete file paths and snippets as evidence. Do not give credit for a kit mention that is not reflected in the implementation, and do not penalize a strong, conformant implementation merely because it does not name the agents.

## Step 3 — Consult Each Relevant Building Agent for a Coding Score

For every expected agent identified in Step 1, **consult that agent** (spawn it as a subagent / use the platform's subagent mechanism) as a domain reviewer of the candidate's code.

Ask each consulted agent to assess, from its own specialty, how correctly the submission is implemented:

- Are the services and infrastructure the ones this agent would have chosen?
- Does the implementation follow this agent's required patterns, contracts, and guardrails?
- What is clearly correct, what is wrong or risky, and what is missing?

Request a structured result from each consulted agent:

- a **score 0–100** for conformance to that agent's domain,
- the top strengths and the top deviations, each with a file/path reference,
- a one-line confidence note.

Keep the consultation read-only: the consulted agents review and score; they do not modify the candidate's repository.

## Step 4 — Aggregate the Kit-Usage Conformance Score

Combine the consulted scores into a single kit-usage conformance score (0–100):

- Weight each consulted agent by how central it is to the task (the primary agent dominates; supporting agents contribute less).
- If the candidate clearly built the task **without** the kit but still implemented it well, say so plainly — report a low kit-usage score with a note that functional quality is captured separately by `evaluate-candidate-product`.
- If expected agents could not be consulted, mark those portions `Blocked` and explain why, rather than inventing a score.

This score feeds the `Kit-usage conformance` dimension (default weight 15) in the overall model from `evaluate-candidate-intent`.

## Output Format

Return a concise Markdown report:

```markdown
# Candidate Kit Usage — Conformance Evaluation

## Expected Toolchain
- Primary agent: <name> — <why, one sentence>
- Supporting agents/skills: <names> — <why>

## Evidence of Kit Usage
<bullets with file paths / snippets; built-with-kit: yes / partial / no>

## Consulted Agent Scores
| Agent | Score (0–100) | Strengths | Deviations | Confidence |
|---|---|---|---|---|

## Aggregated Kit-Usage Score
<0–100 + how it was weighted>

## Notes / Blockers
<agents that could not be consulted and why>
```

## Quality Bar

- The expected toolchain is grounded in `arceus` / `README.md`, not memory.
- Each consulted agent's score is backed by file-level evidence from the candidate repo.
- The aggregate weights the primary agent above supporting agents.
- A well-built-but-not-with-the-kit submission is reported honestly as low kit-usage, without conflating it with functional quality.
- Consultations are read-only and do not modify the candidate's repository.
