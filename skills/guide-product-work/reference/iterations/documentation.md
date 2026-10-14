# Documentation capability map

Use Unown to implement Documentation and Togetic to configure existing features.
Follow the [shared workflow](../../SKILL.md),
[engineering guidelines](../../../apply-engineering-guidelines/SKILL.md) and
[React/TypeScript/tRPC fullstack skill](../../../build-frontend-backends/SKILL.md).
Treat this map as a feature inventory, not a fixed iteration count. Retain at
least four increments for full-product work; split independent features further
and scope narrow requests to relevant capabilities. Record reasons for deferrals.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `openapi-intake` — submit an API definition | Verified product identity, authentication and API contract | Deliver validated OpenAPI intake and actionable diagnostics; exercise two product definitions and an invalid reference. | Inspect correlated API validation/result records; prove invalid input cannot replace selected content. |
| `bundle-intake` — submit packaged documentation | OpenAPI intake and declared bundle layout | Deliver artifact intake with overview, media and guide discovery; exercise a complete bundle, optional missing content and an invalid manifest. | Trace artifact identity and extraction result; verify only accepted assets belong to the publication. |
| `publication-jobs` — follow slow publishing work | Intake contract | Deliver queued processing, HTTP submission/status/results, idempotency and bounded recovery; exercise repeated submission and a failed fetch/export. | Compare job ID, worker state, artifact results and queue/DLQ evidence; distinguish accepted from completed. |
| `product-navigation` — find a product and endpoint | Accepted product metadata | Deliver family/category/product/component ordering and stable endpoint URLs; exercise reordered products, duplicate identities and multiple specifications for one product. | Inspect selected catalogue/publication identity; compare portal navigation and content API results without duplicate or stale entries. |
| `api-reference` — inspect a complete endpoint | Published definition and navigation | Deliver schemas, parameters, auth, responses, examples and explicit deprecation policy; exercise nested schemas, different methods and unresolved references. | Compare rendered reference and served OpenAPI against the same selected publication; inspect errors with the request ID. |
| `overview-assets` — read a product overview | Bundle intake and asset contract | Deliver safe Markdown/HTML rendering and media resolution; exercise two overviews, missing images and disallowed executable content. | Inspect stored asset identifiers and portal loads; verify failure diagnostics and no active script execution from content. |
| `learning-guides` — find and download instructions | Overview/assets and published content | Deliver guide listings/search and Markdown/HTML/PDF forms; exercise multiple guides, a no-result search and a failed conversion. | Compare rendered guide and download publication IDs; verify a conversion failure is visible and cannot silently produce a complete result. |
| `interactive-requests` — run an example | API reference, verified test endpoint and auth flow | Deliver explicit environment selection, request editing and response inspection for supported JSON/SQL/binary bodies; exercise success, rejection, timeout and a credential change. | Correlate trial and upstream request IDs; verify the selected destination, bounded failure handling and redacted telemetry. |
| `code-examples` — use a generated integration example | Interactive request representation | Deliver language examples from the same request model; exercise cURL and typed JavaScript plus encoded parameters and unsupported serialization. | Compare generated requests with fake endpoint receipts; verify secrets are absent from shared output and parameters/body are preserved. |
| `postman-export` — download a collection | Published OpenAPI and job/result contract | Deliver version-consistent collection generation/download; exercise two products, an update and conversion failure. | Trace export job and selected source digest; verify a download parses/imports and uses the same definition as the portal. |
| `portal-configuration` — change presentation without bespoke code | Content API, reference and guide features | Deliver validated React portal configuration for branding, welcome/family pages, navigation and content blocks; exercise two configurations and an unsupported block. | Inspect selected config/runtime versions and Amplify/browser results; verify the shared tRPC client and no rebuild for supported content-only changes. |
| `preview-selection` — review and select a publication | Publication content model and portal | Deliver preview, explicit publication selection, replacement/merge policy and supported rollback/removal; exercise draft isolation, activation, invalid update and restoration. | Compare preview/active publication IDs and all derived outputs; prove draft access rules and previous-content preservation on failure. |
| `product-delivery` — operate the complete product | Selected feature acceptance and delivery contracts | Deliver Build-ready source/provenance, Marketplace metadata, Deploy-compatible assets, health and diagnostics; exercise fresh installation and a content update on the same runtime. | Inspect actual Amplify, API Gateway/Lambda, CDK and delivery evidence separately; verify registered metrics/alerts and account/region without claiming upstream readiness. |

Read [the product contract](../../../build-documentation-product/reference/PRD.md),
[source evidence](../../../build-documentation-product/reference/source-evidence.md)
and [synthetic scenarios](../../../build-documentation-product/reference/test-data.md).
Establish a basic publication/result contract in the first usable path; extend
slow work through `publication-jobs` as dependencies require. Apply the fullstack
skill's technical phases within each feature. Do not use them to defer all
browser/API acceptance until the whole backend and UI have been implemented.

Demonstrate each selected feature with a baseline, a materially different supported
configuration and relevant negative/recovery cases. Supply one real invocation,
expected result and at most three AWS inspection steps. Have the user run it,
inspect state/logs and report redacted IDs and observations before the next piece.
Keep schema validity, local tests, synthesis, deployed mocks and live integrations
as separate evidence levels. For a fixed configuration, vary supported inputs
instead of inventing another configuration surface.

Keep Site and Document unassigned and separate. Keep Model vocabulary, Account
identity, Console business applications and delivery-product responsibilities
with their owners. Scope pricing, ticketing, attachments, marketing and CMS
adapters separately only when requested; verify their external APIs first.
