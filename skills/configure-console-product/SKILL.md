---
name: configure-console-product
description: "Build a business app from the shared design system for a non-technical person, set an environment's look and available components, and keep existing dashboards working on an existing Console. Use Vivillon; route missing components or runtime gaps to Chandelure."
---

# Configure Console

Use `vivillon`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Console capability map](../guide-product-work/reference/iterations/console.md).
Read the relevant [product contract](../build-console-product/reference/PRD.md),
[the app kit contract](../build-console-product/reference/app-kit.md),
[the design-system contract](../build-console-product/reference/design-system.md) and
[synthetic test data](../build-console-product/reference/test-data.md).

Three kinds of work use this skill: building an **app**, authoring an environment's
**design-system configuration**, and keeping an existing **dashboard** working. Build
new business apps as apps. Do not start a new one as a dashboard manifest.

## 1. Discover the Console

1. Call `https://<shared domain>/console` with the shared `x-api-key`: `GET /information`
   for the runtime version and capabilities, `GET /session` for the account. Get the
   shared domain from the user or their environment (for example
   `soofi-safavi.account.prismteam.ai`); use no AWS profile or credentials and do
   not read SSM or stack outputs.
2. Separate required, implemented and observed capabilities. Do not guess routes,
   components or operations. As of 2026-11-21 the Console repository's `main` (runtime
   1.20.0) hosts apps (upload, publish, roll back, open by address), has
   design-system configuration, and its one registered data operation is
   `report` `read-dataset`. Dashboards follow the configuration from runtime
   1.21.0 ([Console pull request 39](https://github.com/prismteam-ai/console/pull/39),
   not yet merged). Delivery through Build, Marketplace and Deploy and component
   packs are requirements, so an app or a configuration reaches only your own
   dev/test stack yet.
3. Where the capability a request needs is absent, say so, show the person what you
   would build, hand the gap to `chandelure` and stop. Do not build a bespoke app
   outside Console, run a local generator or fork the renderer as a substitute.

## 2. Understand the request

The person understands the business, not software. Use plain words.

1. Ask, one at a time unless already answered: what the app is for, who uses it,
   what data it shows, and what people can do in it.
2. Write the answer back as a short list of pages: what each shows and what a
   person can change on it. Wait for a yes.
3. Map each page to existing design-system components and to registered data
   operations before writing code. List what is missing; send each missing item as
   a request (step 3.6) and tell the person which pages wait on it.

## 3. Build the app

1. Scaffold from [the app kit](../build-console-product/reference/app-kit.md#app-kit).
   Leave its build settings as generated.
2. Assemble each page only from design-system components and their typed style
   props. Use an app-level theme choice only where the environment's design-system
   configuration permits it.
3. Declare each data binding and action with its registered product operation and
   required scopes, and keep a sample-data file beside each binding. Read and
   change data only through [the data hooks](../build-console-product/reference/app-kit.md#data-hooks);
   apps call only Console's API. Show what a product returns; do not imitate a
   product's logic in app code.
4. Run it as [local development](../build-console-product/reference/app-kit.md#local-development)
   describes, on sample data first.
5. Run the app kit's check and fix every violation. The
   [guardrails](../build-console-product/reference/app-kit.md#guardrails) forbid raw
   elements, CSS files, `className` and `style`, dependencies outside the allowlist,
   direct network calls and direct DOM access. Never suppress a rule, change the
   check or the build settings, commit a registry file or hide a violation.
6. When a component, variant or data operation is missing, stop that page and send
   a reproducible request: what the page must show, the data shape, the design or
   sketch, and which existing components were tried and why they do not fit. A
   component or a Console operation goes to `chandelure`; a product API that does
   not exist goes to that product's builder. Do not improvise.
7. Build one page at a time. Show the preview and screenshots at phone, tablet and
   desktop widths, have the person try the page and collect feedback before the next.
   Use the per-pull-request preview where delivery supports it, otherwise the local
   run. Say "sample" wherever a number could be mistaken for a real result.

### From a Figma design

Work from the person's description, screenshots or an exported image of the
design; do not read Figma files yourself. Build from existing components only
and match content and layout, not pixels. Request any element without a matching
component from `chandelure`, as
[creating components from Figma](../build-console-product/reference/design-system.md#creating-components-from-figma)
describes. Never ask the person for Figma access or a token.

## 4. Configure an environment's design system

1. Author the [design-system configuration](../build-console-product/reference/design-system.md#design-system-configuration):
   tokens, switched-on components, each component's allowed variants and defaults,
   active [component pack](../build-console-product/reference/design-system.md#component-packs)
   versions and the theme choices apps may make. Select only installed pack
   versions; pack code is `chandelure`'s work. On runtime 1.20.0 and later the
   document and routes are in
   [its implementation rules](../build-console-product/reference/design-system.md#design-system-configuration-implementation-rules);
   per-component allowed variants and defaults are not configurable yet, so
   report that gap to `chandelure` instead of improvising.
2. On your own dev/test stack, verify a baseline and a materially different
   configuration: submit with an `Idempotency-Key`, publish with `If-Match`, read
   back `GET active` and its digest, fetch `/console/design-system/tokens.css`,
   and compare screenshots of one app and, on runtime 1.21.0 or later, one
   dashboard before and after. The gallery does not load the configuration; it
   shows the built-in token sets at `?gallery` (`&tokens=tokens-b` for the
   second). Dashboards are not yet checked for switched-off components, so
   confirm no dashboard draws a component before switching it off.
3. Verify an invalid value is refused (`400`) and nothing is saved, an app using a
   switched-off component is refused at publish (`422` `component_switched_off`)
   while other apps still work, a revision switching off a component a published
   app uses is refused (`409` `CONFIGURATION_IN_USE`), and a rollback restores
   the previous look with no app change.

## 5. Keep existing dashboards working

1. Author routes, layouts, themes, supported components, typed data and action
   bindings and access policies in the `ConsoleApplicationManifest`. Do not ask for
   manifest features that give a dashboard app-like behavior.
2. As of 2026-11-18 Build and Deploy main both support the `console` `application`
   kind. List the manifest in `bundle.json` per
   [Console application payloads](../build-product-deployer/reference/configuration-bundles.md#console-application-payloads)
   after confirming with `metang` and `skarmory` that the target environment has
   both installed, then follow the bundle's subscribe, verify and clean-up steps.
3. Build rejects a manifest with a top-level `forms` field ("the manifest has no
   field forms"). Keep it in the repository but out of `bundle.json`, record the
   gap for `tinkaton` and tell the user.
4. For an existing Report, read its `outputs/<report>/latest/manifest.json` columns
   first, then map them to report components through `report` bindings
   (`read-dataset`, scope `report:read`). Verify values against the dataset file and
   that a newer Report refresh appears without a Console change. Route missing
   datasets to `bronzor`; route missing components or formats to `chandelure`.
5. Verify a Model network begins at the declared top vertex, preserves canonical
   identities and distinguishes base and extension concepts. A missing composition
   resolver or query stays pending with the owning product's builder.
6. Exercise a baseline and a materially different dashboard on the same runtime,
   with an invalid binding, an authorization denial, a refresh without rebuilding
   the runtime and a rollback to the prior immutable revision.

## 6. Deliver

1. Keep the app, the design-system configuration and each manifest in a
   configuration-bundle repository through a pull request the user merges.
2. An app is a `console` `app` entry and a design-system configuration a `console`
   `design-system` entry, as [delivery](../build-console-product/reference/app-kit.md#delivery)
   describes. Both kinds are targets until Build and Deploy merge them. Until then
   stop at the checked, previewed app in its repository, record the gap for
   `tinkaton` (bundle kind) and `corviknight` (Deploy installer) and tell the user.
   Never upload, publish or install by hand as a substitute.
3. Validating and publishing through the Console API is a test-only exception on
   your own dev/test stack: verify the immutable digest and read back the active
   revision.
4. Ask `doublade` to register the app's roles in Access, invite users and assign
   them: from runtime 1.26.0 a role named as the app's settings `roles`, with
   `use` shared on `console/app/<appId>` once the app is first published, and
   roles granting the INTERIM `console:scope:<scope>` stand-ins its bindings and
   actions need ([setup](../build-console-product/reference/google-sign-in.md#access-sign-in-implementation-rules)).
   Verify route, data and action authorization server-side.
5. Give the user one copyable invocation, the expected result and at most three
   steps to open the hosted app or dashboard, read back the selected digest and
   see it refuse a person without the role. Have them return redacted IDs and
   observations before advancing. Keep a passing check, a published version and
   upstream product readiness as separate evidence.

Never put credentials, tokens, API addresses, personal data or arbitrary
JavaScript in a manifest or a configuration.

Return the app source or diff, check result, previews and the person's feedback,
configuration artifacts with selected versions and digests, API and browser
results, cleanup and builder handoffs.

## Configuration provenance

Follow [Configurer delivery](../guide-product-work/SKILL.md#configurer-delivery) and
[configuration provenance: repo-linked Deploy installs](../guide-product-work/reference/configuration-provenance.md).
Do not write configuration directly to the Console API in an environment; ship it
through its configuration repository, Build, Marketplace and Deploy. Expect
400 `PROVENANCE_REQUIRED` where the install sets `ConfigurationProvenance` to
`Enabled`. To test in dev, install through Deploy or set the dev stack to `Warn`.
