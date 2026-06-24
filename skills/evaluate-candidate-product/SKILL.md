---
name: evaluate-candidate-product
description: "Evidence-and-functional-outcome phase of candidate test-task evaluation, run as a dedicated subagent. First enforce the gates from evaluate-candidate-intent — a missing PR to the designated assignment repo, demo artifact, or credentials are explicit Failed gates, and a runtime that cannot be reached and exercised is an absolute hard fail (score 0/100, verdict Fail, for any reason including environment or anti-automation blocks). Then drive the live runtime with the Playwright browser to prove the story's intent through working runtime behavior, data evidence, output evidence, and demo artifacts, evaluate functional outcome before implementation, check assignment-specific access boundaries (for X Engagement, hosted investors-mcp read tools only — flag direct database, vector-store, or blob access as a violation), and return Pass/Partial/Fail/Blocked for each material acceptance criterion. Score functional outcome, evidence quality, access-boundary compliance, runtime/demo quality, and reproducibility. Use after evaluate-candidate-intent."
---

# Evaluate Candidate Product

## When to Use This Skill

Use this skill as the **evidence and functional-outcome phase**, after `evaluate-candidate-intent` has produced the intent, evidence model, gates, and weighting. Run it as a **dedicated subagent**. It answers the central question: **does working runtime, data, output, and demo evidence prove the story's intended outcome?** Evaluate the functional outcome **before** any implementation detail.

For assignment-specific evidence and access boundaries, consult `reference/assignment-evidence-catalogs.md`.

## Step 1 — Enforce the Gates (Failed / Blocked / Hard Fail)

Check the gates from `evaluate-candidate-intent` **before any scoring**. Use concrete reasons.

1. **PR gate** — a pull request exists against the **designated assignment repository** (not only a standalone repo, email artifact, or private demo). Missing → `Failed`.
2. **Runtime gate (absolute)** — you must be able to both reach **and** meaningfully exercise the runtime that demonstrates the core intent. If you cannot, the result is **0/100, verdict Fail** — for **any** reason: inaccessible or erroring URL, a login/OAuth you cannot complete, missing or non-working credentials, an automation/anti-bot block, a paywall, or anything else. This applies even when the cause is the evaluation environment, not the candidate. Reviewing the code and concluding "it would probably work" is **0**. An API/MCP surface responding is **0** unless that surface alone fully demonstrates the core intent the candidate was asked to deliver.
3. **Credentials gate** — required credentials present and working, or the runtime is public. Missing → `Failed` (or `Blocked` if the operator may still supply them).
4. **Demo gate** — a demo artifact is present and reachable. Missing → `Failed` or `Blocked`.

Resolution rules:

- A `Failed` gate forces the overall score to **0** and the verdict to **Fail**. Stop scoring.
- **Runtime is absolute.** Before declaring the runtime unreachable, make **one** recovery attempt: re-read the PR/submission for a URL, credentials, or run steps, then request operator help (Step 3) — ask for working credentials, a completed login, the runtime URL, or the client/tool needed. If after that attempt you still cannot exercise the runtime, the result is **0/100, verdict Fail**. Do **not** mark the runtime `Blocked` and continue scoring, do **not** average other dimensions, and do **not** return `Partial Pass` or `Inconclusive`. An unexercised runtime is a 0 regardless of cause.
- `Blocked` (with an `Inconclusive` result for the affected area) is permitted only for a **non-runtime** check (e.g., a secondary artifact) and only when the runtime itself was successfully exercised and the intent proven.
- For non-runtime gates, distinguish a candidate omission (`Failed`) from an evaluation-environment blocker (`Blocked`). Never penalize the candidate for a non-runtime blocker you could have asked the operator to resolve.

## Step 2 — Prove the Outcome by Exercising the Runtime (Most Important)

Drive the live runtime as a real user with the Playwright browser (`user-playwright` MCP tools: `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_evaluate`, and the rest).

- Walk the **primary workflow end to end** — the journey that delivers the intent.
- Gather the four evidence types the story implies: **working runtime behavior**, **data evidence** (records actually present and used), **output evidence** (what the product produces), and **demo artifacts** (does the demo show the real outcome).
- Capture for every check: URL/route, action taken, expected result, actual result, and a screenshot or extracted DOM/text.
- Prefer observed behavior over claims. Never credit a feature you could not make happen in the runtime.
- Stay read-only on candidate data where possible; avoid destructive actions unless the workflow requires it and the operator allows it.

## Step 3 — Ask the Operator for Access or Tools When the Browser Is Not Enough

When the Playwright browser alone cannot reach or exercise the runtime, **ask the operator** before declaring a block. Request when the product needs credentials/OAuth/one-time codes, a native/desktop/CLI/API client, test data or a sandbox, or network access (VPN/allow-list).

State: the capability and why the intent needs it; the exact action the operator should take; the minimum scopes; a warning not to paste secrets into chat (configure locally or via the product setup); and what to report back so you can resume. If the operator cannot unblock it, mark the affected checks `Blocked`.

