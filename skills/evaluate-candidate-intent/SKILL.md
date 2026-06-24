---
name: evaluate-candidate-intent
description: "First phase of candidate test-task evaluation. Read the assessment task, extract the single core intent — the app or product the candidate was asked to build that must deliver real value — and build a weighted acceptance checklist with mandatory gates: a pull request to the repo that holds the task, a concrete way to use the running app (a URL for a web app or an equivalent path), and working credentials or public availability. Use at the start of a hiring-candidate evaluation, before any functional testing or scoring. Produces the intent statement, weighted criteria, and gate list that evaluate-candidate-product and evaluate-candidate-kit-usage consume. Not for designing new agents or products from scratch."
---

# Evaluate Candidate Intent

## When to Use This Skill

Use this skill as the **first phase** of evaluating a hiring candidate's test task (take-home assignment). The candidate was asked to build something — almost always an app, platform, or product that is supposed to provide real value. This phase turns the raw task into an evaluable contract: a single core intent, a weighted checklist, and a set of mandatory gates.

Trigger this skill when the user asks to:

- "Evaluate / grade / score a candidate's test task."
- "Figure out what this take-home is really asking for."
- "Set up the rubric before we test the candidate's app."

Hand the output to `evaluate-candidate-product` (functional testing) and `evaluate-candidate-kit-usage` (kit-conformance scoring).

## Core Principle: Intent First

The most important job of this phase is to identify the **core intent and the value the product must deliver**. Everything else — features, criteria, weights — exists to serve that intent.

- A test task is never "write some code." It is always "build something that lets a user do X and get real value."
- State the intent as one sentence describing the value a real user receives when the product works.
- If you cannot articulate the value in one sentence, keep reading the task until you can. Do not move on with a vague intent.
- Do not let a long feature list bury the intent. Features are evidence that the intent is met, not the intent itself.

## Inputs to Collect

Record these before building the checklist. If an input is missing, note it and continue — `evaluate-candidate-product` will gate on the missing pieces.

- **Assessment task**: title, URL or ID, description, comments, attachments, due date, and the repository that holds the task itself.
- **Candidate submission**: the candidate's repository, branch, the pull request they opened, a live URL or other way to reach the running product, and any credentials or access notes.
- **Stated requirements**: explicit acceptance criteria, required features, constraints, and non-functional expectations.
- **Domain context**: who the intended user is and what data the product is expected to work with.

## Step 1 — Interpret the Task and Extract the Core Intent

1. Read the entire task, including comments and linked resources, before judging anything.
2. Identify the product to be built and the user it serves.
3. Write the **core intent** as one sentence: "A `<user>` can `<do the valuable thing>` so that `<value>`."
4. List the secondary outcomes that support the intent, separated from the intent itself.
5. Capture explicit constraints (stack, integrations, deadlines) without inflating them into the intent.
6. Restate the assignment in one concise sentence so a second evaluator could confirm your reading.

## Step 2 — Build the Weighted Acceptance Checklist

Convert the intent and requirements into observable, testable criteria. Each criterion must be something an evaluator can confirm by **using the product**, not by reading claims in a README.

For every criterion record:

- a short id and statement,
- whether it is **mandatory gate**, **intent-critical**, **required feature**, or **quality**,
- how it will be verified (the concrete user action),
- its weight.

### Mandatory Gates

These are **pass/fail**, not weighted. They define whether the submission can be evaluated at all. `evaluate-candidate-product` enforces them: if any gate fails, the submission scores **0** and the verdict is **Fail**.

1. **PR to the task repo** — the candidate opened a pull request to the repository that holds the task itself (the first expected candidate action). A separate repo with no PR back to the task repo does not satisfy this gate unless the task explicitly allows it.
2. **Usable path to the product** — there is a URL for a web app, or another concrete, documented way to launch and interact with the running product.
3. **Access** — the product is publicly available, or the candidate supplied working credentials. A product that cannot be reached because of a credentials problem fails this gate.

### Default Weighting Model

After the gates pass, score the submission out of 100 using these default weights. The operator may override them; if they do, record the override.

| Dimension | Default weight | Owned by |
|---|---|---|
| Core intent satisfied in real use | 40 | `evaluate-candidate-product` |
| Required acceptance criteria / features | 25 | `evaluate-candidate-product` |
| Data richness and usefulness | 20 | `evaluate-candidate-product` |
| Kit-usage conformance (built with this soofi-xyz plugin) | 15 | `evaluate-candidate-kit-usage` |

Guidance for assigning weights:

- The **core intent** always carries the largest share. If a submission fails the intent, it cannot be a strong pass regardless of polish.
- **Data richness** is weighted heavily on purpose. Tasks almost always ask for a usable platform/product/app with configuration and real content. A product that technically works but is populated with only a handful of rows or items is a toy, not a deliverable, and must score extremely low on this dimension (see `evaluate-candidate-product`).
- Keep `quality`-class criteria (polish, error handling, docs) inside the dimensions above rather than adding new top-level weight, unless the task explicitly calls them out.

## Output Format

Return a compact Markdown handoff with these sections:

```markdown
# Candidate Evaluation — Intent and Checklist

## Core Intent
<one sentence: the value a real user gets when the product works>

## Task Read
<one sentence restating the assignment>

## Mandatory Gates
- [ ] PR to the task repo: <link or "missing">
- [ ] Usable path to the product: <URL/path or "missing">
- [ ] Access: <public / credentials provided / "blocked">

## Weighted Criteria
| ID | Criterion | Class | Weight | How to verify (user action) |
|---|---|---|---|---|

## Weighting Model
<default or operator override, with totals>

## Notes
<missing inputs, ambiguities, assumptions>
```

## Quality Bar

- The intent is a single clear value statement, not a feature dump.
- Every weighted criterion is verifiable by using the product.
- The three mandatory gates are explicit and link to evidence (or are marked missing).
- Weights sum to 100 and the core intent and data richness are weighted as described.
- The handoff is short enough for the product- and kit-testing subagents to act on without re-reading the task.
