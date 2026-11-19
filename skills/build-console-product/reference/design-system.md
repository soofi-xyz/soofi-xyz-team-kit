# Console design system

Use this contract for Console's shared design system: tokens, base components
and the component gallery. Read it before any change to base UI components,
tokens, themes or the gallery. A change that weakens a guarantee below is a
defect, even when the change was about something else.

Chandelure owns this surface in `prismteam-ai/console`. Vivillon configures
applications that consume it; route missing components, tokens or gallery gaps
to Chandelure. Discover the target revision before claiming any part is
deployed.

## Look

Take the look from the debt-collection demo / prismteam.ai style. Prefer these
names and settle exact CSS values in the Console repository:

| Token family | Role | Demo source |
| --- | --- | --- |
| `paper` | page ground | `#f8f8f6` |
| `surface` | raised panels and cards | demo surface |
| `ink` | primary text | demo ink |
| `iris` | primary / accent | `#4845d2` |
| `go` | cleared, delivered, success (ink-weight, not loud green) | semantic go |
| `stop` | failure, legal stop, destructive | semantic stop |
| `wait` | waiting on a person | semantic wait |

Shape and type rules:

- Use rounded squares, not circles, for controls and panels.
- Use the TASA Orbiter stack for UI type.
- Do not use multi-layer shadows. Prefer flat surfaces, hairlines and token
  contrast over depth stacks.

Color carries meaning: iris for primary action and selection, go / stop / wait
for semantic state. Do not invent a second palette inside application code.

## Ownership

Console owns, in `prismteam-ai/console`:

- design tokens (color, type, spacing, radii) and how they ship as stylesheets;
- base components built on those tokens;
- the gallery that renders every exported component in every variant.

Applications and configuration consume the design system; they do not fork
component source or hard-code colors, radii or typefaces that belong in tokens.

## Token sets

Ship at least two complete token sets (for example `tokens-a` and `tokens-b`).
Switch the active token set at runtime by changing which token stylesheet the
shell loads. Do not rebuild components or applications to change look. A token
change must reach the gallery and every consuming page without a new component
build digest.

## Variants

Expose visual variants as closed TypeScript unions on component props. An
unknown variant must fail compilation. Do not accept free-string variant names,
open enums or runtime fall-through that silently renders a default for an
unrecognized value.

## Definition of done

The `design-system` piece is done only when every check below exists as an
automated test whose name starts with its ID and passes. Phone, tablet and
desktop widths are 390, 768 and 1280 px unless the Console repository fixes
others. Record one evidence row per check: ID, result, request or run
identifier and the Console revision.

| ID | Do | Pass when |
| --- | --- | --- |
| DS-1 | Open the gallery at phone, tablet and desktop widths and screenshot every exported component in every variant | Every exported component is present and each screenshot matches its stored baseline |
| DS-2 | Tab through every interactive component in the gallery, operate it by keyboard and run the accessibility scan on the page | Each can be reached, operated and left by keyboard with visible focus; the scan reports no violation |
| DS-3 | Load the gallery with token set `tokens-a`, then switch the token stylesheet to `tokens-b` without rebuilding the components | Every component's computed colors and radii follow `tokens-b`; the design-system build digest is unchanged |
| DS-4 | Type-check a fixture that gives a component a variant that does not exist | The type-check fails on that line |

## Cumulative scenario

Run this after `DS-1` through `DS-4` all pass individually. It is acceptance
for the design-system piece as a whole.

| Step | Do | Pass when |
| --- | --- | --- |
| 1 | Open the gallery under `tokens-a` at phone, tablet and desktop | `DS-1` baselines match under `tokens-a` |
| 2 | Run the keyboard path and accessibility scan on that gallery | `DS-2` passes |
| 3 | Switch to `tokens-b` without rebuilding components, reload the gallery and re-screenshot | Look follows `tokens-b`; component build digest unchanged (`DS-3`); screenshots differ from the `tokens-a` baselines where tokens differ |
| 4 | Attempt to type-check the unknown-variant fixture against the same revision | `DS-4` still fails compilation |
| 5 | Switch back to `tokens-a` and re-open the gallery | Prior look restored without a rebuild |

## Implementation rules

Runtime 1.14.0 of `prismteam-ai/console` implements this contract. Keep these
rules when changing it; each one is checked by a test or a type check.

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
  escape hatch; add a variant instead.
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
`theme.tokens` still drives the renderer's own components. Treat manifest-level
token-set selection and moving renderer components onto the design system as
later Chandelure work with their own schema, compatibility and capability
changes; do not have Vivillon configure them until they ship.

## Kit maintenance

When this contract changes, update `agents/chandelure.md`,
`skills/build-console-product/SKILL.md`, the Console capability map in
`skills/guide-product-work/reference/iterations/console.md`, the Console notes
in `skills/guide-product-work/reference/product-catalog.json`, bump the plugin
version in every manifest and marketplace entry, and regenerate Copilot, Codex,
Claude Code and Enact agent copies per `AGENTS.md`.
