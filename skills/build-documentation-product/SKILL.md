---
name: build-documentation-product
description: "Build or maintain Documentation's publishing API and React/TypeScript developer portal, including OpenAPI reference, guides, previews, interactive requests and exports. Use Unown; use Togetic to configure an existing deployment."
---

# Build Documentation

Use `unown`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Documentation capability map](../guide-product-work/reference/iterations/documentation.md),
[apply-engineering-guidelines](../apply-engineering-guidelines/SKILL.md) and
[build-frontend-backends](../build-frontend-backends/SKILL.md) before architecture
or implementation. Keep **Documentation** as the canonical product name; do not
rename Site or Document. Use `togetic` with
[configure-documentation-product](../configure-documentation-product/SKILL.md)
for a particular publication or portal configuration on an existing deployment.

## Establish the implementation contract

Read [the product contract](reference/PRD.md),
[source evidence and gaps](reference/source-evidence.md) and
[acceptance scenarios](reference/test-data.md). Discover the target repository,
revision, supported APIs/authentication, deployed resources and selected AWS
profile. Verify account and region. Keep proposed behavior, source implementation
and observed runtime results distinct.

Require the following application architecture from the shared skills:

- Use **React and strict TypeScript** for the portal, APIs, workers, shared
  packages and infrastructure. Preserve behavior from historical sources without
  adopting their Python, JavaScript or Serverless Framework implementation.
- Use **pnpm and Turborepo**, with frontend apps and the API under `apps/`.
  Centralize contracts, tRPC clients, schemas and reusable logic in `packages/`.
  Add another frontend only when a distinct user-facing application needs it.
- Use **tRPC over HTTPS**, Zod validation and a shared typed client. Run the
  backend on Lambda behind API Gateway. Keep submission/status/results usable
  by external callers through a documented HTTP contract; implement any required
  compatibility adapter over the same service logic, not a second backend.
- Host each frontend on **Amplify** and define product infrastructure in **CDK**.
  Load relevant fullstack rule files for monorepo, tRPC, shared packages, hosting
  and CDK. Treat example domains and resource names as examples; discover actual
  environment values. Keep Build/Marketplace/Deploy integration explicit.
- Apply the engineering skill's linting, formatting, `tsc`, Vitest, GitHub Actions,
  Powertools, tracing, registered metrics, dashboards, critical-failure alerting
  and DLQ monitoring requirements. Queue external or slow publication work with
  bounded concurrency, idempotency and recovery. Document timeout/recovery for
  synchronous interactive requests. Use the Vercel AI SDK only if LLM work is
  separately in scope; do not add AI features merely to satisfy the stack.

Do not assume the reviewed `site-tech-ui` can call `documentation-lambda-api`
unchanged. Locate and inspect `site-tech-api`, or define and test an explicit
Documentation adapter/replacement contract. Do not require the historical repos
as external runtime dependencies of a newly built product.

## Build feature increments

1. Select stable feature IDs from the capability map and order dependencies.
   Keep at least four usable increments for full-product work, expanding the map
   when independent capabilities need separate demonstrations. Scope a fix to
   its relevant features. Explain one input/output example and a small diagram.
2. Bring the minimum API, UI, configuration and authorized test deployment needed
   for the next feature into the same increment. Apply the fullstack skill's
   setup/backend/client/frontend/infrastructure phases inside that increment;
   do not prebuild the whole product before the user can exercise it.
3. Define publication identity and a common content model before deriving
   navigation, references, guides, examples or exports. Make every representation
   traceable to the same selected publication. Test replacement versus multi-spec
   merging explicitly; keep last-known-good content when validation fails.
4. Test a baseline and materially different supported configuration plus invalid,
   unauthorized and relevant recovery cases. Use the synthetic scenarios and
   dependency fakes first. Check browser results, API status/results, generated
   artifacts and correlated AWS evidence together. Validate generated examples
   against the actual request they claim to represent.
5. Give one copyable API invocation/fixture, expected output and at most three
   AWS inspection steps with verified resource names. Have the user run the
   baseline and variant, inspect state/logs and return redacted IDs and an
   observation. Wait for that evidence before implementing the next increment.
6. Run cumulative acceptance after the selected features. Report source/local
   checks, infrastructure synthesis, deployed mocks and real integrations
   separately. Use live dependencies only within the authorized scope.

Follow the shared workflow's rule for explicit user changes to its checkpoint
requirement; do not infer an override from expertise or a generic continuation.

Keep identity with Account, vocabulary/schema semantics with Model, reusable
business applications with Console, packaging with Build, bundle review with
Marketplace, first installation with Environment and ongoing installation and
subscriptions with Deploy. Treat pricing, tickets, attachments, marketing and
CMS connections as separately scoped adapters, not default requirements.

Return changes, supported configuration/API examples, automated and user evidence,
AWS observations, cleanup and gaps. Keep reusable implementation in its target
product repository; keep this kit focused on guidance and acceptance contracts.
