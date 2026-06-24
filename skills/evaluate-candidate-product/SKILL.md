---
name: evaluate-candidate-product
description: "Functional-testing phase of candidate test-task evaluation, run as a dedicated subagent. First enforce the mandatory gates from evaluate-candidate-intent — no pull request to the task repo, no usable URL/path to the running product, or inaccessible because of a credentials problem all mean an immediate 0 and a Fail verdict. Then drive the live product with the Playwright browser to confirm which acceptance criteria and, most importantly, the core intent are actually satisfied in real use, and score data richness and usefulness (a working app populated with only a handful of rows or items scores extremely low). Ask the operator to provide any access, credentials, or tools that the Playwright browser alone cannot. Use after evaluate-candidate-intent and before or alongside evaluate-candidate-kit-usage."
---

# Evaluate Candidate Product

## When to Use This Skill

Use this skill as the **functional-testing phase** of a candidate test-task evaluation, after `evaluate-candidate-intent` has produced the core intent, weighted criteria, and gates. Run it as a **dedicated subagent** whose only job is to use the candidate's product and report evidence-backed results.

This skill answers one question above all: **when a real user uses this product, is the core intent actually delivered?**

## Step 1 — Enforce the Mandatory Gates (Auto-Fail)

Check the three gates from `evaluate-candidate-intent` **before any other work**. These are hard gates, not weighted criteria.

1. **PR to the task repo** — the candidate must have opened a pull request to the repository that holds the task itself. No PR (or only an unrelated repo with no PR back to the task repo) fails this gate.
2. **Usable path to the product** — there must be a URL for a web app, or another concrete, documented way to launch and reach the running product.
3. **Access** — the product must be publicly available, or the candidate must have supplied working credentials. If the product cannot be reached because of a credentials problem, this gate fails.

If **any** gate fails:

- Set the overall score to **0**.
- Set the verdict to **Fail**.
- Record exactly which gate failed and the evidence (missing PR link, no usable URL, credential/auth error observed).
- Do **not** continue to functional scoring. A product that cannot be opened and used has not been delivered.

Before failing on access, attempt one reasonable recovery: re-read the submission for a URL, credentials, or run instructions you missed. If access still cannot be obtained, request operator help (see Step 3) rather than guessing. Only fail the access gate after that request cannot be satisfied.

## Step 2 — Test the Live Product with Playwright (Most Important)

Once the gates pass, **use the product as a real user would** by driving it with the Playwright browser (the `user-playwright` MCP browser tools: `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_evaluate`, and the rest).

- Navigate to the live URL and exercise the primary user journey end to end — the journey that delivers the core intent.
- Drive real interactions: log in, create and read records, run the configured workflow, submit forms, and observe results. Do not judge from screenshots of a landing page alone.
- Capture evidence: the URL and route, the action taken, the expected result, the actual result, and a screenshot or extracted DOM/text where it supports the finding.
- Prefer observed behavior over documentation. Never give credit for a feature you could not make happen in the running product.
- Stay read-only on the candidate's data where possible; do not perform destructive actions unless the workflow under test requires it and the operator allows it.

## Step 3 — Ask the Operator for Tools and Access When Playwright Is Not Enough

This is critical: when the Playwright browser alone cannot complete a check, **ask the operator (the human running this evaluation) to provide what is needed** rather than silently marking the check blocked.

Ask for help when the product requires, for example:

- credentials, an OAuth login, a one-time code, or an invite;
- a native/desktop/mobile app, a CLI, or an API client instead of a browser;
- test data, a sandbox account, or a seeded environment;
- a VPN, allow-listed IP, or other network access.

When you request operator help, state:

1. the integration or capability and why it is required for the core intent,
2. the exact action the operator should take,
3. the minimum access or scopes needed,
4. a clear warning not to paste secrets into chat — configure them locally or through the product's setup flow,
5. what to report back so you can resume (for example, "logged in" or "sandbox record created").

If the operator cannot provide access, mark the affected checks `Blocked` and explain what is missing. Do not penalize the candidate for an evaluation-environment blocker unless the candidate failed to document required setup.

## Step 4 — Verify the Core Intent and Acceptance Criteria

Using the weighted criteria from `evaluate-candidate-intent`:

1. Determine, from real use, whether the **core intent** is satisfied. This is the single most important judgment in the whole evaluation.
2. Walk each acceptance criterion and assign a status: `Pass`, `Partial`, `Fail`, `Blocked`, or `Not Applicable`, each backed by an observed action and result.
3. Treat a product that demos narrowly but breaks on the real journey as failing the intent, even if isolated features work.

## Step 5 — Score Data Richness and Usefulness (Weighted Heavily)

Test tasks almost always ask for a genuinely useful platform/product/app with configuration and real content. Evaluate how data-rich and useful the submission is.

- Check whether the product is populated with **as much realistic data as possible**: enough records, configuration, and variety that the product is actually useful.
- A product that "works" but contains only a handful of items — for example ~5 rows, 5 records, or 5 configured entities — is a toy, not a deliverable, and must be scored **extremely low** on this dimension regardless of how clean the code or UI is.
- Look for breadth and realism: realistic volumes, varied states, meaningful configuration, and behavior that holds up as data scales — not a single hard-coded happy path.
- Record concrete counts you observed (rows, records, entities) as evidence for the data-richness score.

## Output Format

Return a concise Markdown report:

```markdown
# Candidate Product — Functional Evaluation

## Gate Result
<Passed | Failed: which gate, with evidence>   # if Failed, score = 0 and stop

## Intent Satisfied
<Yes | Partially | No> — <one-line rationale from real use>

## Acceptance Criteria
| ID | Status | Evidence (action → result) |
|---|---|---|

## Data Richness and Usefulness
<score + observed counts/variety; call out toy-sized data explicitly>

## Operator Requests / Blockers
<what was requested or remains blocked, if anything>

## Weighted Functional Subtotal
<intent + criteria + data-richness contributions toward the 100-point model>
```

## Quality Bar

- Gates are checked first; a gate failure produces a 0 and stops the phase.
- The core-intent judgment is grounded in an actual Playwright-driven run of the live product.
- Operator help is requested whenever the browser alone cannot reach the product, before declaring a block.
- Data richness is scored on observed volume and variety, with toy datasets scored extremely low.
- Every status cites an action and an observed result, not a documentation claim.
