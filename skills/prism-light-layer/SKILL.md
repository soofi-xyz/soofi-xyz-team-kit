---
name: prism-light-layer
description: Builds or selects the blurred prism-light layer for Prism graphics and backgrounds using the blurred-shape construction rules. Use for background patterns and for the light half of focus or distinguishing graphics.
---

# Prism light layer

Paths: `art-direction/...` means `<pipeline>/art-direction/...` and `<runs>` is the runs root, both defined in `prism-asset-pipeline`.

Default: select from `art-direction/backgrounds/`. Construct new only for the background library or when the brief says `construct`.

## Construction (SVG) — art-direction.md §2–3
- Ground is the `mist` token.
- Filled shapes with thick contrasting strokes; lighter colors as fills, darker as strokes. Stroke width comes from tokens.
- `feGaussianBlur` stdDeviation = `blur_ratio_of_viewBox.compositional` × viewBox width, or `blur_ratio_of_viewBox.hero` × viewBox width for a full-bleed hero.
- Ground visible between bands.
- No two adjacent shapes share a stroke color.
- Bands follow the fan in tokens. Higher bands sit near `fan.upper`. Lower bands sit near `fan.lower`. Interpolate between.
- Shape count comes from the section's content. Do not default a hero to four shapes.
- Filter IDs: `<section_id>-light-<n>`.
- Never use the `eclipse` token in this layer.

## Relation to geometry
- `behind`: centered under the focal point, fading before the text zone.
- `through`: bands pass behind the geometry along the fan, brightest behind prism-state elements, absent behind legacy-state elements.
- `from-focal`: originates at the focal point (e.g., the refraction point) and fans outward.

## Rays (focus graphics)
Render focus rays from the reading's `light_prompt` with `gpt-image-2.5-sunburst`: `node <pipeline>/scripts/gen.mjs --reading <run>/readings.json <id>`. Do not attach Color Concept 04 or any other reference image. The prompt names the origin, each named ray's hex pair, the increasing blur, and the off-white gaps, and it asks for no lines, shapes, or text. After the image returns, measure the origin and composite an outline around the glow the ray leaves from. Never flat-fill the shape. The SVG construction above is for the background library, not for these rays.
