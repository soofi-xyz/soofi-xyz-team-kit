# Console app kit

Use this contract for the package an app is built with, the guardrails that
keep an app inside the design system, app hosting, the data hooks, local
development, delivery and the reference app. It is the target design. As of
2026-11-20 the `app-kit` piece is built in the Console repository (pull request
33, runtime 1.15.0) by [the implementation rules](#implementation-rules):
the package, the guardrails, local development on sample data and `AK-1` to
`AK-11`. Pull request 34 (runtime 1.16.0, on `main`) builds apps against the
design-system pointer of the kit's own major
([runtime sharing](design-system.md#runtime-sharing)). App hosting, the data
hooks through Console's API, delivery and the reference app are not built.
Discover the target revision before relying on any part, and settle names
still marked as placeholders in the Console repository.

Read it with [the product contract](PRD.md) and
[the design system](design-system.md). The [Tests](#tests) section defines done
for the `app-kit`, `app-hosting`, `data-hooks`, `app-delivery` and
`reference-app` pieces.

## App kit

The app kit is one package, `@prism/console-app-kit`, in the Console
repository's `app-kit/` directory. An app depends on it and on nothing else for its
interface.

- **Contents.** The component types; a local copy of the components for
  development; the data hooks; the JSX wrapper that refuses raw elements; the
  check tool; a scaffold that creates a new app; and the build settings.
- **One version.** The kit's version is the design-system version, so the local
  copy and an environment's installed version are directly comparable.
- **Technology.** Apps are client-side React with TypeScript, built with Vite.
  The kit owns the bundler and compiler settings; an app has none of its own.
- **An app's source.** Pages and logic written as ordinary React that imports
  only from the kit, a settings file, and one sample-data file per binding.
  There are no style files.
- **Settings file.** Declare the app's identity and title, the design-system
  version range and packs it needs, its bindings and actions in the shape a
  dashboard manifest uses (product, operation, parameters, required scopes,
  page parameters), the roles that may open it, and any theme choices.
- **Authors.** An agent writes the app; Vivillon is the author for business
  people. The kit must give that agent a component catalog generated from the
  design system (names, props, variants, one example each) and a check it can
  run and read.

## Guardrails

An app can be built only from the design system. Enforce that in layers, each
closing a different route, and do not rely on the author behaving.

| Layer | What it stops |
| --- | --- |
| Components served by Console | An app cannot alter or fork them, because it does not ship them |
| Component types | No `className` or `style`; variants and style props accept only listed values and token names, so anything else does not compile |
| JSX wrapper | A raw element such as `<div>` does not compile and is refused in the browser |
| Reduced React | No second way to create elements and no DOM references |
| Check, required to publish | Style files, other dependencies, network calls and direct DOM access |
| Browser policy | Calls, scripts and styles from anywhere but Console's own origin |

- **JSX wrapper.** Compile an app's JSX against the kit's JSX runtime through
  the compiler's standard `jsxImportSource` setting, set by the kit. The
  runtime is a thin wrapper over React's own that refuses a string tag, and its
  types declare no HTML elements:

  ```ts
  import { jsx as reactJsx } from "react/jsx-runtime";

  export function jsx(type, props, key) {
    if (typeof type === "string") {
      throw new Error(`<${type}> is not allowed; use a design-system component`);
    }
    return reactJsx(type, props, key);
  }
  export { jsx as jsxs };
  export { Fragment } from "react/jsx-runtime";
  ```

  ```ts
  export namespace JSX {
    interface IntrinsicElements {}
  }
  ```

  The design system's own components keep React's normal runtime, so they
  render real elements inside. This is not a compiler; the standard one stays.
- **Reduced React.** Serve apps a React that exports hooks only. Leave out
  `createElement`, `cloneElement` and `react-dom`, so an import of any of them
  fails to build and fails to load.
- **Check tool.** One command that runs the type-check and these named rules,
  and prints each violation with its rule name, file and line:

  | Rule | Refuses |
  | --- | --- |
  | `raw-element` | a lowercase JSX tag or an element created by string name |
  | `class-name` | `className` or `style` passed to a component |
  | `off-scale-value` | a style prop value that is not a token name |
  | `css-file` | a style file, or a style import, in the app's source |
  | `foreign-dependency` | a dependency or import outside the allowlist (the kit and installed packs' type packages) |
  | `network-call` | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource` or `navigator.sendBeacon` |
  | `dom-access` | `document`, direct `window` DOM access, `element.style` or `innerHTML` |

  It also reads the bundler's input list and fails when any built input comes
  from outside the app's own source, when the output holds a stylesheet or a
  copy of the design system, and it writes the build record: the components and
  packs used and the minimum design-system version.
- **Where the check runs.** The agent runs it locally and fixes its own
  violations. Build runs it as the gate: a failing app is never built into a
  publishable bundle. Console checks at publish that the build record shows a
  passed check and that every component and pack it lists is present and
  switched on.
- **Browser policy.** Keep `connect-src 'self'; script-src 'self'; style-src
  'self'` on everything Console serves, so an app cannot call another origin or
  load outside scripts and styles.
- **Limits to state.** Direct browser calls cannot be removed from JavaScript;
  `dom-access` is a static check. It stops an agent drifting, not a person
  deliberately hiding a bypass. Composition rules that cannot be typed, such as
  one main visual per page, need a screenshot review on each pull request.

## App hosting

Console stores and serves apps; nothing else hosts them.

- **Registry.** Keep, per account, each app's identity, its immutable versions
  and one active selection.
- **Versions.** A version is the app's built files, each with its digest, and
  the build record. Store it at an immutable path. Refuse a version whose files
  do not match their digests or whose build record is missing, and save
  nothing.
- **Operations.** Create an app idempotently; submit a version idempotently;
  publish with optimistic concurrency; read the active selection; roll back to
  a prior published version. Return stable identities and correlation IDs. The
  routes are authoritative only in `requirements/swagger.yml`.
- **Publish checks.** Refuse to publish where the installed design-system
  version is older than the version needs, or a component or pack it uses is
  missing or switched off. Name what is missing.
- **Authorization.** Require `console:configure` to submit and
  `console:publish` to publish or roll back, checked server-side. These are
  operator and Deploy calls with the environment key, never browser-session
  calls.
- **Provenance.** Put create, submit and publish behind the provenance gate, as
  the dashboard routes are. Rollback only re-points the selection.
- **Shell.** After sign-in the shell loads the active version of the app named
  in the address. Without a session it loads no app code and no data. Two
  materially different apps run on one runtime with no change to the runtime.
- **Retirement.** As of 2026-11-20 Console has no app delete and no route to
  retire a version. Decide retirement in the Console repository before
  promising it.

Built in runtime 1.17.0 (the API, pull request 35) and 1.18.0 (the shell, pull
request 36), both on `main`; see
[App hosting implementation rules](#app-hosting-implementation-rules).

## Data hooks

Give apps a one-line way to read data and run actions, with Console's API as
the only path.

- **Hooks.** One hook reads a declared binding and one invokes a declared
  action (`useBinding`, `useAction` are placeholders). Each returns the data
  and an explicit state: loading, empty, denied, timed out or failed. The
  components render those states; an app never shows a blank page.
- **Declared only.** A binding or action must be in the app's settings. Console
  refuses, server-side, a read of anything the active version did not declare.
- **Registered operations.** Each binding names a registered product operation
  with typed input and output and a bounded timeout. An unregistered operation
  is refused when the version is submitted. As of 2026-11-18 the only
  registered operation is `report` / `read-dataset`; register Persist reads and
  the others an app needs with their owning builders.
- **As the person.** Check route, binding and action scopes on every request.
  Call the owning product with the signed-in person's Access token, never the
  shared key, so two people see their own records on the same page.
- **Refresh.** Let the browser revalidate a binding so unchanged data is not
  downloaded again and a newer Report refresh appears with no app change.
- **No other path.** App code never calls `fetch`, another product or another
  origin; the check and the browser policy both refuse it.
- **Computation stays with products.** An app may compute over the rows it
  loaded. A "what if" run of rules, inference or scheduling belongs to the
  owning product; report its absence as a gap and do not imitate it in Console.

## Local development

An app runs locally against the copy of the design system inside the kit. No
Console is needed.

- **Components.** In development the kit's settings resolve the design-system
  import to the local copy, with the real components and the JSX wrapper. In
  the production build the same settings switch that import to the pointer
  address. The app's source is identical in both.
- **Sample data.** By default the data hooks read each binding's sample-data
  file. Make no network call and need no sign-in.
- **A real dev environment.** Optionally forward data calls to a dev
  environment's Console with sign-in through Access. This needs Access to
  accept a local return address, which is not verified; treat it as a gap for
  `aegislash` until it is.
- **Look.** Ship the default tokens and let the kit download an environment's
  token stylesheet for preview.
- **Same as deployed.** Have the check warn when the target environment's
  design-system version differs from the local copy. Publish every pull request
  to a dev environment as a preview that runs against the real shared
  components; this is what the business person approves.

## Delivery

Keep building with Build, catalog review with Marketplace and installation with
Deploy. Console receives only delivered, reviewed output.

- **The kit.** Publish the kit, and each pack's types package, into Build's
  package registry (its CodeArtifact domain, `build-<stage>`) when the design
  system is released, with the same version. Build's runner installs only from
  that registry and rejects an `.npmrc` in a product's source, so the registry
  address comes from the kit's setup or the user's own settings, never from a
  file in the app's repository. Publishing a private package there is new work
  for `tinkaton`; whoever builds apps needs read access to that registry.
- **Bundle kinds, product `console`.**

  | Kind | Carries | State as of 2026-11-18 |
  | --- | --- | --- |
  | `application` | dashboard manifest | on Build's and Deploy's main; installation in an environment not verified |
  | `design-system` | design-system configuration | target |
  | `app` | app source that Build builds and checks | target |
  | `component-pack` | pack source that Build builds and checks | target |

  `app` and `component-pack` need a build step and a check gate, which
  configuration bundles do not run today. `tinkaton` settles their bundle type
  and `corviknight` their adapters; the names are targets until both merge them.
- **An app's path.** A merged pull request; Build installs, checks and builds;
  Marketplace reviews and publishes; Deploy creates the app if missing, submits
  the version, publishes it and reads back the active digest, all through
  Console's API. Installing the same bundle again changes nothing.
- **A design-system release.** It is a Console runtime release: Deploy installs
  it, Console moves the pointer and no app file changes.
- **Keep the contract Deploy uses.** Idempotent create and submit, immutable
  versions with a digest, optimistic publish, active read-back and the account
  from `GET /session`. A breaking change needs a versioned migration agreed
  with `corviknight` and `tinkaton`.
- **Not Console's.** Do not add a hosting or build path outside Build,
  Marketplace and Deploy, and do not have Console build or check sources itself.

## Reference app

Prove the whole path by rebuilding the Rules step of the debt-collection demo
from the kit only.

- Use only design-system components: the page frame, controls beside results, a
  switch per rule, a badge for legal stops, bars for accounts held back and the
  stats for cleared accounts.
- Load one dataset of per-account rule results through a declared binding and
  compute the cleared count in the app from those rows. Do not add a rule
  engine to Console.
- Add to the design system, or to a pack, any part the step needs that does not
  exist yet. Do not style it in the app.
- Use synthetic data from [the test data](test-data.md). Put no real name,
  number or creditor in the app or its samples.

## Tests

Name each automated test by its ID. A piece is done only when every test in its
table passes. Repository tests run in Playwright, or as a check-tool run in the
same job, against the installed stand-in (the production build and the real
API, with only AWS replaced) on every pull request. Deployed checks are run by
the user on a dev environment: one command and at most three things to inspect.
Use the fixtures in [the test data](test-data.md).

### `app-kit`

Level: repository.

| ID | Do | Expect |
| --- | --- | --- |
| AK-1 | Create a new app with the scaffold in an empty directory, start it locally and open its first page | The page renders its sample data; the browser made no request beyond the local server |
| AK-2 | Run the check on `sample-app` | It passes and writes a build record listing the components used and the minimum design-system version |
| AK-3 | Run the check on `violation-raw-element`, which renders a `<div>` | It fails with rule `raw-element` at that line |
| AK-4 | Run the check on `violation-class-name`, which passes `className` to `Button` | It fails with rule `class-name` at that line |
| AK-5 | Run the check on `violation-off-scale`, which sets `gap="13px"` on `Stack` | It fails with rule `off-scale-value` at that line |
| AK-6 | Run the check on `violation-css-file`, which imports a style file | It fails with rule `css-file` |
| AK-7 | Run the check on `violation-dependency`, which imports another interface library | It fails with rule `foreign-dependency` naming the package |
| AK-8 | Run the check on `violation-fetch`, which calls `fetch` | It fails with rule `network-call` at that line |
| AK-9 | Run the check on `violation-dom`, which calls `document.createElement` | It fails with rule `dom-access` at that line |
| AK-10 | Load on the stand-in a hand-built bundle that calls the JSX wrapper with the string tag `div`, bypassing the check | The wrapper throws its "not allowed" error and nothing from that tag is rendered |
| AK-11 | Build, then load, a fixture that imports `createElement` from React and another that imports `react-dom` | Each fails to build; a hand-built bundle of each fails to load because the export or module does not exist |

### `app-hosting`

Level: repository.

| ID | Do | Expect |
| --- | --- | --- |
| AH-1 | Create `sample-app`, submit its version, publish it and open it by address | Each call succeeds; the app renders; the active read-back shows the submitted version and digest |
| AH-2 | Publish `sample-app-two`, with different pages and components, on the same runtime | Both apps open by their own addresses; the runtime digest is unchanged |
| AH-3 | Publish a second version of `sample-app` using the version marker read before another publish moved it | Refused as a concurrent change; the active selection is unchanged |
| AH-4 | Roll `sample-app` back to its first version and reload | The first version renders and the active read-back shows it |
| AH-5 | Submit a version in which one file's content does not match its digest | Refused naming the file; no version is saved |
| AH-6 | With a caller that holds `console:configure` but not `console:publish`, submit a version and then publish it | The submission is saved; the publish is refused with `403`; the active selection is unchanged |
| AH-7 | With provenance set to `Enabled`, submit a version without Deploy's signature | Refused with `PROVENANCE_REQUIRED`; nothing is written |

### `data-hooks`

Level: repository.

| ID | Do | Expect |
| --- | --- | --- |
| DH-1 | Open a `sample-app` page whose hook reads a Report dataset, then publish a newer refresh of that report and wait one refresh interval | The page shows the dataset's values, then the newer refresh's values, with no app change |
| DH-2 | As `alice` and then as `bob`, open the same page whose hook reads items from Persist | `alice` sees `item-a1` and `item-a2`; `bob` sees none; each outbound call carried that person's token |
| DH-3 | Request, with a valid session, a binding that exists in Console but is not declared by the active app version | The server refuses it; no upstream call is made |
| DH-4 | As a user without the binding's scope, open the page | The server answers `403` and the page shows the denied state, not an empty table |
| DH-5 | As a user with the action's role, run an action from the page | It runs, and the owning product records that person as the caller |
| DH-6 | Make the upstream operation exceed its timeout | The page shows the timed-out state with a correlation ID; no blank page and no upstream payload is shown |

### `app-delivery`

Level: deployed, on a dev environment with Build's and Deploy's changes.

| ID | Do | Expect |
| --- | --- | --- |
| AD-1 | Merge a bundle holding `sample-app` and let it run through Build, Marketplace and Deploy | The app opens in the environment; Console's active digest equals the digest Deploy reported |
| AD-2 | Install the same bundle again | Deploy reports no change and Console's active selection is the same version |
| AD-3 | Push a bundle holding `violation-raw-element` | It stops at Build with the `raw-element` finding; nothing reaches Marketplace or Console |
| AD-4 | Install a design-system configuration bundle carrying `tokens-b` | The environment's apps and dashboards take the new look on reload; no app version changed |
| AD-5 | Install a Console release with a new design-system build | The pointer names the new build; every app's active version and digests are unchanged |
| AD-6 | In a clean directory, install the kit from Build's registry and print its version | The install succeeds and the kit's version equals the released design-system version |
| AD-7 | Deliver `sample-pack` as a pack bundle, then push `bad-pack` | `sample-pack`'s components load in the environment; `bad-pack` stops at Build and nothing is installed |

### `reference-app`

Level: repository for RA-1 and RA-2; deployed for RA-3; RA-4 is a recorded
human review.

| ID | Do | Expect |
| --- | --- | --- |
| RA-1 | Run the check on the reference app | It passes; its source holds no style file and imports only from the kit |
| RA-2 | Open the reference app and switch one rule off | The cleared count rises by the number of accounts only that rule held back, and the rule's bar empties |
| RA-3 | Deliver the reference app to a dev environment through the `app-delivery` path and open it signed out, then signed in | Signed out it redirects to sign-in and loads no data; signed in it renders |
| RA-4 | Give the designer screenshots at phone, tablet and desktop widths beside the demo's Rules page | The designer records acceptance, or a list of design-system changes to make before acceptance |

## Implementation rules

These rules describe the app kit in runtime 1.15.0 (pull request 33 in
`prismteam-ai/console`) and its build against the pointer in 1.16.0 (pull
request 34, on `main`). Keep them when changing it; each one is checked by a test or
a type check.

- **Layout.** The kit's package is `app-kit/` (`package.json`, the `console-app`
  command in `bin/`, Node sources in `src/`, the scaffold in `template/`, the
  catalog examples in `catalog/examples.tsx`, `sample-app` in
  `fixtures/`). What apps run is in the UI tree, `ui/src/app-runtime/`:
  `index.ts` (what an app imports), `react.ts` (the reduced React),
  `jsx-runtime.ts` and `jsx-dev-runtime.ts` (the wrapper) and `mount.tsx` (the
  host side, never imported by an app: `mountApp(App, target, source?,
  { tokenStylesheet? })` links the build's stylesheet and the token stylesheet
  and renders once both have loaded). `pnpm app-kit:build` builds
  `app-kit/dist/`; `pnpm test` and `pnpm test:e2e` run it first.
- **One list per surface.** `ui/src/app-runtime/surface.ts` imports nothing
  and holds `reducedReactExports`, the runtime's module names, its address and
  the wrapper's error text. The reduced React, the build plugin, the check and
  the tests read it; a unit test keeps `react.ts`'s exports equal to the list.
  Add an export only if it creates no element and reaches no DOM.
- **Version.** `app-kit/package.json` has Console's `package.json` version (the
  design-system version); `pnpm app-kit:build` refuses to build when they differ.
  Bump both together.
- **Two copies of one runtime.** Console's UI build emits the runtime at fixed
  names under `app-runtime/`, with `design-system.css` beside them, sharing the
  renderer's React chunk; every install serves that folder at the build's
  immutable path and through the pointer of its major
  ([runtime sharing rules](design-system.md#runtime-sharing-implementation-rules)).
  The kit's `dist/runtime/` is the same sources built for development with
  React and react-dom bundled in, so `console-app dev` needs no network and no
  dependency pre-bundling. An app's production build marks the kit, its JSX
  runtime and `react` external at the pointer of the kit's own major,
  `/console/app/ui/v<major>/` (`kitPointerBase` in `app-kit/src/vite.ts`), and
  the build record names it as `designSystem.pointer`. Change addresses in
  `surface.ts` only.
- **Build settings.** The kit sets `configFile: false`, `envFile: false`,
  `publicDir: false`, `jsxImportSource: "@prism/console-app-kit"` and
  `jsxDev` itself, and sets `NODE_ENV` for each command: Vite takes
  development JSX from `NODE_ENV`, which a test runner sets to `test`. A kit
  subpath with no Console address fails the production build.
- **Check order.** `console-app check` reads the settings and samples, runs the
  named rules and the type-check, and builds only when both pass. A type error
  on a line a named rule already explains is not reported, so each violation
  fixture fails with exactly its rule. `console-app build` builds without the
  rules and writes no record; only `check` writes `dist/build-record.json`, and
  a failing check leaves no `dist/`.
- **Rules use the compiler.** Network and DOM globals are found by resolving
  each identifier and testing whether TypeScript's DOM library declares it, so
  a local `const document` is not flagged. Timers, `console`, `URL` and the
  other globals in `harmlessDomGlobals` are allowed. An app's `tsconfig.json`
  must equal `APP_TSCONFIG`; a bundler, compiler or registry file in the app
  fails `build-settings`.
- **Rules beyond the seven.** `react-surface` (an import from React outside the
  reduced list, a default or namespace import of `react`, `react/*` or
  `react-dom`), `build-settings`, `settings` (the settings file, its
  `designSystem` range against the components used or leaving the kit's major,
  or a sample file; `console-app create` writes `>=<kit version> <<next major>.0.0`),
  `type-check`, `build-input`, `build-output` and `build`. Add a rule to
  `ruleNames` in `app-kit/src/violations.ts` and give it a fixture.
- **Components the check knows.** `catalog.ts` gives every component its first
  release in `componentReleases` (the build record's minimum version is the
  highest one used) and every token-only style prop its token names in
  `styleProps` (what `off-scale-value` reads). Adding a component also needs an
  example in `app-kit/catalog/examples.tsx`: the catalog quotes it and a test
  type-checks the file as app code.
- **Layout and text components.** `Page`, `Stack` and `Text` (Console's own,
  1.15.0) are what an app arranges and writes with. `Grid`, `Box` and `Bench`
  are still targets; add them to the design system when an app needs them.
- **Data hooks.** `useBinding` and `useAction` read a `DataSourceContext` the
  host supplies (`mountApp`'s `source`). Locally it is `sampleDataSource` over
  `samples/<binding>.json`; with no source every read is `failed`, never blank.
  The `data-hooks` piece adds Console's API as the installed source.
- **Fixtures.** `sample-app` is a directory; every violation fixture and the
  two `react-surface` fixtures are derived from it by exact edits in
  `test/support/app-kit.ts`, so they stay identical to it but for one
  violation. A test links the kit into a copy as a package manager would.
- **Tests.** `AK-2` to `AK-9` and the build half of `AK-11` run the command in
  `test/app-kit.test.ts`; `AK-1` scaffolds into a new directory and opens the dev
  server in `e2e/app-kit.spec.ts` (fixtures project); `AK-10` and the load half
  of `AK-11` import hand-built bundles from the installed stand-in's origin in
  `e2e/app-kit.installed.spec.ts`, which Playwright answers so the stand-in
  serves nothing it would not in production.

## App hosting implementation rules

These rules describe app hosting in runtime 1.17.0 and 1.18.0 (pull requests 35
and 36 in `prismteam-ai/console`). The routes, bodies and answers are
authoritative only in `requirements/swagger.yml` and the README's "App hosting"
section; keep both in step with the handlers, and `scripts/verify-openapi.ts`
lists every app path. Keep these rules when changing it.

- **A resource of its own.** Apps live under `/accounts/{accountId}/apps`,
  apart from the dashboard `applications`. Do not extend the manifest schema,
  Deploy's Console installer or Build's manifest schema to hold an app; Deploy
  has no app installer yet, so agree the upload format and error codes with its
  owner (`corviknight`) before building one.
- **One upload, verified before any write.** `POST .../versions` takes one JSON
  body: the build record `console-app check` wrote and each file as
  `contentBase64`. Console refuses the whole upload with `400` `BAD_REQUEST`,
  one `error.details.issues` entry per file and reason, and saves nothing,
  unless: the record parses with `check.passed: true` and the path's `appId`;
  the uploaded paths are exactly the record's, each a flat `.js` name; the
  record lists `app.js`, the entry a published app opens with; each file's
  sha256 and length match; each file is UTF-8 without a byte order mark
  (`not_utf8`), because the file route serves text and must serve the digest's
  exact bytes; and the files fit 50 files and 4 MiB. `versionDigest` is
  Console's digest of the validated record and `versionId` derives from it, so
  the same build is the same version; callers read both back.
- **Status codes mean one thing each.** `412` is the selection's state only (a
  stale or wrong `If-Match`, a lost race), checked first and changing nothing;
  `428` is a missing `If-Match`; `422` `INCOMPATIBLE_VERSION` is a version that
  cannot run here (`foreign_import`, `design_system_version`,
  `unknown_component`, `missing_pack`); `503` with `Retry-After` is a create
  that kept conflicting after Console's retries. `422` and `503` raise no alarm.
  The publish marker is the `etag` field of `active`'s body or the `ETag` of the
  last publish or rollback, never `active`'s `ETag` header, which is for
  `If-None-Match` only.
- **Publish checks live in one place.** The design-system checks a publish and a
  rollback run are in `src/domain/design-system-installation.ts`. The
  `design-system-configuration` piece adds "component switched off" there.
- **Scopes and provenance.** Create and submit need `console:configure`;
  publish and rollback `console:publish`; reads `console:read`. Create, submit
  and publish pass the provenance gate (Deploy's signature covers the exact
  upload bytes); rollback is ungated. A browser session never writes: under
  `/viewer` only `active` and the file route answer, everything else `403`.
- **What a browser reads.** `GET /viewer/.../apps/{appId}/active` answers
  `ActiveAppView`: what loads the app and nothing the record declares (no
  binding, action, role, scope or parameter). The file route serves one file of
  a published version as `text/javascript; charset=utf-8` with `nosniff`,
  `private, max-age=31536000, immutable`, `Vary: Authorization, Cookie,
  x-api-key` and the digest as `ETag`, checks the name against the file-name
  rule before any read, and re-verifies the digest on every read (`409`
  `ARTIFACT_DIGEST_MISMATCH`, which alarms). A published version stays readable
  after a newer publish, so an open tab still loads its chunks.
- **The page.** `/console/app/?appId=<id>` opens an app; `?appId=` wins over
  `?app=`. `ui/src/entry.ts` imports no React; `ui/src/app-page.ts` checks the
  session, reads the view, refuses a `pointer` other than the page's own
  major's, imports `mount.js` through that pointer and then the entry by
  address, so the page holds one React. Never bundle the mount module into the
  page. Only a Google cookie session opens an app, because `import()` cannot
  send a header. Only a `401` means signed out; any other failed or malformed
  session answer shows "Your session could not be checked". A failed import of
  the page's own code shows a reload instruction, never a blank page. An app's
  default export may be a function or a `memo()` result.
- **Data until `data-hooks`.** `hostedDataSource` in `ui/src/app-page.ts`
  answers every read and action with "Data is not available in hosted apps
  yet". The build record already holds each binding's and action's full
  definition; `data-hooks` replaces that source.
- **Known limits.** The record's `roles` are not enforced, so any signed-in
  viewer of the environment opens any published app: dev environments only
  until `access-sign-in`. No delete route. Bindings and actions are not checked
  against registered operations at submit. The page ignores the view's
  `theme`. A denied Google sign-in returns to Console's home, not to the app.
  Whether the gateway passes an app file through as JavaScript and the session
  cookie on the shared domain are only visible on a deployed environment.
- **Tests.** `AH-3`, `AH-5`, `AH-6`, `AH-7` and the API half of `AH-4` run in
  `test/app-hosting.test.ts` against the real handler over in-memory stores;
  the page's loader in `test/app-page.test.ts` with fakes. `AH-1`, `AH-2` and
  the reload half of `AH-4` run in `e2e/app-hosting.google.spec.ts` (the
  `installed-google` project, signed in through the fake Google issuer):
  `sample-app` and `app-kit/fixtures/sample-app-two` are built with
  `console-app check`, published with the environment key and opened by
  address. Build fixtures with the kit; never hand-write a build record.
