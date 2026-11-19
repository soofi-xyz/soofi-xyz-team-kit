# Console design system

Use this contract for the components and tokens Console serves, how apps load
them without bundling them, how an environment configures them, component packs
and the dashboard reskin. It is the target design. Read it before any change to
base components, tokens, themes or the gallery; a change that weakens a
guarantee below is a defect, even when the change was about something else.

As of 2026-11-19 none of it is on the Console repository's `main` (runtime
1.13.0). Pull request 31 there (runtime 1.14.0, open) adds the tokens, two token
sets, ten base components, the gallery and tests named `DS-1` to `DS-4`, by
[the implementation rules](#implementation-rules). Its components are
hand-written under the demo's names (`Pill`, `Panel`, `Toggle`, `Segmented`),
so the starting point, the names and `DS-5` below are not met yet: restart
those components from shadcn and keep the tokens, gallery and tests. Discover
the target revision before relying on any part, and settle names marked as
placeholders in the Console repository.

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
  changes once written, such as `/console/ui/<version>/<digest>/`, as the
  runtime is stored today. Addresses here are illustrative.
- **Pointer.** Keep one small module per major version at a fixed address, such
  as `/console/ui/v2/index.js`, holding one line:

  ```js
  export * from "/console/ui/2.4.1/abc123/index.js";
  ```

  Console rewrites it on install or rollback. Provide the same pointer for the
  JSX wrapper and for React.
- **App builds.** The app kit's build settings mark the design system and React
  as external and write the pointer address into the app's built file. The app
  author never sets this.
- **One React.** The app loads React from the design-system build, so the page
  has one copy and hooks and context work across the boundary. Use client-side
  React only; Server Components do not work with this sharing.
- **Stylesheets.** The shell links the active build's stylesheet and the
  environment's token stylesheet, both from Console's own origin.
- **Caching.** Serve the pointer so the browser revalidates it on every page
  load, and everything it points to as immutable and cached for a long time.
- **One version per session.** Every address after the pointer includes the
  exact build, so an open tab keeps one consistent version until it reloads.
- **Major versions side by side.** A breaking change gets a new pointer (`v3`).
  Apps built for `v2` keep loading `v2` until each is updated. Never remove a
  build that a pointer or a published app still needs.
- **Version check.** Build records the minimum design-system version an app
  needs and the components it uses. Console refuses to publish the app where
  the installed version is older or a component is missing or switched off.
- **Release safety.** Every app on a major version receives a change at once.
  Run the gallery screenshot tests, install on a dev environment first and roll
  back by pointing the line back.
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
  base build and then name the replacement, so the named export wins:

  ```js
  export * from "/console/ui/2.4.1/abc123/index.js";
  export { Badge } from "/console/ui/packs/acme/1.0.0/def456/index.js";
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
| SH-6 | Add a `v3` pointer whose build removes a prop that `sample-app` uses, then open the app built for `v2` | The app still renders from the `v2` build |
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
request 31 in `prismteam-ai/console`, open as of 2026-11-19). Keep them when
changing that code or restarting its components from shadcn; each one is
checked by a test or a type check.

- **Layout.** Components, `catalog.ts`, `tokens.ts` and `design-system.css` live
  in `ui/src/design-system/`; import them through `index.ts`. The gallery is
  `ui/src/design-system-gallery.tsx`, opened at `?gallery`.
- **Catalog.** `catalog.ts` imports nothing and holds `componentNames`, every
  variant union and `tokenSets`. Add a component to `componentNames`, the
  gallery's `examples` map and `requiredVariants` in
  `e2e/support/design-system.ts`; the UI type check fails while `componentNames`
  and the capitalized function exports of `components.tsx` disagree.
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

Applications cannot choose a token set from their manifest yet; the existing
`theme.tokens` still drives the renderer's own components. Choosing an
environment's tokens is the `design-system-configuration` piece and moving the
renderer's components onto the design system is `renderer-reskin`; do not have
Vivillon configure either until it ships.

## Kit maintenance

When this contract changes, update `agents/chandelure.md`,
`skills/build-console-product/SKILL.md`, the Console capability map in
`skills/guide-product-work/reference/iterations/console.md`, the Console notes
in `skills/guide-product-work/reference/product-catalog.json`, bump the plugin
version in every manifest and marketplace entry, and regenerate Copilot, Codex,
Claude Code and Enact agent copies per `AGENTS.md`.
