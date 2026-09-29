---
name: prism-asset-pipeline
description: Orchestrates Prism graphic generation for prismteam.ai from page copy — plan, blind-scored ideation, type-first layout, SVG geometry plus blurred light, read-back, preview, export. Use when asked to generate, create, or redo assets, graphics, or visuals for a Prism site section.
---

# Prism asset pipeline

## Paths
- `<pipeline>` is the directory that holds this `SKILL.md`. Resolve it from where you loaded this skill, never from the cwd.
- `<pipeline>/art-direction/art-direction.md` is the source of truth. Tokens: `art-direction/tokens.json`. Lexicon: `art-direction/lexicon.json`. Every `art-direction/...` path in the Prism skills means `<pipeline>/art-direction/...`.
- Scripts: `node <pipeline>/scripts/<name>.mjs`. Models: `<pipeline>/models.config.json`.
- Runs: `<runs>` is `$PRISM_RUNS_DIR`, default `~/.prism-assets/runs`. Relative paths passed to the scripts resolve against `<runs>`. Never write runs into the plugin tree.
- API keys: set them in the environment or in `$PRISM_ENV_FILE`, `~/.prism-assets/.env`, or `.env` at the plugin root (first match wins per key). Keys are listed in the plugin's `.env.example`: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (ideation and read-back), `GEMINI_API_KEY` (raster fallback edits), `RECRAFT_API_KEY` (optional). Never print or commit a key.

Input: raw page or section copy. A section file is written only after an asset plan is approved.

Run directory: `<runs>/<page>/<YYYYMMDD-HHMM>/`.

## Steps
0. **Plan** — run `prism-asset-planner`. Write `asset_plan.json` and a one-line summary per asset. STOP. Wait for approval.
1. **Read** — for each approved visual, read the assertion, body, evidence, and CTA, and take the pattern type (background, focus, distinguishing) from the plan. Background → skip step 2, lay out the type, and build the light with `prism-light-layer` only.
2. **Ideate** — run `prism-prompt-writer` steps 1–2 through `node <pipeline>/scripts/ideate.mjs`. It writes 3 readings and 8 candidates with distinct structures, and a blind critic model on a different provider scores each as text before any image exists. Show Miranda all eight, one line each, with the pick and why it beats the runner-up. Show new or revised lexicon entries as a separate list (see `prism-concept`). STOP. Wait for her pick or edits.
3. **Lay out type first** — for desktop (`1536x1024`) and mobile (`1024x1536`), place headline, body, and CTA before any graphic, and record `layout` in percent of the frame. Recompose mobile; never crop desktop. Name the type anchor the focal event aligns to.
4. **Compose one construction** — name the point on the geometry the light originates from and the angles the geometry and the ray edges share. Pick one dominant color pair; add a second only when the copy has a second contributor or state.
5. **Render**:
   - Geometry: author exact SVG per "Geometry" below. Never ask an image model for geometry.
   - Light: blurred SVG shapes per `prism-light-layer`. Use the raster fallback (`gen.mjs --reading`) for light only, and only after SVG construction fails twice.
   - Composite each reading to `<run>/<reading id>.png` (ids end in `.desktop` or `.mobile`) at the reading's `size` (rasterize the SVG with a headless browser or `rsvg-convert`) so the read-back can see it.
6. **Read back** — `node <pipeline>/scripts/readback.mjs <run>/readings.json <id...>`. Pass: blind score ≥4 and no missed bindings. Otherwise revise per `prism-prompt-writer` §5; max 2 rounds, then report the gap.
7. **Critique** — run `prism-critique` on each composite. Revise failing variants; max 2 rounds.
8. **Preview** — `node <pipeline>/scripts/sheet.mjs <run>/readings.json <id-prefix>` lays the type over each image. Show Miranda the sheet, the blind description, and the scores together. STOP.
9. **Export** — only after Miranda approves in this conversation, run `prism-export`.

## Geometry
- Strokes: 1 px at 1x with `vector-effect="non-scaling-stroke"` (`tokens.json` `geometry_line.weight`), `stroke-linecap="round"`, `stroke-linejoin="round"`.
- Line color: inner colors only, flare `#FBE645` or sky `#9DDEFD`, read from tokens. Never ember, violet, or a gradient on a line. At most two line colors, one per role. A line that feeds a ray takes that ray's inner color.
- Hard edges are one flat solid color. Gradients are diffused light with soft edges. Never put a crisp edge around a gradient. No filters, blur, glow, or text in the geometry layer.
- One shape system per composition. The light starts on a vertex, edge, or center of the geometry and shares its angles; use the fan angles only when the geometry sets none.
- Sit on the 8 px grid. Keep at least 40% of the frame as open ground. Nothing saturated, no line crossings, and no focal event behind the headline or CTA.
- Mobile: the idea reads top to bottom. Never end a vertical element in a symmetric downward cone of light; run the sequence diagonally or keep it horizontal and let the light leave at an angle.
- Give every labeled element an `id`. Labels are HTML, never baked into the graphic.

Log every Miranda correction in `<run>/critique.md` under `## Feedback`, then apply it to the skill, rule, or art-direction file that caused the miss.
