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

A run whose message begins `Console edit turn`, or that otherwise says it is a
Console Edit Mode turn and gives a `sessionId`, changes an installed app one message
at a time: follow [section 8](#8-edit-an-installed-app-one-turn-at-a-time-edit-mode-turns)
and skip sections 1, 2 and 6. It is not an edit batch (section 7).

## Walk a new person through it

When the person has not built a Console app before, or asks how it works, take
them through three stages in plain words, one stage at a time, and wait for them
before the next.

1. **Create.**
   - They need two Access roles: `enact-agent-user` to run you and
     `console-editor` for Console's edit mode; an Access administrator gives them.
   - They reach you through Enact in their Claude: they add
     `https://<shared domain>/enact/mcp` as an MCP server and, in Claude Code, type
     `/mcp`, pick Enact and sign in with Google. There is no key to paste and no
     Claude plan to link: you run on Prism's own model account. They ask Claude to
     use the `ask_vivillon` tool; while you are still working, they ask Claude to
     keep waiting on the same run.
   - The app lives in its own private repository in the prismteam-ai
     organization. Create it yourself with the `create_repository` tool from
     `prismteam-ai/configuration-bundle-template`, with a short lowercase name for
     the app, and build there; tell the person its name. When the tool refuses
     (for example because Enact's GitHub App may not create repositories yet, or
     the name is taken), say so plainly and ask an owner of the organization to
     create the repository from the template (**Use this template**) and add it to
     the Enact GitHub app, which is all Enact needs; then the person names it on
     the next run. Never say you created a repository or ran a check you could
     not run.
   - Agree on the pages (section 2), then build and show one page at a time
     (section 3). Open one pull request in their repository and never merge it.
     Its description says what was added, the check's result line, that the
     numbers match the prototype where there is one, that nothing overflows at
     phone, tablet and desktop widths, and the known gaps, as
     [prismteam-ai/debt-collection-usecase#25](https://github.com/prismteam-ai/debt-collection-usecase/pull/25)
     does.
   - To change the app, they ask you in plain words, for example "show each rule
     as an on/off switch with a bar for how many accounts it holds back"; each
     change comes back as a new pull request.
2. **Review in Console's edit mode**, on an app already on Console.
   - Apps open in view mode. With `console-editor`, an **Edit mode** switch shows
     above the app.
   - They pin sticky notes on the exact spot they mean, draw markup with the pen
     (mouse, finger or Apple Pencil), change or delete them (they survive a
     reload), then click **Run fixes** to send the whole batch; the page says the
     batch was submitted for review.
   - Sending batches to you is off on soofi-safavi until an operator sets
     `/console/edit-review`, so today no pull request follows **Run fixes**: until
     then they ask you in Claude for the same changes. Once it is on, you open a
     fix pull request per batch (section 7). The page shows no progress, so they
     watch their repository.
3. **Deliver.**
   - Merging the pull request delivers the app: Build checks it, Marketplace
     publishes it, Deploy installs it. Nothing reaches Console before that. The
     first delivery needs the one-time setup in
     [delivery](../build-console-product/reference/app-kit.md#delivery); ask an
     operator for it, and `doublade` for the role.
   - Have the app's viewer role, such as `mayo-clinic-viewer`, given to the people
     who should open it; people without it cannot.
   - They open it at `https://<shared domain>/console/app/?appId=<appId>`, for
     example `?appId=agent-usage`. Neither reference app is published yet: the
     debt app's draft pull request has its delivery files and Marketplace entry,
     and Mayo's is getting them.

## 1. Discover the Console

1. Call `https://<shared domain>/console` with the shared `x-api-key`: `GET /information`
   for the runtime version and capabilities, `GET /session` for the account. Get the
   shared domain from the user or their environment (for example
   `soofi-safavi.account.prismteam.ai`); use no AWS profile or credentials and do
   not read SSM or stack outputs.
2. Separate required, implemented and observed capabilities. Do not guess routes,
   components or operations. As of 2026-11-25 the Console repository's `main`
   (runtime 1.42.0) hosts apps (upload, publish, roll back, open by address), has
   design-system configuration and edit mode, and its one registered data operation is
   `report` `read-dataset`. Dashboards follow the configuration from runtime
   1.21.0 ([Console pull request 39](https://github.com/prismteam-ai/console/pull/39),
   not yet merged). A merged app reaches an environment through Build,
   Marketplace and Deploy ([delivery](../build-console-product/reference/app-kit.md#delivery));
   prismteam-ai/agent-usage-app and prismteam-ai/console-pack-app were delivered
   that way. The kit's components, with props and an example each, are in its
   `dist/CATALOG.md`.
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
   operations before writing code. Read
   [the reference apps](../build-console-product/reference/app-kit.md#reference-apps)
   and copy their patterns: prototype logic copied byte for byte, a store for
   settings that carry across pages, one section at a time with `SectionDots`,
   and `Switch` rows for on/off rules. When rebuilding an existing page or
   prototype, use the matching component listed under
   [Console's own components](../build-console-product/reference/design-system.md#design-system)
   instead of copying its HTML. List what is missing; send each missing item as a request (step 3.6) and tell
   the person which pages wait on it.

## 3. Build the app

1. Scaffold from [the app kit](../build-console-product/reference/app-kit.md#app-kit).
   Leave its build settings as generated. To install the kit on Enact: when
   `REGISTRY_AWS_ACCESS_KEY_ID` and `REGISTRY_AWS_SECRET_ACCESS_KEY` are set, sign
   npm in to Build's registry for the working copy only with
   `AWS_ACCESS_KEY_ID="$REGISTRY_AWS_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$REGISTRY_AWS_SECRET_ACCESS_KEY" aws codeartifact login --tool npm --domain buildworkflow --domain-owner 848665034107 --repository npm --namespace prism --region <registry region>`
   and install the exact kit version. Otherwise build the kit from
   `prismteam-ai/console`'s `main` (`pnpm install --frozen-lockfile`,
   `pnpm app-kit:build`, `pnpm pack` in `app-kit/`) and install the tarball in
   the working copy only; that needs the person to name `prismteam-ai/console`
   on the run, so ask for it when it is missing. Commit no `.npmrc`, tarball or
   `file:` dependency, and never print a credential.
2. Assemble each page only from design-system components and their typed style
   props. Use an app-level theme choice only where the environment's design-system
   configuration permits it. To show the Prism logo and the signed-in person's
   company logo above a demo app, declare `brand.company` in its settings as
   [the company logo](../build-console-product/reference/app-kit.md#company-logo)
   describes, list the logo host in `logoOrigins`, and confirm the company's
   record in Persist is reachable from the company's demo role (a grant edge
   Access writes).
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
   describes. Add the app's delivery files at the repository root as that section
   lists them. Merging the pull request delivers the app: Build checks and builds
   it, Marketplace publishes it, Deploy installs it. Never upload, publish or
   install by hand as a substitute.
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

## 7. Fix a Console edit batch

A run whose message begins `Console edit batch` was started by **Run fixes**. Its
message says what to do and how to end the answer (`PR:` and `NEEDS-INFO:`
lines); follow it exactly. Make each fix by the rules of section 3, run the
check, and open one pull request per repository from the commit each
annotation's `source` names. Never merge.

## 8. Edit an installed app one turn at a time (Edit Mode turns)

Follow [Edit Mode turns](reference/edit-mode.md) for the whole turn. Use
`scripts/edit-turn.mjs` for the branch, the gate, the push and the pull request; do
not do those steps by hand.

1. Run `node scripts/edit-turn.mjs begin` with the turn's repository, `appId`,
   `sessionId` and the installed app's provenance commit. It works on
   `edit/<appId>/<sessionId>`, started from that commit, and begins every turn with
   `git fetch` and `git reset --hard origin/<branch>`.
2. Install the app's dependencies as its lockfile pins them. When the app pins
   an exact `@prism/console-app-kit` that the environment's registry answers with 404
   for it, run `node scripts/edit-turn.mjs bump-kit --kit-version <kit_version>`
   with the version the prompt's line `- @prism (prism): the latest
   @prism/console-app-kit published here is <kit_version>` names, as
   [the kit bump](reference/edit-mode.md#bump-the-app-kit-when-the-registry-lacks-its-version)
   describes. Only a later version of the same major, 1.49.0 or above, is accepted;
   for anything else end the turn as `FAILED`.
   Bump only to recover from that 404: when the frozen install succeeds, go on
   without one. With no `kit_version` in the prompt, end as `FAILED`.
   Change only the app's `console-app.json` and regular files under its `src/`,
   within the [guardrails](../build-console-product/reference/app-kit.md#guardrails).
   Commit.
3. Run `node scripts/edit-turn.mjs push`. Its gate is mandatory: `console-app check`
   passes, and every changed path is `console-app.json` or under `src/` as a regular
   file (git mode `100644`), with no symbolic link, submodule, `package.json`,
   lockfile, build-settings or other configuration edit; the one exception is the
   `package.json` and lockfile change `bump-kit` made. Fix a refusal in the turn or
   end the turn without pushing. Never bypass the gate.
4. It pushes once per turn with `git push --force-with-lease=<branch>:<startSha>` and
   finds or opens the session's **draft** pull request.
5. End with only the JSON result: `{ branch, sha, prUrl, status, message }`, with
   `sha: null` when nothing was pushed (`NEEDS-INFO`, `NO-OP` or `FAILED`).

## Configuration provenance

Follow [Configurer delivery](../guide-product-work/SKILL.md#configurer-delivery) and
[configuration provenance: repo-linked Deploy installs](../guide-product-work/reference/configuration-provenance.md).
Do not write configuration directly to the Console API in an environment; ship it
through its configuration repository, Build, Marketplace and Deploy. Expect
400 `PROVENANCE_REQUIRED` where the install sets `ConfigurationProvenance` to
`Enabled`. To test in dev, install through Deploy or set the dev stack to `Warn`.
