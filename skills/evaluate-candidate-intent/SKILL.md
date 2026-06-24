---
name: evaluate-candidate-intent
description: "First phase of candidate test-task evaluation. Read the assignment user story (or assignment repository), candidate pull request, runtime URL, demo video, credentials, and the assignment-sent datetime, then derive the story's one-sentence intent — the business outcome that would make the work obviously useful — before any scoring. Fetch the candidate's latest commit timestamp from GitHub and compute elapsed delivery time. Build the evidence model (actors, workflow, data objects, scale signals, runtime proof, access boundaries, demo evidence), the pass/fail gates (PR to the designated assignment repo, runtime, credentials, demo), and the weighted 100-point scoring model. Use at the start of a hiring-candidate evaluation, before functional or implementation review. Not for designing new agents or products from scratch."
---

# Evaluate Candidate Intent

## When to Use This Skill

Use this skill as the **first phase** of evaluating a hiring candidate's assignment (for example a PrismTeam task such as X Engagement Reply Agent, Oracle Property Intelligence Platform, Agent Network Registration and Certification Platform, or the investors-mcp reference fork). It turns an assignment user story plus a submission into an evaluable contract: a one-sentence intent, an evidence model, pass/fail gates, and a weighted 100-point model.

Evaluate by **intended business outcome first**. Acceptance criteria are evidence probes, not a replacement for intent. Hand the output to `evaluate-candidate-product` (evidence and functional outcome) and `evaluate-candidate-implementation` (implementation quality and kit usage).

## Core Principle: Intent First

The most important job of this phase is to state the **business outcome that would make the submitted work obviously useful** — in one sentence — before scoring anything.

- A user story is never "write some code." It is "deliver an outcome a real user can rely on."
- Write the intent as one sentence: the outcome that, if proven, makes the work obviously valuable.
- If you cannot articulate that outcome in one sentence, keep reading the story until you can. Do not proceed with a vague intent.
- A long feature list never replaces the intent. Features are evidence the outcome is met, not the outcome itself.

## Inputs to Collect

Record these. If an input is missing, note it; `evaluate-candidate-product` turns missing artifacts into explicit Failed or Blocked gates.

- **Assignment**: the user story or the assignment repository, title/ID, description, comments, attachments, and the **designated assignment repository** the PR must target (PrismTeam where applicable).
- **Candidate pull request**: the PR URL against the designated assignment repo, branch, and head commit.
- **Runtime**: a **deployed, hosted runtime URL** the candidate stood up and that the evaluator can reach and exercise **without building, installing, or running the app**. A locally set-up app does not count — `localhost`/`127.0.0.1`, a dev server the evaluator must start (`npm run dev`, `vite`, `docker compose up`), local Docker, "clone and run it locally", or a tunnel that just exposes the candidate's machine all fail the runtime gate.
- **Demo**: a demo video or other demo artifact, ideally reachable from the PR.
- **Credentials**: any credentials needed to exercise the runtime (or confirmation it is public).
- **Assignment-sent datetime**: when the assignment was sent to the candidate.
- **Reference repositories**: any reference fork or upstream the story points at (for example investors-mcp) used to judge correctness and access boundaries.

The pull request is the **system of record**. Runtime and demo artifacts should be reachable from it. Do not reconstruct a submission from email links, private repos, or side-channel context; if you must, record it as a risk.

## Timing — Elapsed Delivery

1. Fetch the candidate's **latest commit timestamp** from GitHub for the PR head (for example via `gh` or the commits API).
2. Compute **elapsed delivery time** = latest commit timestamp − assignment-sent datetime.
3. Record both timestamps and the elapsed duration. They feed the **Speed** scoring dimension.
4. If the sent datetime or commit history is unavailable, mark Speed `Blocked` with the reason rather than guessing.

## Derive the One-Sentence Intent

1. Read the entire story, including comments and linked resources, before judging anything.
2. Identify the outcome and the user it serves.
3. Write the **intent** as one sentence: "A `<actor>` can `<achieve the valuable outcome>` so that `<business value>`."
4. List secondary outcomes that support the intent, kept separate from it.
5. Restate the assignment in one concise sentence so a second evaluator could confirm your reading.

