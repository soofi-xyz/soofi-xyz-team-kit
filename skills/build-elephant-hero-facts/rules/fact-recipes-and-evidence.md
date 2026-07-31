---
title: Fact Recipes, Calculation, and the Evidence Gate
impact: CRITICAL
tags: fact-recipe, deterministic, evidence, verification, hero, coverage, provenance, rounding
---

## Fact Recipes, Calculation, and the Evidence Gate

A hero fact is a public marketing claim. It MUST be accurate, reproducible, and backed by a pinned data revision. The model chooses words; deterministic code owns every number.

### The number never comes from the model

- Compute each numeric value from a deterministic aggregate query result via the `ElephantDataGateway`.
- Use a Bedrock model (Vercel AI SDK, per `apply-engineering-guidelines`) only to draft bounded **editorial variants** of the description around the immutable value.
- The model receives the finished number, unit, location, and allowed wording; it never receives raw SQL access and never supplies, recomputes, or "adjusts" a figure.

### Versioned fact-recipe catalog

Facts are produced only from an explicit, versioned recipe catalog — not from open-ended model prompting. Each recipe defines:

- `recipeId`, `recipeVersion`
- `locationScope` — county or state (for example `lee` → "In Lee County, FL"; statewide → "In the state of Florida")
- `requiredCoverage` — which sources must be complete for the recipe to be eligible
- `query` — a single deterministic aggregate query (numerator, and denominator when it is a ratio)
- `unit` — `currency` ($), `percent` (%), or `count`
- `rounding` — explicit rounding/format rule (for example whole dollars, one decimal percent, exact integer count)
- `allowedWording` — the sentence template(s) the description may use
- `freshness` — maximum data age allowed before the fact is considered stale
- `noveltyThreshold` — how much the value must differ from the last published fact for this recipe/location before it is worth proposing

### Hero-fact rendering form

Render every candidate as **location lead → numerical statistic → concise description**, matching the current site form:

- `In Lee County, FL` · `511695` · `properties exist on the county's 784 square miles of land.`

Confirm the exact content file and schema from the attached elephant.xyz website checkout. Keep the statistic a bare, correctly formatted value ($, %, or count). Do not embed the number inside prose the model wrote.

### Default fact policy

- **Aggregate-only.** No PII and no individual-property or individual-business facts.
- **Complete, compatible coverage.** Every source the recipe uses must meet `requiredCoverage`; partial coverage produces a non-fact outcome, not a hedged claim.
- **Explicit freshness label.** Each fact carries the data date/period it reflects.
- **No unsupported comparison or superlative language** ("most", "fastest-growing", "more than any other") unless the recipe includes a deterministic query that proves it. The model may not introduce comparatives.
- **Minimum sample size** where a recipe computes a ratio or average.

### The immutable evidence manifest

For every candidate, persist an append-only evidence manifest (never mutated after write):

```
candidateId, datasetRevision, locationScope,
metricDefinition, value, unit, denominator, scope, timeBoundary,
recipeId, recipeVersion, queryText, parameters, canonicalResult, resultHash,
dataReadAt, sourceFingerprint,
verificationOutcome, verifiedAt
```

### The double evidence gate

Verify **twice** — once before creating the Asana review task, and again immediately before opening the PR:

1. Confirm `requiredCoverage` is met and compatible.
2. Re-run the recipe query against the **recorded `datasetRevision`**. If the revision changed since the candidate was drafted, mark the candidate `stale` and require a fresh candidate/approval — do not publish.
3. Recompute the value and compare `resultHash`. Any mismatch fails the gate.
4. Confirm the rendered wording uses only `allowedWording` and introduces no numbers or comparatives beyond the verified claim.

Only a candidate that passes both gates may move toward publish.

### ✅ Correct

```typescript
const result = await gateway.runRecipe(recipe, { countyKey }); // deterministic value + revision + hash
const fact = renderHeroFact(recipe, result); // location + value + allowed description
const draft = await model.draftDescriptionVariants(fact.description, recipe.allowedWording); // wording only
// re-verify at the pinned revision immediately before any side effect
assertRevisionUnchanged(result.datasetRevision, await gateway.currentRevision(countyKey));
```

### ❌ Incorrect

```typescript
// Letting the model produce or "estimate" the number, or adding a superlative it cannot prove.
const fact = await model.generate(`Write a punchy stat about ${countyKey} property data`);
// e.g. "the fastest-growing county in Florida with over 500k+ homes" — unverifiable, forbidden.
```

### References

- `skills/apply-engineering-guidelines/rules/stack-ai-sdk-for-llm.md` — Vercel AI SDK, Zod, no `any`
- `skills/build-batch-workflows/rules/principle-input-validation.md`
- `skills/build-batch-workflows/rules/principle-response-validation.md`
