---
name: prism-asset-pipeline
description: Orchestrates Prism graphic generation for prismteam.ai from page copy — plan, blind-scored ideation, type-first layout, SVG geometry plus blurred light, read-back, preview, export. Use when asked to generate, create, or redo assets, graphics, or visuals for a Prism site section.
---

# Prism asset pipeline

## Paths
- `<pipeline>` is the directory that holds this `SKILL.md`. Resolve it from where you loaded this skill, never from the cwd.
- `<pipeline>/art-direction/system.json` is the visual system: grammar, color, lines, and the vocabulary mapping every keyword to a treatment. `art-direction/art-direction.md` holds the reasoning and composition rules. Tokens: `art-direction/tokens.json`. `art-direction/lexicon.json` is superseded history (each entry's `maps_to` points into `system.json`). Every `art-direction/...` path in the Prism skills means `<pipeline>/art-direction/...`.
- Scripts: `node <pipeline>/scripts/<name>.mjs`. Models: `<pipeline>/models.config.json`.
- Runs: `<runs>` is `$PRISM_RUNS_DIR`, default `~/.prism-assets/runs`. Relative paths passed to the scripts resolve against `<runs>`. Never write runs into the plugin tree.
- API keys: set them in the environment or in `$PRISM_ENV_FILE`, `~/.prism-assets/.env`, or `.env` at the plugin root (first match wins per key). Keys are listed in the plugin's `.env.example`: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (ideation and read-back), `GEMINI_API_KEY` (raster fallback edits), `RECRAFT_API_KEY` (optional). Never print or commit a key.

Input: raw page or section copy. A section file is written only after an asset plan is approved.

Run directory: `<runs>/<page>/<YYYYMMDD-HHMM>/`.

## Phases
Design and painting are separate. Every phase reads the previous phase's JSON and writes its own; never carry a decision forward only in prose.

0. **System** (`system.json`). Read it first, every run. When asked "what is the system?", return it (`definition_of_done`). Change it only through a proposal Miranda approves: write `<run>/system.proposals.json` (the word, 7 options generated, the top 3 shown as treatments that apply to any element, never as one-off pictures), then merge her pick into `system.json` with the date.
1. **Plan** (`asset_plan.json`) — run `prism-asset-planner`. STOP for approval.
2. **Read** (`<run>/<section>.reading.json`) — per approved visual: assertion, body, evidence, CTA, pattern type, claim shape, and every meaning-carrying word with its `system.json` vocabulary entry (`{"word", "vocab": "relations.traced"}`). A word with no entry goes to `unmapped`; if the section needs it, return to phase 0 before composing. Background sections skip to phase 4 with light only (`prism-light-layer`).
3. **Compose** (`<run>/<section>.composition.json`) — run `prism-prompt-writer` steps 2–3. Each candidate uses exactly one transformation for the claim plus at most two relations, treatments, or states from the reading, and names them by vocabulary key. Candidates differ in composition, never by inventing marks. A blind critic scores each as text (`node <pipeline>/scripts/ideate.mjs --ideas`). Record the pick with: elements, vocabulary keys, hero ray pair and supporting rays, line color, type layout per breakpoint (`1536x1024`, `1024x1536`, recomposed not cropped), the type anchor, and the construction (the point the light starts from and the angles it shares). STOP for Miranda's pick.
4. **Paint** (`<run>/<id>.svg`, `<run>/<id>.png`) — render only what `composition.json` names. Geometry: exact SVG per "Geometry" below. Light: blurred SVG per `prism-light-layer` and `tokens.json` `light.pairs`; raster fallback (`gen.mjs --reading`) for light only, after SVG fails twice. Rasterize each composite at its `size` for the read-back.
5. **Verify** (`<run>/readback.json`, `<run>/critique.md`) — `node <pipeline>/scripts/readback.mjs <run>/readings.json <id...>` (pass: blind ≥4, no missed bindings; max 2 revisions), then `prism-critique`, then `node <pipeline>/scripts/sheet.mjs <run>/readings.json <id-prefix>`. Show the sheet, the blind description, and scores. STOP.
6. **Export** — only after Miranda approves in this conversation, run `prism-export`.

## Geometry
- Strokes: 1 px at 1x with `vector-effect="non-scaling-stroke"` (`tokens.json` `geometry_line.weight`), `stroke-linecap="round"`, `stroke-linejoin="round"`.
- Line color: from the hero ray, per `system.json` `lines.colors` (its outer color when light: flare for blue/gold, sky for mint/blue; sky for blue/purple; flare for yellow/red). Never ember, violet, or a gradient on a line.
- Shapes: only the `system.json` grammar shapes, each with its one meaning; rounded corners except at a transition point into light; filled shapes are one solid color.
- Hard edges are one flat solid color. Gradients are diffused light with soft edges. Never put a crisp edge around a gradient. No filters, blur, glow, or text in the geometry layer.
- The light starts on a vertex, edge, or center of the geometry and shares its angles; use the fan angles only when the geometry sets none.
- Sit on the 8 px grid. Keep at least 40% of the frame as open ground. Nothing saturated, no line crossings, and no focal event behind the headline or CTA.
- Mobile: the idea reads top to bottom. Never end a vertical element in a symmetric downward cone of light; run the sequence diagonally or keep it horizontal and let the light leave at an angle.
- Give every labeled element an `id`. Labels are HTML, never baked into the graphic.

Log every Miranda correction in `<run>/critique.md` under `## Feedback`, then apply it to the skill, rule, or art-direction file that caused the miss.
