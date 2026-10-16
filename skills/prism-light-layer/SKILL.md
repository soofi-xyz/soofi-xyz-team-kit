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
Before the prompt, take each ray's `ray_role` and `ray_from` from the reading. The prompt places the origin, angle, and extent that role sets. A ray is never placed at random. If the reading has no `ray_role`, decide it first per `system.json` `composition.jobs.light.role`.

Render focus rays from the reading's `light_prompt` with `gpt-image-2.5-sunburst`: `node <pipeline>/scripts/gen.mjs --reading <run>/readings.json <id>`. Before the prompt, look at `art-direction/references/rays`. Match the beam's shape, how the light diffuses, and where color sits along it. Take the hues from the chosen pair, not from those pictures. Do not attach those pictures, Color Concept 04, or a photograph of the scene. Attaching them copies their colors and anything else in the frame. The prompt names the origin, each named ray's hex pair, the increasing blur, and the ground between rays, and it asks for no lines, shapes, or text. The inner color is the core, a readable band down the middle, wider than the edges, for the whole length of the beam. The core staying readable does not make the ray sharp. The edge of the core and the outer band both dissolve. There is no crisp line between them and no hard outline. Do not let the beam become one mixed color, and do not put the outer color in the core. The start of the ray is the darker outer color, not a pale tip, and that start is a soft diffused patch, not a sharp point. The outer color is the narrower edge. Both stay equally washed. The outer color does not take over the beam past the start. On the blue/gold pair, the core is sky blue #9DDEFD and the outer band is diffused pale yellow #FBE645. The yellow is never the core and never plain yellow. Where the yellow meets the blue they mix, and that mix reads as green. The green is the overlap, not a third color painted on its own. The beginning of that ray stays out of the frame. A ray's silhouette is a triangle, narrower at the start and wider at the far end, even when the edges are soft. A streak of even width is not a ray. An orb, a pool, and a wash are other light: an orb is a soft glow and does not have to be a circle, a pool sits along an edge with no tip, and a wash is already open with no wedge. Name which one the prompt is. A ray whose role is set by the scene follows the direction the scene gives it. A power_source ray trails behind the subject in whatever direction the motion implies, including down and to the left. When the role leaves the direction open, the ray sits on a fan angle, down and to the right. No ray runs level across the frame. It does not have to run from one edge of the frame to the other. It can begin inside the frame and fade out before the far edge. It does not end in a rounded cap. The origin is diffused, not a sharp taper and not a rounded bulb. When it ends inside the frame, that end dissolves into the ground. After the image returns, measure the origin and place the geometry on it. A shape the ray leaves from that is not connected to the line is an outline around that glow, with no fill and a stroke in the graphic color of that ray. A shape that is the start or the end of the line is a small dot filled with that graphic color, with no separate stroke. The SVG construction above is for the background library, not for these rays.
