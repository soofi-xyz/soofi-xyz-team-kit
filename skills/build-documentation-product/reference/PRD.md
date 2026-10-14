# Documentation product contract

Treat this contract as required product behavior, not proof of an existing API
or deployment. Discover current support and implement only the authorized scope.
Use **Documentation** as the product name. Keep Site and Document distinct.

## Outcome and users

Help product authors publish accurate documentation and developers discover,
understand and try product APIs. Deliver a reusable publishing/content service
and configurable React portal. Use product configuration to publish another
product's documentation without forking the runtime or hardcoding its pages.

Explain the product with this example: submit a synthetic Inventory OpenAPI
definition, overview, icon and quickstart; obtain a publication ID; inspect its
status; find Inventory in navigation; read an endpoint; run its example against
an authorized fake API; download a matching guide or collection when supported.

```text
OpenAPI + metadata + overview + guides + assets
                   |
        Documentation HTTP API / tRPC
                   |
      validation -> publication work -> versioned content
                                          |
                        React portal + examples + downloads
                                          |
                      explicit trial -> selected product API
```

## Architecture

Load [engineering guidelines](../../apply-engineering-guidelines/SKILL.md) and
[build-frontend-backends](../../build-frontend-backends/SKILL.md). Use React and
strict TypeScript, pnpm/Turborepo, shared contracts and tRPC clients, Zod inputs,
Amplify frontends and CDK-managed Lambda/API Gateway. Read the relevant rule files
before implementing a feature. The historical repositories are behavior sources;
do not adopt their Python backend, JavaScript app or Serverless Framework stack.

Use tRPC for Documentation's application communication. Distinguish that API from
the OpenAPI descriptions of downstream products: publishing a REST product's
documentation does not require converting that product to tRPC. Expose documented
HTTP submission/status/results for publishers and content consumers. If a REST
compatibility adapter is needed, share authorization, validation and service logic
with tRPC and test both surfaces against the same outcomes.

Apply asynchronous boundaries to slow imports, conversions and external work with
retries or side effects. Return a correlation/publication ID and observable status
and results. Keep interactive reads and trial calls bounded with documented
timeout/recovery. Apply the engineering skill's tests, CI, Powertools, registered
metrics/dashboard, critical-failure alerts and self-resolving DLQ alarm requirements.

## Content and lifecycle

- Define product identity, family/category/component ordering, endpoint identity,
  supported OpenAPI versions/extensions and bundle layout. Distinguish standard
  OpenAPI fields from optional navigation metadata. Validate references and report
  unsupported features rather than silently omitting them.
- Define a publication record with source provenance, immutable content identity,
  configuration/schema version, status, diagnostics and result/asset references.
  Make intake, status and result retrieval independently inspectable.
- Distinguish accepted, processing, ready/published, rejected, failed and superseded
  outcomes in the implemented contract; document actual status names. Do not
  prescribe legacy status spellings as a new implementation requirement.
- Make preview and active content separate selections. Define access, expiration,
  activation, replacement, multi-spec merge, rollback and removal semantics before
  exposing those operations. Preserve active content when a candidate fails.
- Derive navigation, endpoint reference, overview, guides, request examples and
  collection exports from the selected publication. Include source/version identity
  in results. Prevent mixed-version views and stale export selection after updates.
- Define asset handling and safe Markdown/HTML rendering. Resolve media references,
  surface missing assets and reject executable content. Support guide listing,
  basic discovery and documented download formats; test PDF output visually.

## Developer experience

Render methods, paths, authentication requirements, parameters, nested schemas,
responses, examples and deprecation status. Keep the same endpoint/request model
for reference pages, trial requests, code examples and exports. Test actual
serialization of selected parameters, JSON/SQL/binary bodies and content types.

Make trial destination/environment and credential scope explicit. Obtain identities
and keys through the existing Account flow. Require a user action to send a trial;
rendering a page must not execute it. Use synthetic requests for demonstrations,
surface errors/timeouts and keep secrets out of logs, stored content, shared code
snippets and downloadable collections. Do not adopt legacy browser credential
persistence or credential-logging behavior without an explicit supported design.

Configure branding, welcome/family pages, navigation and supported content blocks
through validated settings. Include loading, empty, missing-content, unauthorized
and upstream-failure states. Verify keyboard use and responsive layout for the
requested pages. Add a CMS adapter only when a requested outcome needs it and its
contract is verified; do not make DatoCMS a prerequisite for the core product.

## Ownership and acceptance

Own documentation content and its presentation. Use Model's product identities or
schema vocabulary where supported, without redefining their semantics. Treat the
historical navigation "ontology" as product ordering, not Model governance. Keep
Account identity/key management and Console's reusable business application runtime
with their owners. Keep Build packaging, Marketplace bundle publication, Environment
first installation and Deploy subscriptions/updates with those products.

Treat pricing, sales/support tickets, attachments and marketing as optional external
adapters. Do not build pricing, CRM or general workflow engines as Documentation
features. Verify the missing historical `site-tech-api` contract before reusing it.

Use [the capability map](../../guide-product-work/reference/iterations/documentation.md)
and [acceptance scenarios](test-data.md). Test API, browser, artifact and telemetry
behavior together inside each feature. Apply the shared user-run/AWS checkpoint
before advancing; run cumulative acceptance for the requested feature set. Do not
claim deployment from source files, synthesis, mocks or a successful configuration
validation alone.
