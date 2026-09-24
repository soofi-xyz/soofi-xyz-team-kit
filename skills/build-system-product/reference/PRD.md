# System composition — product contract

Build a **System** as a versioned composition of existing Products that delivers
one declared business outcome. This is Prism ontology **Priority 4** (System):
compose Lexicon, Connect, Transform, Deploy (and related Products) rather than
shipping another standalone ETL engine.

This skill is a specification and agent contract. Presence of Zygarde /
`build-system-product` does **not** mean a deployable System runtime already
exists in any organization repository.

## 1. Ownership and boundaries

```text
Business outcome
  → Zygarde composition.manifest (products, configRefs, workflow, successCriteria)
  → emit reviewable Lexicon / Connect / Transform / Deploy artifacts
  → Unown/Conkeldurr, Lapras, Kecleon, Conkeldurr implement product configs
  → optional thin System package (API/OpenAPI/fixtures) in a target repo
  → curated artifacts satisfy lookup or workflow success criteria
```

| Owns | Does not own |
| --- | --- |
| Outcome statement and success criteria | JDBC/Spark Connect adapters |
| Product set and ordering | Transform Glue/PySpark engines |
| Composition manifest and emit stubs | Lexicon store / IPFS publication internals |
| Thin System API contract (when building a package) | Marketplace registration by default |
| Failure taxonomy for unknown inputs | Live website scraping unless an adapter exists |

## 2. Prism §4.14 responsibilities (summary)

- Accept requirements that need more than one Product.
- Produce a reviewable composition (manifest + config refs), not ad-hoc scripts.
- Delegate product implementation to the correct specialists.
- Keep System runtime thin: validate input, read curated outputs, return typed
  results with evidence/source pointers where required.
- Keep activation **inactive by default** for CDK stubs (Conkeldurr posture).

## 3. Priority 4 placement

| Priority | Layer | Examples in this kit |
| --- | --- | --- |
| Lower | Products | Lexicon, Connect, Transform, Persist, Deploy |
| **4** | **System** | Composed outcomes (e.g. sale-availability lookup) |

Do not collapse System work into Connect or Transform skills. Do not invent a
fourth Spark pipeline under System.

## 4. Non-goals

- Live scrape-on-request as the default System path
- Full AWS Glue pilot evidence from composition alone
- Marketplace / Regigigas registration unless explicitly requested
- Claiming System product code existed before a target-repo build
- Replacing partner Connect service (`build-connect-service`) routes

## 5. Success definition for composition work

Composition is done when:

1. Manifest validates against `composition.manifest.schema.json`.
2. Every product in `products[]` has a matching `configRefs` entry or an
   explicit deferred stub with owner and follow-on story.
3. Emit artifacts name Lapras / Kecleon / Conkeldurr (Lexicon) owners.
4. Success criteria are testable without claiming unbuilt runtimes.

A System **package** (API + fixtures) is a separate target-repo story and is
out of scope for kit-only Story A work.
