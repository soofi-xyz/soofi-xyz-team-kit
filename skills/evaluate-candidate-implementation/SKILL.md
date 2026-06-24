---
name: evaluate-candidate-implementation
description: "Implementation phase of candidate test-task evaluation, run as a dedicated subagent, after the functional outcome is understood. Evaluate technical implementation quality — architecture, code structure, and the technical depth behind acceptance-criteria coverage — comparing against any reference repositories the story points at (for example the investors-mcp reference fork). Then score kit-usage conformance: determine which soofi-xyz kit agent(s)/skill(s) should have built a task like this by consulting arceus and README.md, consult each relevant builder agent as a read-only reviewer for a 0–100 coding score, and aggregate. Return separate implementation-quality and kit-usage scores with file-level evidence. Use after evaluate-candidate-product so implementation is judged third, never before the outcome."
---

# Evaluate Candidate Implementation

## When to Use This Skill

Use this skill as the **implementation phase**, run as a **dedicated subagent**, only **after** `evaluate-candidate-product` has judged the functional outcome. Implementation is evaluated **third**: how the work was built never outranks whether it delivers the outcome.

This skill produces two scored dimensions from the model in `evaluate-candidate-intent`:

- **Implementation quality** (weight 7) — architecture, code structure, and the technical depth behind acceptance-criteria coverage.
- **Kit-usage conformance** (weight 5) — whether the candidate built the task using this soofi-xyz kit, and how correctly.

## Step 1 — Evaluate Implementation Quality

Review the candidate repository and PR for technical quality, anchored to the intent and evidence model:

- **Architecture** — are the services, data model, and boundaries appropriate for the outcome?
- **Code structure** — module layout, separation of concerns, readability, error handling, tests.
- **Acceptance-criteria depth** — for criteria `evaluate-candidate-product` marked `Pass`/`Partial`, is the underlying implementation sound or a thin shim?
- **Reference repositories** — where the story points at a reference (for example the **investors-mcp reference fork**), compare the candidate's integration against it: correct interfaces, respected access boundaries, no bypasses. Read the reference repo; do not assume.

Record concrete file paths and snippets. Do not credit claims that the code does not support, and do not reward polish that does not serve the outcome.

## Step 2 — Determine the Expected Kit Toolchain

You cannot score kit-usage without the right answer for this task.

1. Read the intent, evidence model, and weighting from `evaluate-candidate-intent`.
2. Consult `arceus` (the router) and `README.md` to determine which kit agent(s)/skill(s) are the correct fit for a task like this. Treat `arceus`'s routing as the reference for "what good looks like."
3. Record the **expected toolchain**: primary agent, supporting agents, and the skills they load. Quote at most one sentence per source.

## Step 3 — Gather Evidence of Kit Usage

Inspect the submission for signals the kit was used and its patterns followed:

- services/infrastructure choices versus what the expected agents prescribe;
- file/module layout and conventions matching the kit's skills;
- adherence to the `apply-engineering-guidelines` baseline;
- commits/docs that reference kit agents/skills (helpful, not required — judge the code).

Do not credit a kit mention not reflected in the code, and do not penalize a strong, conformant implementation merely because it does not name the agents.

## Step 4 — Consult Each Relevant Builder Agent for a Coding Score

For each expected agent from Step 2, **consult that agent** (spawn it as a subagent) as a read-only domain reviewer. Ask each to assess, from its specialty:

- are the services/infrastructure the ones it would have chosen?
- does the implementation follow its required patterns, contracts, and guardrails?
- what is correct, what is wrong or risky, and what is missing?

Request from each: a **score 0–100**, top strengths and deviations with file references, and a one-line confidence note. Consultations are read-only — reviewers score, they do not modify the candidate repo.

## Step 5 — Aggregate the Scores

- **Implementation quality (0–100)** — your own technical judgment from Step 1, weighted toward what serves the outcome.
- **Kit-usage conformance (0–100)** — weight each consulted agent by how central it is (primary dominates). If the candidate built it well but **without** the kit, report a low kit-usage score and say so plainly; functional quality is captured separately by `evaluate-candidate-product`.
- If expected agents cannot be consulted, mark those portions `Blocked` with a reason rather than inventing a score.

## Output Format

```markdown
# Candidate Implementation — Quality & Kit Usage

## Implementation Quality
- Score (0–100): <n>
- Architecture / code structure / AC depth / reference-repo comparison — bullets with file paths

## Expected Toolchain
- Primary agent: <name> — <why, one sentence>
- Supporting agents/skills: <names>

## Consulted Agent Scores
| Agent | Score (0–100) | Strengths | Deviations | Confidence |
|---|---|---|---|---|

## Kit-Usage Conformance
- Aggregated score (0–100): <n> — <how weighted; built-with-kit: yes/partial/no>

## Dimension Subtotals
Map the two 0–100 scores onto the weighted model using anchored bands (0/25/50/75/100%); `Points` = Band × Weight, rounded.

| Dimension | Weight | Band | Points | Why |
|---|---|---|---|---|
| Implementation quality | 7 | <%> | n | <one line> |
| Kit-usage conformance | 5 | <%> | n | <one line> |

## Notes / Blockers
<reference repos read; agents that could not be consulted and why>
```

## Quality Bar

- Implementation is judged after the functional outcome, never before.
- Implementation-quality findings cite file-level evidence and reference repositories where the story points at them.
- The expected toolchain is grounded in `arceus` / `README.md`, not memory.
- Kit-usage aggregates consulted scores, weighting the primary agent highest, and reports built-without-kit honestly.
- All consultations are read-only and do not modify the candidate repository.