## Build the Evidence Model

From the story, enumerate the evidence the outcome implies. This is what `evaluate-candidate-product` will look for in the runtime and artifacts:

- **Actors** — who uses the product and in what role.
- **Workflow** — the end-to-end journey that delivers the outcome.
- **Data objects** — the entities, records, and relationships the product must work over.
- **Scale signals** — realistic volume/variety expected; a useful product, not a toy. A product populated with only a handful of rows/records/entities is a toy and must score extremely low on functional outcome.
- **Runtime proof** — what working behavior in the live runtime proves the outcome.
- **Access boundaries** — required and forbidden access paths (for example, X Engagement must use hosted investors-mcp read tools; direct database, vector-store, or blob access is a violation).
- **Demo evidence** — what the demo artifact must show.

## Decompose the Intent into Evaluation Points (Functional Outcome Breakdown)

The **Functional outcome** dimension is never a single opaque score. Break the intent into the discrete **evaluation points** the assignment actually requires — the distinct capabilities, views, or sub-outcomes a real user must get — and split the dimension's weight across them so each one is scored and shown separately.

1. Extract every required capability / sub-outcome from the story, its acceptance criteria, and the evidence model. For example, Oracle Property Intelligence decomposes into points such as: Tenant view, Business view, Contractor view, semantic RAG Q&A, source-backed natural-language answers, and data scale/coverage.
2. Assign each evaluation point a **sub-weight**, and make the sub-weights **sum to the Functional outcome weight (40)**. Give the points that most directly prove the intent the largest sub-weights. Record a one-line rationale.
3. Produce **3–8 evaluation points**. If the story is thin, derive points from the intent and evidence model — never collapse the functional outcome to a single generic point.
4. Hand this breakdown to `evaluate-candidate-product`, which scores each point individually by anchored band from real runtime use; the point scores sum to the Functional outcome subtotal.

Emit a Functional Outcome Breakdown table:

| Evaluation point | Sub-weight | What proves it (observable runtime evidence) |
|---|---|---|
| <capability / sub-outcome> | n | <what must be true in the live runtime> |
| ... | ... | ... |
| **Sum** | **40** | |

## Gates (Pass/Fail)

These are not weighted. `evaluate-candidate-product` enforces them. Mark each `Pass`, `Failed` (candidate omission), or `Blocked` (evaluator-side access the operator could not resolve), each with a concrete reason.

1. **PR gate** — work is submitted as a pull request against the designated assignment repository, not only a standalone repo, email artifact, or private demo.
2. **Runtime gate (absolute, deployed only)** — the candidate must provide a **deployed, hosted runtime** (publicly reachable, or reachable via operator-supplied credentials/login to that hosted deployment), and the evaluator must be able to both reach **and** meaningfully exercise it **without building, installing, or running the app**. A **locally set-up app is not an acceptable runtime**: `localhost`/`127.0.0.1`, a dev server the evaluator must start, local Docker, "clone and run it locally", or a tunnel that merely exposes the candidate's machine all **fail** this gate, and the evaluator must never run or host the app to satisfy it. If the runtime cannot be exercised — for **any** reason, including no deployed runtime, a local-only app, an inaccessible or erroring URL, a login/OAuth that cannot be completed, missing or non-working credentials, an automation/anti-bot block, or any other access failure — the overall score is **0/100** and the verdict is **Fail**, full stop. This is true even when the cause is the evaluation environment rather than the candidate. Make exactly one operator-assisted access attempt first (for the deployed URL, credentials, or a completed login — not to run the app for you); if the deployed runtime still cannot be exercised, score 0. Never soften an unexercised runtime to a partial score, `Partial Pass`, or `Inconclusive`.
3. **Credentials gate** — required credentials are present and working (or the runtime is public).
4. **Demo gate** — a demo artifact is present and reachable.

A **Failed** gate forces the overall score to **0** and the verdict to **Fail**. The runtime gate is absolute: an unexercised runtime is always **0/Fail**, regardless of cause and regardless of how strong the code or other artifacts are. A **Blocked** gate may drive an `Inconclusive` result **only** for a *non-runtime* area, and only when the runtime itself was successfully exercised and the core intent proven.

