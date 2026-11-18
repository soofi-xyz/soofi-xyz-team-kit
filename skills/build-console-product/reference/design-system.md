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

## Kit maintenance

When this contract changes, update `agents/chandelure.md`,
`skills/build-console-product/SKILL.md`, the Console capability map in
`skills/guide-product-work/reference/iterations/console.md`, the Console notes
in `skills/guide-product-work/reference/product-catalog.json`, bump the plugin
version in every manifest and marketplace entry, and regenerate Copilot, Codex,
Claude Code and Enact agent copies per `AGENTS.md`.
