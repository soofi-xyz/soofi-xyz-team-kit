# Console design system

Use this contract for the components and tokens Console serves, how apps load
them without bundling them, how an environment configures them, component packs
and the dashboard reskin. It is the target design. Read it before any change to
base components, tokens, themes or the gallery; a change that weakens a
guarantee below is a defect, even when the change was about something else.

As of 2026-11-20 the `design-system` piece is on the Console repository's
`main` (pull requests 31 and 32, runtime 1.14.0): tokens, two token sets, base
components started from shadcn with an origin record, the gallery and `DS-1` to
`DS-5`, by [the implementation rules](#implementation-rules). Pull request 33
(runtime 1.15.0, on `main`) adds `Page`, `Stack` and `Text` with token-only
style props for the app kit. Pull request 34 (runtime 1.16.0, on `main`) builds
runtime sharing by [its implementation rules](#runtime-sharing-implementation-rules):
each build at `/console/app/runtime/<version>/<digest hex>/`, one pointer per
major version at `/console/app/ui/v<major>/` and `SH-1` to `SH-7`. It does not
build the version check at publish, a pointer API or loading an app in the
Console shell on one React. Design-system configuration is on pull request 38
(runtime 1.20.0, not yet merged) by
[its implementation rules](#design-system-configuration-implementation-rules),
with open gaps listed there. Component packs and the renderer reskin are not
built. Discover the target revision before relying
on any part, and settle names marked as placeholders in the Console repository.

Read it with [the product contract](PRD.md) and [the app kit](app-kit.md).
The [Tests](#tests) section defines done for the `design-system`,
`runtime-sharing`, `design-system-configuration`, `renderer-reskin` and
`component-packs` pieces.

## Design system

Own one copy of the components, in the Console repository. Apps never receive
the source.

- **Starting point.** Start from shadcn/ui itself, not from a blank page or a
  look-alike. Add each base component that shadcn provides to the Console
  repository with shadcn's own tooling, then change that copy: restyle it to the
  look below, close its public props and add the token-only style props. Do
  not hand-write a component shadcn provides, and do not start from another
  component library. Console's own components and component packs are built
  from the same primitives and conventions.
- **Origin record.** Keep, beside the components, a record naming for every
  base component the shadcn component and revision it started from, or
  "Console's own" when shadcn has none. Use it to pull upstream fixes into
  Console's copy; an upstream change never reaches an app except through a
  Console design-system release.
- **Structure.** Keep shadcn's structure: accessible behavior from its headless
  primitives (Radix UI), Console's styled layer on top, variants as typed
  props and tokens as CSS variables. shadcn's "you own and edit the code"
  applies once, to Console's copy, and never to an app.
- **Look.** Use the debt-collection demo's look (the prismteam.ai style): paper
  ground, ink text, one typeface, rounded squares, no shadows, color only where
  it carries meaning. Use rounded squares, not circles, the TASA Orbiter
  typeface and flat surfaces with hairlines instead of multi-layer shadows.
  Name tokens `--ds-*` after the demo's own words and settle exact values in
  the Console repository:

  | Token | Meaning | shadcn theme name it serves |
  | --- | --- | --- |
  | `paper`, `surface` | page ground, raised surface | `background`, `card` |
  | `ink`, `ink-2`, `ink-3` | text, secondary text | `foreground`, `muted-foreground` |
  | `line` | hairlines | `border` |
  | `iris`, `iris-soft` | selected, changeable, primary button; its soft wash | `primary`, `accent` |
  | `stop` | legal stop, failure, opt-out, destructive | `destructive` |
  | `wait` | waiting on a person | none |
  | `go` | cleared, delivered, paid (ink, not green) | none |
  | `radius-control`, `radius-panel` | corner radii (8px, 12px) | `radius` |

  Point shadcn's theme names at these tokens inside the design-system build.
  Never define shadcn's unprefixed variables: they collide with the renderer's
  existing `--background`, `--surface` and `--accent`. Add the demo's channel
  washes as tokens when a component needs them. Do not invent a second palette
  in a component or an app.
- **Token sets.** Ship at least two complete token sets (`tokens-a` and
  `tokens-b`) that define the same tokens. Switch the active set at runtime by
  changing which token stylesheet the shell loads; never rebuild components or
  apps to change the look. Once
  [design-system configuration](#design-system-configuration) ships, the
  environment's generated token stylesheet takes that place.

- **Names.** Keep shadcn's component names and props wherever a component
  exists there (`Button`, `Card`, `Badge`, `Switch`, `ToggleGroup`, `Slider`,
  `Tabs`, `Dialog`, `Table`), because agents already write them correctly. Map
  the demo's parts onto them: `Panel` is `Card`, `Pill` is `Badge`, `Toggle` is
  `Switch`, `Segmented` is `ToggleGroup`, `Slider` and `Range` are `Slider`.
- **Console's own components.** Add what shadcn lacks:
  - layout and text: `Page`, `Bench` (controls beside results), `Stack`,
    `Grid`, `Box`, `Text`;
  - results: `Stat`, `Stats`, `BarRow` and the graph diagram from the demo;
  - data: the dashboard renderer's table, chart, KPI, bar list, funnel,
    heatmap, county map, form and job-status components, restyled;
  - drawing parts for custom visuals: bars, segments, grid cells and axes, so
    most new visuals need no new component and no raw SVG.
- **Public props.** Give no component a `className`, a `style` or a DOM
  reference. Offer variants as a closed, typed list: an unknown variant
  fails compilation, with no free-string names and no silent fall-through to a
  default at runtime. On layout and text
  components accept style props whose values are token names only
  (`gap="3"`, `tone="muted"`, `background="surface"`, `radius="panel"`), so an
  off-scale value does not compile. Type the composition rules that can be
  typed, such as at most four `Stat`s in a `Stats` row.
- **Styling inside.** Compile Tailwind in the design-system build only and ship
  one stylesheet per build. Apps have no Tailwind and no CSS.
- **Accessibility.** Every interactive component works by keyboard, shows
  focus, meets contrast on the shipped tokens and respects reduced motion.
- **Gallery.** Serve a gallery page from Console that renders every exported
  component in every variant. It is what the tests screenshot and what a
  designer reviews.
- **Versions.** Version the design system with semantic versioning and give the
  app kit the same version number. A breaking change to a component's props is
  a new major version. Base components ship with the Console runtime release.
- **Missing components.** When an app needs a component that does not exist,
  the author files a request to Chandelure and does not improvise. Add the
  component here or in a component pack.

## Runtime sharing

The requirement: a change to a component reaches every app in the environment
without rebuilding or republishing any app. So an app's built files must not
contain the design system.

- **Mechanism.** Use native browser modules loaded by address. Add no
  micro-frontend framework and no web components. Do not use an import map: it
  must be inline, and Console's browser policy (`script-src 'self'`) blocks
  inline scripts.
- **Immutable builds.** Store each design-system build at a path that never
  changes once written: `/console/app/runtime/<version>/<digest hex>/` on the
  shared domain. Serve only its `app-runtime/` and `assets/` folders there and
  refuse every other path.
- **Pointer.** Keep one small module per major version at a fixed address,
  `/console/app/ui/v<major>/index.js`, holding one line that names the build by
  a relative address:

  ```js
  export * from "../../runtime/1.16.0/<digest hex>/app-runtime/index.js";
  ```

  Provide the same pointer for React (`react.js`), the JSX wrapper
  (`jsx-runtime.js`) and the host's mount module (`mount.js`), and a
  `pointer.json` naming the build's major, version, digest and path. The Console
  stack writes the pointer on install, after the build it names, and never
  prunes it, earlier builds or another major's pointer. There is no pointer API.
- **App builds.** The app kit's build settings mark the design system and React
  as external and write the address of the pointer of the kit's own major into
  the app's built file. The app author never sets this.
- **One React.** The app loads React from the design-system build, so the page
  has one copy and hooks and context work across the boundary. Use client-side
  React only; Server Components do not work with this sharing.
- **Stylesheets.** The host's mount module links the stylesheet of the build it
  came from and the environment's token stylesheet the host names, both from
  Console's own origin, and renders the app only once both have loaded.
- **Caching.** Serve the pointer so the browser revalidates it on every page
  load, and everything it points to as immutable and cached for a long time.
- **One version per session.** Every address after the pointer includes the
  exact build, so an open tab keeps one consistent version until it reloads.
- **Major versions side by side.** A breaking change gets a new major and a new
  pointer beside the old one (`ui/v2/` beside `ui/v1/`). Apps built for `v1`
  keep loading `v1` until each is rebuilt with a kit of the new major. Never
  remove a build that a pointer or a published app still needs.
- **Version check.** Build records the minimum design-system version an app
  needs and the components it uses. Console refuses to publish the app where
  the installed version is older or a component is missing or switched off.
- **Release safety.** Every app on a major version receives a change at once.
  Run the gallery screenshot tests and install on a dev environment first. Roll
  back by installing an earlier Console release from 1.16.0 on: its stack points
  the major back at its own build. Going back to 1.15.0 or earlier removes the
  `ui/` and `runtime/` paths, so every app built with kit 1.16 or later stops
  loading. Installing the same release again changes nothing.
- **Cost accepted.** An app cannot strip out components it does not use; the
  shared build is downloaded once and reused by every app. Load heavy parts,
  such as the county map's geometry, only when used.

## Design-system configuration

An environment configures its design system with one declarative document.

- **Contents.** Tokens (colors, type, spacing scale, radii, logo); which base
  and pack components are switched on; each component's allowed variants and
  defaults; the active version of each installed pack; and which theme choices
  an app may make (accent from the palette, density, light or dark).
- **Lifecycle.** Treat it like a dashboard manifest: idempotent submission of an
  immutable revision, validation, publish with optimistic concurrency, active
  read-back and rollback. Put its write routes behind the provenance gate.
- **Validation.** Use a closed schema. A token value must be of its type and on
  its scale. Refuse code, credentials, remote addresses and unknown keys, and
  save nothing when any value is invalid. A font or logo is an asset Console
  serves, never a remote address.
- **Token stylesheet.** Generate one stylesheet from the active revision and
  serve it from Console's own origin at a fixed address that the browser
  revalidates. A token change then reaches every app and dashboard with no
  rebuild of an app or of the components.
- **Switched-off components.** Refuse to publish an app that uses a switched-off
  component. Refuse a configuration revision that switches off a component a
  published app uses, and name those apps in the refusal.
- **App theme choices.** An app declares its choices in its settings, never in
  code. Honor a choice only where the environment's configuration allows it and
  fall back to the environment's default otherwise.
- **Delivery.** It reaches an environment as a `console` `design-system`
  configuration bundle (a target kind) installed by Deploy through Console's
  API.

## Component packs

Components may differ per environment. A component pack is a separately
delivered set of components installed per environment.

- **What a pack may do.** Add components, and replace a base component when its
  props are compatible with the base component's.
- **Source and delivery.** A pack lives in its own repository. Build builds and
  checks it, Marketplace reviews and publishes it and Deploy installs it
  through Console's API, as a `console` `component-pack` bundle (a target
  kind). Console stores the build at an immutable path and activates it by
  pointer. Pack code is reviewed JavaScript on the shared domain, like an app.
- **Added components.** Give each pack its own package for types (a
  placeholder such as `@prism/ui-<pack>`, settle in the Console repository) and
  its own pointer per major version. Publish the types package into Build's
  registry so apps can build against it.
- **Replaced components.** Let the environment's base pointer re-export the
  base build and then name the replacement, so the named export wins (the pack
  path is a placeholder):

  ```js
  export * from "../../runtime/1.16.0/<digest hex>/app-runtime/index.js";
  export { Badge } from "../../packs/acme/1.0.0/<digest hex>/index.js";
  ```

  Apps keep importing the base name and are not rebuilt. Fail the pack's build
  when the replacement's props are not assignable to the base component's.
- **Pack rules.** A pack is design-system code, so it may use raw elements
  inside. Hold it to the same rules as base components: tokens only, no
  hard-coded colors or sizes, no `className` or `style` on public props, a
  gallery entry for every component and the same accessibility bar.
- **Component manifest.** Each pack build lists its components, their props,
  which base components it replaces and the minimum base version it needs.
- **Lifecycle.** Install, activate, read back and roll back a pack through
  Console's API. Refuse to remove or roll back to a pack version that lacks a
  component a published app uses, and name those apps.
- **Limits to state.** A replacement changes every app in that environment at
  once. An app that uses a pack component publishes only in environments that
  have the pack.

## Dashboard renderer

Keep the manifest renderer working for existing dashboards.

- Draw every dashboard component with the design system's components and
  tokens, so a dashboard and an app in one environment look the same.
- Take the look from the environment's design-system configuration. Keep the
  manifest's `theme` field accepted so existing manifests stay valid, but do
  not let it override the environment's tokens.
- Keep the manifest schema, the applications API and the `application` bundle
  kind compatible. Existing dashboards must render without a manifest change.
- Do not extend the manifest schema for app-like behavior unless the user asks.
  Build new business apps as apps.

## Creating components from Figma

Console owns no authoring runtime. A component designed in Figma is created by
a kit agent, not by a Console service.

- Chandelure creates and changes base and pack components, run on Enact or in
  an editor. Its Figma access, repositories and limits are Enact agent
  configuration: `zorua` configures them and `zoroark` builds any missing Enact
  capability. Do not build a Figma connection into Console.
- Reuse [figma-to-code](../../figma-to-code/SKILL.md) for reading the design
  and [responsive-design-tests](../../responsive-design-tests/SKILL.md) for the
  breakpoint checks.
- Deliver a pull request to the Console repository (base components) or the
  pack repository, holding the component, its gallery entry, screenshots at
  phone, tablet and desktop widths, the accessibility result and the Figma file
  and node it came from. Commit no private design assets.
- Nothing is installed until the pull request is merged and delivered through
  Build, Marketplace and Deploy.
- When the Figma read fails or is denied, report it. Never invent a design.

## Tests

Name each automated test by its ID. A piece is done only when every test in its
table passes. Repository tests run in Playwright against the installed stand-in
(the production build and the real API, with only AWS replaced) on every pull
request. Deployed checks are run by the user on a dev environment: one command
and at most three things to inspect. Use the fixtures in
[the test data](test-data.md). Phone, tablet and desktop widths are 390, 768 and
1280 px unless the repository fixes others.

### `design-system`

Level: repository.

| ID | Do | Expect |
| --- | --- | --- |
| DS-1 | Open the gallery at phone, tablet and desktop widths and screenshot every exported component in every variant | Every exported component is present and each screenshot matches its stored baseline |
| DS-2 | Tab through every interactive component in the gallery, operate it by keyboard and run the accessibility scan on the page | Each can be reached, operated and left by keyboard with visible focus; the scan reports no violation |
| DS-3 | Load the gallery with token set `tokens-a`, then switch the token stylesheet to `tokens-b` without rebuilding the components | Every component's computed colors and radii follow `tokens-b`; the design-system build digest is unchanged |
| DS-4 | Type-check a fixture that gives `Button` a variant that does not exist | The type-check fails on that line |
| DS-5 | Compare the exported base components with the origin record and with shadcn's component list at the recorded revision | Every exported component has one entry; each one shadcn provides names the shadcn component and revision it started from, and only components shadcn lacks are marked "Console's own" |

Record one evidence row per check: ID, result, request or run identifier and the
Console revision.

#### Cumulative scenario

Run this after `DS-1` through `DS-5` all pass individually. It is acceptance
for the design-system piece as a whole.

| Step | Do | Expect |
| --- | --- | --- |
| 1 | Open the gallery under `tokens-a` at phone, tablet and desktop | `DS-1` baselines match under `tokens-a` |
| 2 | Run the keyboard path and accessibility scan on that gallery | `DS-2` passes |
| 3 | Switch to `tokens-b` without rebuilding components, reload the gallery and re-screenshot | Look follows `tokens-b`; component build digest unchanged (`DS-3`); screenshots differ from the `tokens-a` baselines where tokens differ |
| 4 | Attempt to type-check the unknown-variant fixture against the same revision | `DS-4` still fails compilation |
| 5 | Switch back to `tokens-a` and re-open the gallery | Prior look restored without a rebuild |

### `runtime-sharing`

Level: repository.

| ID | Do | Expect |
| --- | --- | --- |
| SH-1 | Build `sample-app` and read the bundler's input list and the built files | No input comes from the design system or React; the built files import the pointer address |
| SH-2 | Open `sample-app` on the stand-in | It renders, and the network log shows the components loaded through the pointer from an immutable build path |
| SH-3 | Install a second design-system build in which `Button` differs visibly, then reload the app | The app shows the new `Button`; every app file's digest is unchanged |
| SH-4 | Point the pointer back to the first build and reload | The app shows the first `Button` again |
| SH-5 | Open the app, install the second build without reloading, then trigger a component that loads lazily | The open tab loads it from the first build and stays consistent; a reload moves the whole page to the second build |
| SH-6 | Add a pointer for the next major whose build removes a prop that `sample-app` uses, then open the app built for the current major | The app still renders from its own major's build |
| SH-7 | Open a page of `sample-app` that uses a hook and a context provided by a design-system component | Both work, and the page has loaded exactly one copy of React |

### `design-system-configuration`

Level: repository; DC-4 uses two stand-ins.

| ID | Do | Expect |
| --- | --- | --- |
| DC-1 | With `sample-app` open on `tokens-a`, publish a configuration revision carrying `tokens-b` and reload | The app's computed colors follow `tokens-b`; the app's and the design system's digests are unchanged |
| DC-2 | Submit the two `tokens-invalid` revisions: a color token set to `12px`, and an unknown key | Each is refused with the offending path; no revision is saved and the active one is unchanged |
| DC-3 | Switch off a base component and a pack component that no published app uses, then try to publish an app that uses each, and open an app that uses neither | Both publishes are refused naming the component; the other app still renders |
| DC-4 | Publish the same `sample-app` files on stand-in A (`tokens-a`) and stand-in B (`tokens-b`) | The same file digests render with different computed colors on A and B |
| DC-5 | Roll the configuration back to the previous revision and reload | The previous look returns; the rolled-back revision is still readable |
| DC-6 | Publish `compact-app`, whose settings choose a compact density, first where the configuration allows apps that choice and then where it does not | The app is compact in the first and uses the environment's default in the second |

### `renderer-reskin`

Level: repository.

| ID | Do | Expect |
| --- | --- | --- |
| RS-1 | Run the existing dashboard Playwright suite against the reskinned renderer | Every existing test passes with no manifest change |
| RS-2 | Open a dashboard and `sample-app` side by side, then publish `tokens-b` | The same tokens change in both, to the same computed values |
| RS-3 | Screenshot the `portal-performance` and `inventory-controls` fixtures at phone, tablet and desktop widths | Each matches its new stored baseline |

### `component-packs`

Level: repository on two stand-ins for CP-1 to CP-6, with CP-1, CP-2, CP-3 and
CP-6 repeated as deployed checks; CP-7 is a deployed check that needs an agent
run on Enact.

| ID | Do | Expect |
| --- | --- | --- |
| CP-1 | Install `sample-pack`, which adds `Sparkline`, in environment A, then publish and open `pack-app`, which uses it | The publish succeeds and `Sparkline` renders in A |
| CP-2 | Publish the same `pack-app` files in environment B, which lacks the pack | The publish is refused naming the missing pack and component; nothing becomes active |
| CP-3 | Activate `sample-pack`'s replacement of `Badge` in A, then open the unchanged `sample-app` in A and in B | A shows the replacement, B shows the base `Badge`; the app's file digests are the same in both |
| CP-4 | Build `bad-pack`, whose `Badge` replacement requires a prop the base `Badge` does not have | The pack's build fails naming the incompatible prop; no build is produced |
| CP-5 | Run DS-1 and DS-2 against the gallery entries of every `sample-pack` component | Every pack component passes the screenshot, keyboard and accessibility checks |
| CP-6 | Install `sample-pack` 1.1.0 in A, open `pack-app`, then roll the pack back to 1.0.0 and reload | The 1.0.0 `Sparkline` returns; no app file changed and the app's active version is the same |
| CP-7 | Ask the component-authoring agent, run on Enact, to create a component from an authorized Figma node for the pack | A pull request arrives in the pack repository with the component, its gallery entry and screenshots at three widths; the environment's installed pack is unchanged until the pull request is merged and delivered |

## Implementation rules

These rules describe the tokens, gallery and tests in runtime 1.14.0 (pull
requests 31 and 32 in `prismteam-ai/console`) and the layout and text
components in 1.15.0 (pull request 33). Keep them when
changing that code or restarting its components from shadcn; each one is
checked by a test or a type check.

- **Layout.** Components, `catalog.ts`, `tokens.ts` and `design-system.css` live
  in `ui/src/design-system/`; import them through `index.ts`. The gallery is
  `ui/src/design-system-gallery.tsx`, opened at `?gallery`.
- **Catalog.** `catalog.ts` imports nothing and holds `componentNames`, every
  variant union, `componentReleases`, `styleProps` and `tokenSets`. Add a
  component to `componentNames`, `componentReleases` (the release that first
  ships it), the gallery's `examples` map, `requiredVariants` in
  `e2e/support/design-system.ts`, `origin.json` and the app kit's
  `app-kit/catalog/examples.tsx`; the UI type check fails while `componentNames`
  and the capitalized function exports of `components.tsx` disagree, and the
  catalog build fails without an example.
- **Token-only style props.** A layout or text component's look props take a
  closed list of token names (`spaceTokens`, `textTones`), mapped to literal
  Tailwind classes in the component so Tailwind generates them. List each such
  prop in `styleProps`, which the app kit's `off-scale-value` rule reads, and
  add an unknown-value line per prop to the DS-4 fixture.
- **Gallery names.** Keep every example's titles and labels unique on the page:
  a card titled like a section heading breaks the section lookup, and two
  regions with one name fail axe's `landmark-unique` in `DS-2`.
- **Variants.** Declare each variant list `as const` in `catalog.ts` and derive
  the prop type from it. Never type a variant prop as `string`. Add each new
  variant prop to the DS-4 fixture lines in
  `e2e/support/design-system-type-check.ts`.
- **No local styling.** Components omit `className` and `style` from their
  props and mark their root with `data-ds-component="<Name>"`. Do not add an
  escape hatch; add a variant, or a token-only style prop on a layout or text
  component, instead.
- **Tokens.** Name tokens `--ds-*` so they cannot collide with the renderer's
  existing `--background`/`--surface`/`--accent` theme variables. Every token set
  in `ui/src/design-system/tokens/` defines the same tokens. `design-system.css`
  uses no literal colors, positive literal radii, other `font-family` values or
  multi-layer or drop shadows; a unit test fails on any of them.
- **Delivery.** A Vite plugin emits each token set unbundled at
  `design-system/tokens-<name>.css`, which the runtime digest lists as an asset.
  `applyTokenSet` loads the new sheet beside the old one and removes the old one
  only after it loads; `?tokens=<name>` selects one at load, and an unknown name
  falls back to `tokens-a`.
- **Typeface.** The renderer's CSP allows only `'self'`. Self-host TASA Orbiter
  (OFL) as woff2 beside the components; never link Google Fonts or another CDN.
- **Host isolation.** The renderer's `styles.css` styles bare elements (`th` is
  10px uppercase, `h1`–`h3` use Avenir Next). Components reset font, letter
  spacing and text transform on their own descendants, so they look the same
  inside an application page as in the gallery.
- **Session.** Mount the gallery after `App`'s session check, never as a separate
  public HTML entry, so `CS-1` holds even though it reads no data.
- **Tests.** DS checks live in `e2e/design-system.spec.ts` (fixtures project) and
  `test/design-system.test.ts`, named by ID. Drive keyboard checks with keys
  that behave the same on macOS and Linux: ArrowRight (not End) to collapse a
  text selection, type-ahead (not ArrowDown) on a native select.
- **Baselines.** Screenshots are per platform in
  `e2e/design-system.spec.ts-snapshots/`. After an intended visual change,
  refresh `*-darwin.png` locally with `--update-snapshots` and `*-linux.png` from
  the **Design-system baselines** workflow artifact, and commit both. Never
  loosen a comparison threshold to make a baseline pass.

Applications cannot choose a token set from their manifest; the existing
`theme.tokens` still drives the renderer's own components. An environment's
tokens are chosen by its [design-system configuration](#design-system-configuration-implementation-rules)
(Console pull request 38, runtime 1.20.0, not yet merged), which app pages load;
dashboards and the gallery keep `?tokens=` until `renderer-reskin` moves the
renderer's components onto the design system. Have Vivillon configure an
environment's tokens only on a Console that has the configuration routes, and
not dashboards' look until `renderer-reskin` ships.

## Runtime sharing implementation rules

These rules describe runtime sharing in runtime 1.16.0 (pull request 34 in
`prismteam-ai/console`, on `main` since 2026-11-20). Keep them when changing that
code. The kit's side is in
[the app kit's implementation rules](app-kit.md#implementation-rules).

- **Layout.** Every install serves the UI build three ways under
  `/console/app/`, which API Gateway passes to CloudFront: the build unchanged
  at `runtime/<version>/<digest hex>/` (the `runtime/*` behaviour), the pointer
  of its major at `ui/v<major>/` (`ui/*`), and the page with its token
  stylesheets at the root (the default behaviour). `test/console-stack.test.ts`
  reads each behaviour from the synthesized template.
- **One source for addresses.** `ui/src/app-runtime/surface.ts` holds
  `consoleAppBase`, `appRuntimeFolder`, `appRuntimeModules`,
  `appRuntimeStylesheet`, `designSystemMajor`, `appRuntimePointerPath`,
  `appRuntimePointerBase` and `runtimeBuildPath`. The stack, the pointer
  generator, the kit, the stand-in and the tests read them; change an address
  there only. `buildVersionSource` and `isBuildVersion` there are the one
  definition of a build version (no build metadata), shared by the path
  helpers, the manifest schema and the `RuntimeBuildPath` function.
- **The generator.** `designSystemPointer` in `lib/design-system-pointer.ts`
  gives each module in `appRuntimeModules` a one-line re-export by a relative
  address, so it resolves wherever the Console app is served, and writes
  `pointer.json`. The stack installs it with `DeployDesignSystemPointer`, which
  depends on `DeployRuntime` and invalidates `/ui/v<major>/*`. Keep
  `prune: false` and `retainOnDelete: true` on both deployments, so earlier
  builds and other majors' pointers stay.
- **Cache headers and refusals.** `runtime/*` sends `RUNTIME_BUILD_CACHE_CONTROL`
  (`public, max-age=31536000, immutable`); `ui/*` and the default behaviour send
  `REVALIDATED_CACHE_CONTROL` (`no-cache`) with the bucket's ETag, so an
  unchanged pointer, page or token stylesheet answers `304`. Both policies keep
  the security headers and the browser policy. The `RuntimeBuildPath`
  viewer-request function sends any `runtime/` path outside a build's
  `app-runtime/` or `assets/` to a key no deployment writes, which the bucket
  answers with `403`, so a build's page, `runtime-manifest.json` and token
  stylesheets are never served at its immutable path.
- **App stylesheet and mount.** The UI build writes the design system's rules
  for apps, unhashed, at `app-runtime/design-system.css`, and Vite's manifest
  at `.vite/manifest.json`. `mountApp(App, target, source?, { tokenStylesheet? })`
  links the stylesheet beside its own module and the token stylesheet, each
  once per page, renders the app only after both load and shows the stop line
  (`data-app-error`) when one fails. The host names the token stylesheet; an
  app never links a stylesheet.
- **Stand-in.** `e2e/support/runtime-distribution.ts` serves the installed
  stand-in's build as the stack does: the same paths, cache headers and ETags,
  `304` on a matching `If-None-Match`, and `403` for a missing key or a refused
  build path, never the page. Change it with the stack's behaviours;
  `test/runtime-distribution.test.ts` checks it.
- **Fixture builds.** `e2e/support/design-system-fixtures/builds.ts` defines
  three builds of the real UI sources with some exports replaced: `a`
  (Console's version, `Button` in a chunk loaded on first use), `b` (`a` with an
  outline-look `Button` taking the same props) and `n` (the next major, whose
  `Stat` drops the `tone` that `sample-app` passes).
  `e2e/support/design-system-builds.ts` builds and packages them and records
  each one's version, digest, path and lazy chunks in `builds.json`; the same
  sources give the same digests.
- **The `sharing` project.** Playwright runs `*.sharing.spec.ts` in the
  `sharing` project with one worker, because every test moves the same pointer.
  Its stand-in serves the fixture builds (`DESIGN_SYSTEM_BUILDS`) and moves a
  major's pointer on `POST /__harness/design-system/pointer` with
  `{ "version", "digest" }`, as an install does, refusing a build it does not
  serve. Run it with
  `pnpm app-kit:build && pnpm exec playwright test --project sharing`.
- **Tests.** `SH-1` is in `test/app-kit.test.ts`. `SH-2` and `SH-7` are in
  `e2e/runtime-sharing.installed.spec.ts`, which opens `sample-app` on a test
  host page on the stand-in's origin under the stack's browser policy
  (`e2e/support/sample-app-host.ts`). `SH-3` to `SH-6` are in
  `e2e/runtime-sharing.sharing.spec.ts`.
- **Nothing hardcoded in a test.** Read versions from `package.json`, a build's
  path and digest from `pointer.json` or `builds.json`, and chunk file names
  from the build's `.vite/manifest.json`. Never write a version, digest or
  chunk file name into a test.
- **Built by app hosting.** The version check at publish and loading an app in
  the Console page on one React came with [app hosting](app-kit.md#app-hosting-implementation-rules)
  (runtime 1.17.0 and 1.18.0): the page's entry imports no React and loads the
  mount module through the pointer. A pointer API is still not built.

## Design-system configuration implementation rules

These rules describe design-system configuration in runtime 1.20.0
([Console pull request 38](https://github.com/prismteam-ai/console/pull/38), not
yet merged). The routes, bodies and answers are authoritative only in
`requirements/swagger.yml` and the README's "Design-system configuration"
section. Keep these rules when changing it.

- **Layout.** The schema, the default configuration, the stylesheet generator
  and theme resolution are in `src/domain/design-system-configuration.ts`; the
  lifecycle in `src/application/design-system-service.ts`, composed with app
  hosting in `ConsoleService` so each publish checks the other. The environment
  is the account: revisions and the selection live in Metadata's
  `ACCOUNT#<id>#DESIGN_SYSTEM` partition and the document at
  `accounts/<id>/design-system/revisions/<revisionId>/configuration.json`.
- **Closed schema.** Every object is strict. A color is `#rrggbb`, `#rrggbbaa`
  or `rgba(r, g, b, a)`; radii and the spacing unit are px on fixed scales; the
  font is one Console serves (`tasa-orbiter`); a scheme or accent apps may
  choose must be defined. So code, credentials and addresses fit nowhere. Any
  invalid value answers `400` `BAD_REQUEST` with one issue per path and nothing
  is written. `revisionId` derives from the validated document's digest.
- **Routes.** Under `/accounts/{accountId}/design-system`: `POST revisions`
  (`console:configure`, `Idempotency-Key`), `GET revisions/{revisionId}`,
  `POST revisions/{revisionId}/publish` (`console:publish`, `If-Match`),
  `POST rollback` and `GET active` (`304` on `If-None-Match`; its `ETag` is the
  publish marker). Submit and publish pass the provenance gate
  (`designSystemRevision`, `designSystemPublication`); rollback is ungated. A
  browser session gets `403` on all of them.
- **One stylesheet, one address.** `GET /console/design-system/tokens.css`
  (`designSystemStylesheetPath` in `surface.ts`) generates the stylesheet from
  the active revision, Console's default (equal to `tokens-a`) before the first
  publish. It is public, as every address a `<link>` loads, holds custom
  properties only, and answers `Cache-Control: no-cache` with its digest as
  `ETag`. It is a gateway-mode route (`public_routes`, nag suppressions) beside
  the `/viewer` routes; move it with them when account-mode browser sign-in
  lands. App pages link it and nothing else for tokens; `?tokens=` applies to
  Console's own pages only.
- **Density is a token.** Every gap and padding is a multiple of `--ds-space`
  (Tailwind's `--spacing` points at it), which every token set defines. Add no
  component variant for density.
- **Status codes.** An app version that uses a component the active
  configuration switches off answers `422` `INCOMPATIBLE_VERSION` with a
  `component_switched_off` issue, on publish and on rollback; the check is in
  `design-system-installation.ts`. A revision that switches off a component an
  app's active version uses answers `409` `CONFIGURATION_IN_USE` naming each app
  and component. Neither raises an alarm; never answer either refusal with
  `412` or `ARTIFACT_DIGEST_MISMATCH`.
- **Theme choices.** An app declares `colorScheme`, `density` and `accent` in
  `console-app.json`. `ActiveAppView.theme` holds only the choices the
  configuration lets apps make, and the view's `ETag` changes with them. The page
  sets each as `data-ds-<choice>` on the root (`themeChoiceAttributes` in
  `surface.ts`) and the stylesheet answers each allowed value; anything else
  takes the environment's default.
- **Packs.** Packs are modelled only as `packs.<name>.{version, switchedOff}`;
  nothing builds or loads one until `component-packs`.
- **Tests.** `DC-1` to `DC-6` at API level in
  `test/design-system-configuration.test.ts`; the browser halves of DC-1, DC-3,
  DC-4, DC-5 and DC-6 in `e2e/design-system-configuration.configuration.spec.ts`,
  in the serial `configuration` Playwright project on two stand-ins of its own
  (`e2e/support/stand-ins.ts`). Fixtures `tokens-a`, `tokens-b` and
  `tokens-invalid` are in `fixtures/design-system/`; `compact-app` is derived
  from `sample-app` in `test/support/app-kit.ts`. DC-3's pack half edits a
  kit-built record, because no pack exists to build one.
- **Open gaps.** Record these before relying on the piece:
  - Per-component allowed variants and defaults, which the contract names, are
    not modelled; variants are closed types today.
  - An app publish and a configuration publish racing in one account can both
    commit: each checks the other's committed state, but no shared condition
    guards the two transactions. Closing it needs a guard in both repository
    publish transactions (the design-system selection's etag in the app
    publish, or a per-account fence both bump).
  - Deploy has no `console` `design-system` bundle kind (`tinkaton`,
    `corviknight`), so do not set `ConfigurationProvenance` `Enabled` where a
    configuration is installed, and do not install one by hand in a shared
    environment.

## Kit maintenance

When this contract changes, update `agents/chandelure.md`,
`skills/build-console-product/SKILL.md`, the Console capability map in
`skills/guide-product-work/reference/iterations/console.md`, the Console notes
in `skills/guide-product-work/reference/product-catalog.json`, bump the plugin
version in every manifest and marketplace entry, and regenerate Copilot, Codex,
Claude Code and Enact agent copies per `AGENTS.md`.
