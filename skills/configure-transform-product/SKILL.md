---
name: configure-transform-product
description: "Author and verify language-pair mappings for an existing Transform engine, including formats, SQL, typed outputs and graph identities. Use Silvally; use Kecleon for engine changes."
---

Use [the Transform capability map](../guide-product-work/reference/iterations/transform.md). Derive the feature pieces from scope and dependencies, then apply the work below within each piece; require a user-run configuration, AWS inspection and feedback before starting the next implementation piece.

# Configure Transform

Use `silvally`. Follow [guide-product-work](../guide-product-work/SKILL.md).
Read the relevant references in [build-transform-product](../build-transform-product/SKILL.md):
`languages-and-mappings.md`, `formats-and-execution.md`, `graph-mappings.md`
when applicable, and `operations-and-verification.md`.

1. Discover the existing engine, source/target definitions, mapping and publication
   mechanism. Distinguish a requested mapping change from an engine defect.
2. Explain a small source/target example. Establish expected values independently
   of generated SQL. Include missing/null values, wrong types and graph references
   when applicable.
3. Author a versioned directional SQL mapping using the existing contract. Keep
   formats, delimiters, sheets and output shape in the mapping. Requests name
   `from`, `to`, S3 locations and optional cost ceiling; do not invent a separate
   Translate registry or inline JSON preview API.
4. Validate definition-derived types, declared graph roles, stable IDs and edge
   endpoints. Pin artifacts through the governed catalog; do not mutate a moving
   alias underneath an admitted execution.
5. For each implementation iteration, guide the person through its fixture/dev
   run, output-manifest inspection and correlated AWS logs. For a test-only
   request, use existing authorized configurations without editing or publishing.
   Compare fields, counts, types and failure cases. Report configuration validity,
   publication and actual execution separately.
6. For test-only requests, return defects without editing mappings. For an
   authorized mapping fix, preserve the independent test expectation. Route
   unsupported engine behavior to `kecleon` with reproducible evidence.

Return pair/mapping versions, diff, field-level results, output pointers,
measured cost where available, human observations and outstanding defects.
