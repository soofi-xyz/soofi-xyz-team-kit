---
name: build-elephant-hero-facts
description: "Build a scheduled service that monitors published Elephant open property data, detects newly ingested counties and dataset changes, generates source-backed candidate facts for the elephant.xyz homepage hero, verifies each fact against the underlying data, routes recommendations to a human in Asana for approval, and publishes approved facts through a content-only GitHub pull request. Covers the dataset catalog and change-detection contract, deterministic fact recipes and the immutable evidence gate, the Asana approval state model, and the content-only GitHub publish hand-off with no auto-merge. Use when building or extending the Watchog hero-facts agent runtime. Triggers on: hero facts, homepage hero, elephant.xyz banner, dataset monitoring, county change detection, fact recipe, fact verification, Asana approval publish, content-only PR. Not for ad-hoc exploration (use-elephant-mcp), ingestion (use-oracle), or Neon SQL (use-elephant-query-db)."
---

# Build Elephant Hero Facts

Step-by-step guide for building the **Watchog** hero-facts service: a recurring, evidence-grounded pipeline that turns published Elephant open property data into accurate homepage-hero facts, gated by human approval in Asana and published to the website through a content-only GitHub pull request.

Compose this skill with `build-ai-agents` (Chat SDK Asana ingress, DynamoDB state, AgentCore memory, Bedrock `ToolLoopAgent`, LangSmith), `build-batch-workflows` (EventBridge Scheduler → Step Functions, cost gate, idempotency, throttling, failure alerting), `use-elephant-mcp` (the verified read contract the data gateway mirrors), `apply-engineering-guidelines` (TypeScript/CDK, observability, PagerDuty, DLQ alarms), and `integrate-ci-cd`.

## Non-negotiable principles

1. **Never invent or transform a number in the model.** Every numeric claim comes from a deterministic query result. The AI may only draft bounded wording around an immutable, verified value.
2. **Verify twice against a pinned dataset revision** — before creating a review task, and again immediately before opening the PR. Reject on any mismatch or a changed/stale revision.
3. **Human approval is mandatory before publish.** No fact reaches the website without an authorized Asana approval that still matches the current data.
4. **Publish is content-only and never auto-merged.** Watchog opens a GitHub PR that changes only the hero-content file. A human reviews and merges; the site's existing deployment publishes it.
5. **Reuse Donphan's data path, not the Cursor agent.** Donphan is an interactive Cursor agent, but it reads through the Elephant MCP — and a production, Vercel-hosted Elephant MCP exists. The scheduled service calls that same hosted MCP with the same verified queries so its facts match the currently live ones; it must not depend on the local developer `mcp.json`. A human may still use Donphan interactively to propose candidate facts.
6. **Fail closed.** Missing config, unreachable data, partial coverage, and stale revisions produce observable non-fact outcomes, never guesses or silent failures.

## Architecture

```
EventBridge Scheduler (per-env schedule)
  → Step Functions Standard state machine (watchog-agent)
      1. Cost gate + plan
      2. Catalog scan  → snapshot every published county (ElephantDataGateway)
      3. Change detect → diff snapshot vs last stored snapshot
      4. Generate      → deterministic fact recipes produce candidate + number
      5. Verify (gate) → re-run query at pinned revision, build evidence manifest
      6. Review        → create Asana approval task, WaitForTaskToken
         (Asana webhook → single Chat SDK Lambda → SendTaskSuccess/Failure)
      7. Re-verify     → confirm revision unchanged
      8. Publish       → GitHub App content-only PR (no merge)
      9. Reconcile     → detect merge/deploy, mark published
```

One Lambda hosts the Chat SDK (`@soofi-xyz/chat-adapter-asana` + `AsanaChatWebhook`) and the bounded AI editorial turn. Durable state lives in DynamoDB (the fact ledger, snapshots, evidence, PR ids) and is kept separate from Chat SDK state. AgentCore Memory holds only reviewer conversation/revision context.

## Phases

Follow in order; each phase gates the next.

### Phase 1 — Establish the data contract

Confirm server-to-server access to the production, Vercel-hosted Elephant MCP that Donphan already uses (URL, auth, rate limits), plus a way to enumerate published counties. `getOracleDatasetInfo(county)` reports one named county but cannot enumerate newly published counties, so pair it with the Oracle coverage feed; the bundled Cursor MCP map is a developer convenience only. If that access is not yet available, STOP and hand the human the exact ask (see `rules/catalog-dataset-monitoring.md`). You may still scaffold code and tests against fixtures.

### Phase 2 — Data gateway and change detection

Implement the read-only `ElephantDataGateway` and snapshot/diff logic per `rules/catalog-dataset-monitoring.md`.

### Phase 3 — Fact recipes and the evidence gate

Build the versioned recipe catalog, the hero-fact rendering form, and the immutable evidence manifest per `rules/fact-recipes-and-evidence.md`.

### Phase 4 — Asana approval

Model the review ledger and approval authorization per `rules/approval-asana-review.md`.

### Phase 5 — Content-only GitHub publish

Freeze the approved payload and open a content-only PR per `rules/publish-github-content-pr.md`.

### Phase 6 — Reliability, observability, and verification

Wire rate limits, retry/DLQ, metrics, PagerDuty, tests, and end-to-end verification per `rules/operations-reliability-and-verification.md`.

## Hero-fact shape (site contract)

Every fact renders as: **location lead → numerical statistic ($, %, or count) → concise description.** Match the current site form:

- location: `In Lee County, FL`
- statistic: `511695`
- description: `properties exist on the county's 784 square miles of land.`

Inspect the attached elephant.xyz website checkout to confirm the exact content file, schema, tests, preview/deploy signal, and rollback path before coding the adapter — do not guess.

## Rules Summary

| Rule | File | Impact |
| --- | --- | --- |
| Dataset catalog, gateway, change detection | `rules/catalog-dataset-monitoring.md` | CRITICAL |
| Fact recipes, calculation, evidence gate | `rules/fact-recipes-and-evidence.md` | CRITICAL |
| Asana approval state model | `rules/approval-asana-review.md` | CRITICAL |
| Content-only GitHub publish + rollback | `rules/publish-github-content-pr.md` | CRITICAL |
| Reliability, observability, verification | `rules/operations-reliability-and-verification.md` | HIGH |
