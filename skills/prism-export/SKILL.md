---
name: prism-export
description: Exports an approved Prism graphic to production files. Use only after Miranda approves a variant.
---

# Prism export

Paths: `art-direction/...` means `<pipeline>/art-direction/...` and `<runs>` is the runs root, both defined in `prism-asset-pipeline`.

1. Confirm approval is explicit in this conversation. If not, ask.
2. There is no export script yet. Produce these files from the approved run by hand into the site repo's `public/assets/<page>/`, and confirm before writing under `public/`:
   - `<section>-light-{desktop,mobile}@{1x,2x}.{webp,avif}`
   - `<section>-geometry-{desktop,mobile}.svg` (svgo'd)
3. Output the HTML/CSS snippet: light layer as background image, geometry SVG inline, labels as positioned HTML from anchor coordinates.
4. Copy `brief.json` (or the approved reading) to `art-direction/references/approved/<section_id>.json` so it becomes an example for future concepts. In a plugin checkout, ship it through a pull request.
5. Report file sizes. Flag anything over 200KB.