## Step 4 — Score Each Functional Evaluation Point (Most Important)

Do **not** produce one opaque functional-outcome number. Score every **evaluation point** from the Functional Outcome Breakdown in `evaluate-candidate-intent` individually, from real runtime use.

1. For **each evaluation point**, exercise the runtime to confirm it, then assign an anchored band (0/25/50/75/100%). `Points = band × the point's sub-weight`, rounded. Cite the observed action → result (and a screenshot/DOM) for each point.
2. The **Functional outcome subtotal = the sum of all evaluation-point scores** (max 40). This is the most important judgment in the evaluation.
3. Score **data scale** within the point(s) it belongs to (e.g., a coverage/scale point): a product populated with only a handful of rows/records/entities is a toy and that point must score **extremely low**, regardless of UI or code polish. Record observed counts and variety.
4. Separately score **evidence quality** (weight 12): how convincingly runtime/data/output/demo evidence proves the points (strong/observed vs thin/asserted).
5. Apply **anti-checklist** judgment: a submission that satisfies many technical bullets but misses the points that carry the intent gets a low functional score with an explicit explanation.
6. If a point cannot be exercised because the **runtime as a whole** was unreachable, the runtime gate already forced 0/Fail (Step 1) — do not score points. A single point you could not reach while the rest of the runtime works is that point scoring 0 with the reason, not a global gate fail.

## Step 5 — Access-Boundary Compliance

Check the assignment-specific access boundaries from `evaluate-candidate-intent` and `reference/assignment-evidence-catalogs.md`.

- For **X Engagement**, verify the submission uses the **hosted investors-mcp read tools** and flag any **direct database, vector-store, or blob access** as a violation.
- Confirm required external dependencies are used through the intended interface, not bypassed.
- Score access-boundary compliance and cite the evidence (config, network calls, code paths, runtime behavior).

## Step 6 — Acceptance Criteria as Evidence Probes

Walk each material acceptance criterion and assign `Pass`, `Partial`, `Fail`, or `Blocked`, each backed by an observed action/result with a link or observation. Treat criteria as evidence for the outcome, not as a substitute for it.

## Step 7 — Runtime/Demo Quality and Reproducibility

- **Runtime & demo quality**: stability, responsiveness, error handling observed during the run, and whether the demo artifact actually shows the real outcome.
- **Reproducibility**: whether the runtime and key results can be reached and reproduced from the **pull request as the system of record** (setup docs, working URL/creds, demo) without side-channel context.

## Output Format

```markdown
# Candidate Product — Evidence & Functional Evaluation

## Gate Result
<Pass | Failed: which gate + reason (score 0/100, verdict Fail, stop) | Runtime not exercised: reason (score 0/100, verdict Fail, stop) | Blocked: non-runtime check + reason>

## Outcome Proven?
<Yes | Partially | No> — <one line from real use>

## Functional Outcome — Per-Point Scores
| Evaluation point | Sub-weight | Band | Points | Evidence (action → result) |
|---|---|---|---|---|
| <point> | n | <%> | n | <observed> |
| **Functional outcome subtotal** | **40** | | **n** | |

## Evidence
- Runtime behavior / Data evidence (counts) / Output evidence / Demo artifact

## Access-Boundary Compliance
<compliant / violations with evidence>

## Acceptance Criteria
| Criterion | Status | Evidence (action → result / link) |
|---|---|---|

## Runtime/Demo Quality & Reproducibility
<observations>

## Dimension Subtotals
Emit a table for the dimensions this phase owns so the orchestrator can assemble the full scorecard. `Band` is the anchored fraction (0/25/50/75/100%); `Points` = Band × Weight, rounded.

| Dimension | Weight | Band | Points | Why |
|---|---|---|---|---|
| Functional outcome | 40 | — | n | sum of per-point scores (see Per-Point Scores) |
| Runtime & demo quality | 20 | <%> | n | <one line> |
| Evidence quality | 12 | <%> | n | <one line> |
| Access-boundary compliance | 8 | <%> | n | <one line> |
| Reproducibility | 4 | <%> | n | <one line> |

If a gate failed or the runtime was not exercised, set every Band to 0 / Points to 0 and state the gate cause in the Why column.
```

## Quality Bar

- Gates first; a `Failed` gate produces 0 and stops the phase.
- The runtime gate is absolute: a runtime you could not exercise yields 0/100 and Fail, for any reason, after one operator-assisted attempt — never a partial score or `Inconclusive`.
- The outcome judgment is grounded in a Playwright-driven run of the live runtime.
- Functional outcome is scored per evaluation point (Per-Point Scores table), and the subtotal is the sum of those points — never one opaque number.
- Functional outcome is evaluated before implementation; toy data scores extremely low.
- Access boundaries are checked with assignment-specific rules and cited evidence.
- Operator help is requested before declaring a block; Failed vs Blocked is distinguished.
- Every criterion status cites an observed action/result, not a documentation claim.
