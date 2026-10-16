---
name: geometry-svg
description: Authors the crisp vector geometry layer for Prism focus and distinguishing graphics, assembled from primitives.
---

# Geometry SVG

Input: `brief.json`. Output: `geometry-desktop.svg`, `geometry-mobile.svg` in the run directory.

## Construction
- Assemble from `art-direction/primitives/`. Do not redraw primitives with new proportions.
- New primitive needed → stop and propose it; add to the library only after approval.
- viewBox: 1600×900 desktop, 800×1000 mobile. Recompose for mobile; do not scale the desktop file.
- 8px grid. All coordinates on grid.
- Stroke weights from tokens only.
- Legacy state: the `eclipse` token, solid, heavy, axis-aligned. No spectrum.
- Prism state: flat spectrum tokens, lighter weight, connected.
- Allowed angles: `fan.upper`, `fan.middle`, `fan.lower`, plus 0 and 90. No other angles.
- No filters, blurs, gradients, or text in this layer.
- Every labeled element gets an `id` matching `brief.labels[].anchor`.
- Keep the declared text_zone empty.

## Self-check before handing off
`npm run asset:render`, look at the PNG, confirm: lexicon matches the brief, asymmetry is visible, text zone is empty, focal point is where the brief says.