## Weighted 100-Point Model

After gates are evaluated, score out of 100. The operator may override weights; record overrides.

| Dimension | Weight | Owned by |
|---|---|---|
| Functional outcome (sum of the extracted evaluation points; see Functional Outcome Breakdown) | 40 | `evaluate-candidate-product` |
| Runtime & demo quality | 20 | `evaluate-candidate-product` |
| Evidence quality (runtime behavior, data, output, demo) | 12 | `evaluate-candidate-product` |
| Access-boundary compliance | 8 | `evaluate-candidate-product` |
| Implementation quality (architecture, code, AC technical coverage) | 7 | `evaluate-candidate-implementation` |
| Kit-usage conformance (built with the soofi-xyz kit) | 5 | `evaluate-candidate-implementation` |
| Reproducibility | 4 | `evaluate-candidate-product` |
| Speed (elapsed delivery time) | 4 | this skill / orchestrator |

Weighting guidance:

- **Intent (functional outcome) and the live runtime dominate.** Functional outcome (40) and runtime & demo quality (20) together are 60 of 100 — proving the business outcome in a working runtime is the point of the evaluation; everything else is secondary.
- **Functional outcome** carries the single largest share and is **always decomposed into the extracted evaluation points** (Functional Outcome Breakdown); its 40 points are the sum of the per-point scores, never one opaque number. It decides anti-checklist behavior: a submission that satisfies many technical bullets but misses the story's purpose must receive a low score with an explicit explanation.
- **Data scale** lives inside functional outcome and evidence quality — toy datasets score extremely low.
- Treat acceptance criteria as evidence probes that feed these dimensions, not as their own top-level weight.

### Deterministic anchored bands (for consistent, repeatable scores)

Score **each dimension only at one of five anchored fractions of its weight** — never a free-form number — so the same evidence always yields the same total:

| Band | Fraction of weight | Meaning |
|---|---|---|
| 0 | 0% | Not demonstrated / absent / contradicted by evidence. |
| 1 | 25% | Barely present; major gaps; mostly unproven. |
| 2 | 50% | Partially demonstrated; clear gaps remain. |
| 3 | 75% | Largely demonstrated with minor gaps. |
| 4 | 100% | Fully demonstrated with direct evidence. |

Rules: apply the gates **before** scoring (a `Failed` gate or an unexercised runtime is 0/100 and you stop — do not assign bands). Score from observed evidence only, never from documentation claims. Round the weighted total to the nearest integer. Identical evidence must produce an identical band, total, and verdict on every run.

## Output Format

Return a compact Markdown handoff:

```markdown
# Candidate Evaluation — Intent and Model

## Intent
<one sentence: the business outcome that makes the work obviously useful>

## Task Read
<one sentence restating the assignment>

## Timing
- Assignment sent: <datetime>
- Latest commit: <datetime>
- Elapsed delivery: <duration or "Blocked: reason">

## Evidence Model
- Actors / Workflow / Data objects / Scale signals / Runtime proof / Access boundaries / Demo evidence

## Functional Outcome Breakdown
| Evaluation point | Sub-weight | What proves it |
|---|---|---|
| <point> | n | <runtime evidence> |
| **Sum** | **40** | |

## Gates
- PR to designated repo: <Pass | Failed | Blocked + reason>
- Deployed runtime reachable & exercisable (no local-only app): <Pass | Failed | Blocked + reason>
- Credentials: <Pass | Failed | Blocked + reason>
- Demo artifact: <Pass | Failed | Blocked + reason>

## Weighting Model
<default or operator override, totals = 100>

## Notes
<missing inputs, ambiguities, assumptions, side-channel risks>
```

## Quality Bar

- The intent is a single business-outcome sentence, derived before any scoring.
- Timing is computed from the GitHub commit timestamp and the assignment-sent datetime.
- The evidence model names actors, workflow, data objects, scale signals, runtime proof, access boundaries, and demo evidence.
- All four gates are explicit, with Failed vs Blocked distinguished and concrete reasons.
- Weights sum to 100; functional outcome dominates and data scale is captured.
- The Functional Outcome Breakdown lists 3–8 evaluation points whose sub-weights sum to 40.
