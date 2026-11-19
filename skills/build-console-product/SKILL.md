---
name: build-console-product
description: "Build Console: the shared design system, the kit and checks that keep business apps inside it, app hosting with publish and rollback, each environment's look and components, sign-in and data access for apps, and dashboards. Use Chandelure; use Vivillon to build an app."
disable-model-invocation: true
---

# Build Console

Use `chandelure`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Console capability map](../guide-product-work/reference/iterations/console.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `vivillon` with [configure-console-product](../configure-console-product/SKILL.md)
to build an app or configure an existing Console deployment.

## Read first

- [The product contract](reference/PRD.md): what Console owns, the data path
  and the boundaries with other products.
- [The design system](reference/design-system.md): components, tokens, runtime
  sharing, design-system configuration, component packs and the dashboard
  reskin.
- [The app kit](reference/app-kit.md): the kit, the guardrails, app hosting,
  the data hooks, local development, delivery and the reference app.
- [The sign-in contract](reference/google-sign-in.md): read it before any
  change to pages, components, routes, the shell, app hosting or the web
  runtime, and run its sign-in and route-inventory tests with every such
  change. Sign people in through Access; Console's own `google-oidc` policy is
  existing behavior to migrate away from, not to extend.
- [Synthetic test data and dependency fakes](reference/test-data.md).

Discover the target repository and revision, its supported schema and API, the
deployment and the selected AWS profile; verify the account and region. Record
differences between these contracts and the observed implementation without
inventing deployed routes. As of 2026-11-19 the dashboard renderer, its
configuration API, the `report` / `read-dataset` operation, the design system
(runtime 1.14.0) and the app kit (runtime 1.15.0, pull request 33) exist in
the repository; everything else here is a requirement. The app kit runs and
checks apps locally only: no app can be hosted, published or delivered yet.

## Scope

Deliver one design system that Console serves to every app and dashboard, an
app kit that lets an agent assemble an app from it and nothing else, hosting
for those apps, a per-environment design-system configuration, component packs
for environment-specific components, Access sign-in and a single data path
through Console's API. Keep the dashboard renderer working for existing
dashboards; do not extend the manifest schema for app-like behavior unless the
user asks.

Console owns no authoring runtime. Build no coding agent, authoring job API,
project store or review workspace into it, and no Figma connection. Agents that
author apps or components run on Enact or in an editor; route Enact capability
gaps to `zoroark` and agent configuration to `zorua`.

Keep Access sign-in, roles and permissions, Account identity and keys, Model
definitions and composition, Persist facts and queries, Report queries and
datasets, and System workflows with their owning products. Keep building and
checking sources with Build, catalog review with Marketplace and installation
with Deploy. Integrate only through verified public contracts.

## Pieces, in order

Build one piece at a time. A piece is done only when every test in its table
passes; implement each test as an automated test named by its ID.

| # | Piece | Read | Tests |
| --- | --- | --- | --- |
| 1 | `design-system`: a gallery of every component, started from shadcn and restyled to the agreed look | [Design system](reference/design-system.md#design-system) | DS-1 to DS-5 |
| 2 | `app-kit`: create an app, run it locally on sample data, check it | [App kit](reference/app-kit.md#app-kit), [Guardrails](reference/app-kit.md#guardrails), [Local development](reference/app-kit.md#local-development) | AK-1 to AK-11 |
| 3 | `runtime-sharing`: an app loads components from Console and does not bundle them | [Runtime sharing](reference/design-system.md#runtime-sharing) | SH-1 to SH-7 |
| 4 | `app-hosting`: submit, publish, open and roll back an app version | [App hosting](reference/app-kit.md#app-hosting) | AH-1 to AH-7 |
| 5 | `design-system-configuration`: an environment sets its tokens and switched-on components | [Design-system configuration](reference/design-system.md#design-system-configuration) | DC-1 to DC-6 |
| 6 | `renderer-reskin`: dashboards use the same components and tokens | [Dashboard renderer](reference/design-system.md#dashboard-renderer) | RS-1 to RS-3 |
| 7 | `data-hooks`: an app reads data and runs an action in one line | [Data hooks](reference/app-kit.md#data-hooks) | DH-1 to DH-6 |
| 8 | `access-sign-in`: every app and dashboard requires Access sign-in | [Sign-in through Access](reference/google-sign-in.md#target-sign-in-through-access) | CS-1 to CS-17 |
| 9 | `app-delivery`: an app and a design-system release arrive through Build, Marketplace and Deploy | [Delivery](reference/app-kit.md#delivery) | AD-1 to AD-7 |
| 10 | `component-packs`: an environment installs its own components | [Component packs](reference/design-system.md#component-packs), [Creating components from Figma](reference/design-system.md#creating-components-from-figma) | CP-1 to CP-7 |
| 11 | `reference-app`: the demo's Rules step from the kit only | [Reference app](reference/app-kit.md#reference-app) | RA-1 to RA-4 |

The test tables are in [the design system](reference/design-system.md#tests),
[the app kit](reference/app-kit.md#tests) and
[the sign-in contract](reference/google-sign-in.md#definition-of-done-for-access-sign-in).
Dependencies between pieces are in the capability map. Pieces 8 and 9 need
other products: a deployed Access, and Build and Deploy support for the new
bundle kinds. Leave them pending with a named gap for `aegislash`, `tinkaton`
or `corviknight`; do not build a substitute in Console.

## Build each piece

1. Select and order the pieces the task needs. Use at least four increments for
   a full-product build; scope a narrow fix to the relevant piece.
2. Show the next piece with synthetic data, then implement only that piece.
   Fake upstream products first. Cover a baseline, a materially different
   variant, invalid or unauthorized input and the relevant refresh or rollback
   inside the piece; its test table already holds them.
3. Run the piece's repository tests against the installed stand-in. Verify
   rendered behavior, API results and telemetry together.
4. Make the piece runnable in the authorized test environment. Give one
   invocation, the expected result and at most three AWS inspection steps using
   actual resource names. Have the user run the baseline and the variant and
   return redacted request IDs and observations. Wait for that evidence before
   the next piece.
5. Finish selected pieces with cumulative acceptance. Keep local tests,
   stand-in tests, deployed checks and real upstream integrations as distinct
   evidence levels.

For any piece, keep these:

- Never give a component a `className`, a `style` or a DOM reference, and never
  let an app's build include the design system.
- Never weaken the check to make an app pass. Add the missing component to the
  design system or a pack.
- Install a design-system change on a dev environment first; it reaches every
  app on that major version at once.
- State the limits the contracts state: the check is static for direct browser
  calls, and a sandboxed frame per app is not planned.

Return changes, supported examples, automated results by test ID, user
evidence, AWS observations, cleanup and remaining gaps. Keep reusable product
code in its target repository; this kit contains guidance, contracts and
synthetic inputs.

## Configuration provenance

Follow [configuration provenance: repo-linked Deploy installs](../guide-product-work/reference/configuration-provenance.md).
Put every new Console configuration write route (app create, version submit and
publish; design-system configuration submit and publish; pack install and
activate) behind the gate in `src/handlers/provenance-gate.ts` and
`src/domain/provenance.ts`: read the three headers, store and return
`provenance`, and honor `ConfigurationProvenance` (`Disabled` default, `Warn`,
`Enabled` answering 400 `PROVENANCE_REQUIRED` with nothing written). Test all
three modes, keep the default unchanged and list the route in the PR's
Compatibility section. As of 2026-11-18 Deploy's main has a Console adapter for
the `application` kind only; before setting `Enabled`, verify that the Deploy
installed in that environment sends its signature for every Console kind in
use.
