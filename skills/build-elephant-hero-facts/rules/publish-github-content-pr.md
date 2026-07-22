---
title: Content-Only GitHub Publishing and Rollback
impact: CRITICAL
tags: github-app, pull-request, content-only, no-auto-merge, idempotency, rollback, deploy-signal
---

## Content-Only GitHub Publishing and Rollback

Watchog publishes by proposing a change, never by writing to production. The only publish path is a **content-only GitHub pull request** against the elephant.xyz website repository. A human reviews and merges; the site's existing deployment ships it.

### Freeze before publish

When an approval passes final re-verification, freeze the approved payload: the exact location lead, statistic, description, `datasetRevision`, fact fingerprint, evidence manifest reference, and approver identity. The PR is built only from this frozen payload — never re-drafted, never re-queried for new wording.

### GitHub App, not a developer token

- Use a **GitHub App** installed **only** on the website repository.
- Grant **contents write + pull-requests write**; grant **no merge and no admin** rights.
- Store the App private key in Secrets Manager; never in code, SSM plaintext, or the Asana task.
- Keep branch protection on the base branch enabled so a human must review and merge.

### Discover the hero-content adapter

Inspect the attached elephant.xyz website checkout (`/Volumes/mrnda 2tb/elephant/website`) to determine and validate, before coding the adapter:

- the exact hero-content file and its schema (do not guess the shape)
- the base branch and branch-naming convention
- the preview/deploy signal (for example Vercel deployment status or the site's CI check)
- the rollback path (revert the content commit)

The adapter changes **only** the identified hero-content file. It must never touch build config, secrets, workflows, or unrelated content.

### Open the PR

- Create a branch from the base branch and commit only the frozen hero-content change.
- Open a PR whose body includes the Asana task link, fact fingerprint, `datasetRevision`, evidence summary, and approver.
- Use an **idempotency key** derived from `candidateRevision + fingerprint`. If a PR already exists for that key, reuse it — never open a duplicate.
- Do **not** auto-merge, enable auto-merge, or request self-approval.
- Mark the ledger `publishing` with the PR number/URL.

### Reconcile merge and deploy

- Detect merge and deployment success through the site's **existing** CI/deploy signal — do not invent a deploy mechanism and do not poll production destructively.
- On merged + deployed, mark the ledger `published` and record the merged commit + deployment id.
- On PR-creation failure or a failed deploy signal, mark `publish_failed`, emit `HeroFactFailed`, and page (see `operations-reliability-and-verification.md`).

### Post-publish verification

After the deploy signal reports success, read the live hero and confirm it **exactly** matches the frozen approved payload (location, statistic, description). A mismatch is a `publish_failed` condition, not a silent pass.

### Rollback

Roll back by reverting the content commit through the same GitHub App (a new revert PR or, where policy allows, a direct revert commit on a protected-branch-exempt path is not permitted — always go through a PR). Record who initiated rollback and why in the ledger. Never mutate production content outside Git.

### ✅ Correct

```typescript
const key = idempotencyKey(candidate.revision, candidate.fingerprint);
const existing = await github.findPrByKey(key);
if (existing) return existing; // reuse, never duplicate
const branch = `watchog/hero-${candidate.countyKey}-${candidate.revision}`;
await github.commitContentOnly(branch, heroContentFile, frozenPayload);
const pr = await github.openPr({ branch, base, body: prBody(candidate) }); // no auto-merge
await ledger.markPublishing(candidate.id, pr.number);
```

### ❌ Incorrect

```typescript
// Writing straight to the CMS/database, or auto-merging the PR.
await cms.updateHero(frozenPayload);            // forbidden: not content-only, not reviewed
await github.mergePr(pr.number);                // forbidden: no human review, bypasses branch protection
```

### References

- `agents/lucario.md` — PR-first configuration publishing precedent
- `skills/build-batch-workflows/rules/principle-response-validation.md`
- `skills/babysit-release/SKILL.md` — merge/deploy babysitting patterns
