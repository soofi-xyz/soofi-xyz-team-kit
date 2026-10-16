# Source evidence and implementation gaps

Use this reference to establish behavior and avoid inheriting unsupported claims.
Reinspect the target revision before implementation. Discover repositories from
the user's workspace or supplied locations; do not require a developer-specific
absolute path or a clone of historical sources as a runtime prerequisite.

The 2026-10-07 review inspected local `site-tech-ui` at `7797b98` (2024-05-17)
and `documentation` at `3b9b3c7` (2022-04-10). Treat these as evidence snapshots,
not live deployments. The user named the new product **Documentation** and required
the engineering and React/TypeScript/tRPC fullstack skills. Follow those stack
requirements when rebuilding behavior from the historical sources.

| Evidence to inspect | Supported conclusion / boundary |
| --- | --- |
| `site-tech-ui/src/App.js`, `src/api.js` | Find product/navigation/reference/guide routes. Observe that the UI calls `/site-tech-api/tech/*`; this separate backend was absent from the supplied projects. Do not treat `documentation-lambda-api` as an interchangeable service. |
| `site-tech-ui/src/components/Endpoint/index.js`, `TryItOut/index.js`, `src/TryOutEndPoints/TryOutEndPoints.js` | Reuse the capability model of schema/reference rendering and editable API trials, including JSON/SQL/binary input. Revalidate request serialization, environment selection, auth and error behavior. |
| `site-tech-ui/src/components/CodeGeneration/CodeGeneration.js`, `ProductPostmanAlert/index.js` | Treat multilingual snippets and Postman downloads as intended capabilities; verify generated requests and actual export plumbing rather than counting components as proof of success. |
| `site-tech-ui/src/components/QuickstartGuides/index.js`, `QuickStartComponent/index.js` | Observe guide listing, filtering and rendering through the missing facade. Verify its response shape or supply an explicit new contract. |
| `site-tech-ui/src/components_DatoCMS/`, `src/components/PolymorphousContent/` | Use configurable presentation/content blocks as direction. The welcome CMS fetch is commented out; do not assume a complete CMS integration. |
| `site-tech-ui/src/components/Product/index.js`, `ProductRequestForm/index.js`, `src/api.js` | Observe pricing/request/attachment code and commented-out product presentation. Scope these as optional integrations; their backend is not supplied. |
| `documentation/service.yml`, `documentation_api/serverless.yml` | Identify the separate Documentation HTTP surface: publication, status, ontology/navigation, content, OpenAPI, guides and collections. Treat the commented web module as absent, not a second verified UI. |
| `documentation_api/src/handlers/publish_product_handler.py`, `publish_worker_handler.py`, `get_publish_handler.py` | Observe artifact or Swagger intake, publication records, status/results and processing. The submission handler calls the worker synchronously despite a separate worker resource; design the new async contract explicitly. |
| `documentation_api/src/services/publisher.py`, `src/handlers/publish_ontology_handler.py` | Observe metadata-derived navigation, asset uploads, overview conversion and Markdown/HTML/PDF guides. Keep navigation ontology distinct from Model's schema/lexicon responsibilities. |
| `documentation_api/src/handlers/publish_worker_handler.py`, `src/services/database.py` | Observe merging of product specifications, selected publication records and superseded content. Define deliberate merge/replacement rules for the new product. |
| `documentation_api/src/handlers/preview_documentation_handler.py` | Treat preview as unfinished: the reviewed source is an empty, unrouted stub. |
| `documentation_api/create_postman_collection.js`, `src/handlers/publish_worker_handler.py` | Reconcile the generator's inline `content_api.openapi` read with the worker's `openapi_url` output before claiming working collection generation. |
| `documentation_api/requirements/overview.md`, `src/services/publisher.py` | Reconcile documented deprecation filtering with actual traversal before promising hidden deprecated operations. Define a tested deprecation policy. |
| `site-tech-ui/cypress/e2e/main_page_spec.cy.js` | Replace the always-passing smoke scenario with actual publish-to-portal acceptance in the target implementation; its presence is not end-to-end evidence. |

Keep this reference focused on requirements and concrete gaps. Use Git history for
superseded behavior rather than copying old implementations into the kit. Do not
contact listed legacy people, use historical API keys or invoke old environments
without the user's current task requiring and authorizing that access.
