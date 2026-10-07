# Documentation acceptance scenarios

Use synthetic product content and fake dependencies while implementing each feature.
Create fixtures in the target product repository to its actual schemas. Do not
present the illustrative names or operations below as existing deployed routes.

## Baseline and variants

- Define **Sample Inventory** with `GET /items/{itemId}`, a required string path
  parameter, optional `locale` query parameter, example response, overview, icon
  and "Fetch an item" guide. Place it under a synthetic product family/category.
- Define **Sample Orders** with `POST /orders`, nested line-item input, a required
  field, an example validation error and different navigation/branding settings.
  Keep credentials and customer data out of all fixture files.
- Add a second specification to Sample Inventory with a different operation.
  Exercise explicitly selected merge and replacement policies and a duplicate
  operation identity. Define which behavior is supported before writing assertions.
- Add candidate revision B changing an endpoint description, example and guide.
  Keep A selected during preview; select B; verify all derived outputs agree;
  restore A if rollback is supported. Reject malformed revision C without changing
  the selected content. Test configured deprecation behavior on another operation.

## Feature cases

| Feature | Observable acceptance |
| --- | --- |
| Intake and jobs | Submit both products by supported OpenAPI/bundle paths. Retrieve publication/status/results over HTTP. Reject malformed metadata, unresolved references and invalid bundle structure. Retry a submission and interrupt a fake fetch; verify defined idempotency and bounded recovery. |
| Navigation and reference | Find both products and their operations using their configured order/URLs. Compare parameters, nested schemas, authentication, responses and examples to the selected definition. Verify missing operations and invalid links show explicit states. |
| Overview/assets/guides | Render overview and local media references, find a guide by name/product, download each supported format and compare its publication identity. Inspect generated PDF pages. Exercise missing images, empty search and failed conversion. |
| Trial requests | Use a fake endpoint that records method, URL, redacted headers and body. Compare JSON, SQL and binary cases only where supported. Verify no request occurs before an explicit send; test changed environment/credentials, validation error, non-JSON response, empty response and timeout. |
| Code examples | Run supported generated cURL and typed JavaScript against the fake endpoint. Compare receipts with the trial request, including escaped path/query values, body and content type. Verify exported examples contain placeholders rather than credential values. |
| Postman | Parse/import the generated collection and compare operations, request bodies and selected publication identity. Change the definition and verify the regenerated download. Simulate conversion failure and verify an explicit failure/result contract. |
| Portal configuration | Display two different branding/navigation/content configurations on the same runtime. Test keyboard navigation, requested mobile/desktop layouts, loading/empty/error states, unsupported content blocks and rejected executable content. |
| Preview and selection | Verify draft access, active/public isolation, consistent activation and documented merge/removal behavior. Reject unauthorized publication/selection. Preserve A when C fails, and verify supported restoration without mixed-version downloads. |
| Delivery | Verify actual frontend/backend artifact identities, API health and account/region. Trace a publication through its worker and selected assets, check required telemetry and alert wiring, and distinguish installation from content updates. |

## Dependency fakes and evidence

Use fake artifact fetches, controlled PDF/Postman conversion outcomes, a recording
product API and an identity adapter returning known allow/deny decisions. Make
failure injection deterministic. Implement fakes at public boundaries; do not
substitute internal storage writes for a publishing API test.

For each selected feature record its ID, baseline/variant configuration, supported
schema/version, input identity, redacted publication/request IDs, API outcomes,
browser observations, artifact identity and AWS state/log references. Have the user
run the current baseline and variant, inspect the named AWS evidence and report
their observation before advancing. Keep local fixture tests, synthesis, deployed
fakes and authorized live dependencies as distinct evidence levels.
