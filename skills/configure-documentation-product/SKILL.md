---
name: configure-documentation-product
description: "Configure, publish and test product documentation through an existing Documentation API and portal. Use Togetic for OpenAPI, overviews, assets, guides, navigation, examples and supported publication settings; route implementation gaps to Unown."
---

# Configure Documentation

Use `togetic`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Documentation capability map](../guide-product-work/reference/iterations/documentation.md),
[apply-engineering-guidelines](../apply-engineering-guidelines/SKILL.md) and
[build-frontend-backends](../build-frontend-backends/SKILL.md). Read the relevant
[product contract](../build-documentation-product/reference/PRD.md),
[source evidence](../build-documentation-product/reference/source-evidence.md)
and [acceptance scenarios](../build-documentation-product/reference/test-data.md).

Use the engineering and React/TypeScript/tRPC skills to understand supported
contracts, shared clients and verification; their scaffolding/deployment phases
do not authorize runtime changes during configuration. Hand implementation to
`unown` with [build-documentation-product](../build-documentation-product/SKILL.md).

1. Discover the existing deployment/revision, HTTP/tRPC contract, authentication,
   content schema and supported operations. Verify the selected AWS profile,
   account and region. Record missing `site-tech-api` or other adapter dependencies
   instead of treating historical routes as available.
2. Select the requested feature IDs and dependencies. Explain the expected portal
   outcome using synthetic inputs. Use four as a full-walkthrough floor; scope
   narrow publishing requests to relevant features and supported variants.
3. Prepare product metadata, OpenAPI, overview, media, guides and portal settings
   to the deployed schema. Use the existing shared typed client for app/tooling
   changes; do not duplicate API contracts or handwrite another frontend client.
   Validate inputs locally against the deployed schema and inspect diagnostics.
   Use a separate API validation operation only when it exists; do not invent a
   validation route or use a mutating submit operation as a dry run.
4. Honor requested ordering: when the user asks for a preview before publication,
   establish a supported isolated preview first. If preview is unavailable,
   prepare and validate the candidate, report the builder dependency and leave
   publication pending. Do not publish to the active test portal and label its
   URL a preview. Otherwise submit within the authorized scope, retain its ID,
   follow status to the supported terminal
   result and read back the selected revision/assets. Use preview, activation,
   replacement, rollback or deletion only when their contracts are implemented
   and the action is within scope. Treat a submitted request as pending until
   content and status agree.
5. Verify navigation, endpoint parameters/schemas/responses, overview images,
   guide links and supported downloads in the portal. Check that every output
   corresponds to the same publication and that an update has the expected merge
   or replacement behavior. Do not write the product's storage directly.
6. Configure allowed trial environments and authentication through supported
   settings. Use synthetic data and explicit user-triggered sends; keep secrets
   out of content, logs, shared snippets and exports. Compare runnable requests
   with generated examples and show both success and expected API failures.
7. Exercise a baseline and materially different supported configuration, invalid
   input, access denial and relevant refresh/recovery behavior inside each piece.
   Give a copyable invocation and at most three AWS inspection steps, then collect
   the user's redacted IDs and observations before advancing.
8. Leave unavailable features pending with a reproducible builder handoff. Do not
   migrate a legacy backend, invent routes or modify React components to make
   configuration pass. Keep Account, Model, Console and delivery-product ownership
   intact; Documentation is distinct from Site and Document.

Follow the shared workflow's rule for explicit user changes to its checkpoint
requirement; do not infer an override from expertise or a generic continuation.

Return input/configuration artifacts, publication/runtime versions, API and
browser results, automated checks, user/AWS evidence, cleanup and remaining gaps.
