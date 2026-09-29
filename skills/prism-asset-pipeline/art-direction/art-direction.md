# Prism Art Direction — v0.1 (light mode)

Source of truth for the Prism visual agent. Reverse-engineered from the current dark-mode site, translated to light mode and the assertion → visual system.

Status tags: **[confirmed]** = Miranda's existing spec · **[proposed]** = needs sign-off · **[gap]** = missing, fill before use.

---

## 1. Core principle

Every important assertion gets a visual. Not decoration — visual proof. The test for any visual: **a reader should get the section's assertion from the visual alone.**

Prism implies: decomposition, refraction, structure, layers, light passing through a system, one input becoming organized outputs, hidden structure becoming visible.

---

## 2. What the current system is (dark mode, reverse-engineered)

### Construction [confirmed]
- Gradients are SVG filled shapes with thick contrasting strokes, blurred with `feGaussianBlur`. Lighter colors = fills, darker colors = strokes.
- Negative space between shapes must stay visible.
- No two adjacent shapes share a stroke color.
- Hero: exactly four shapes; violet and ember are stroke-only.
- Blur: ~0.028 × viewBox (compositional), ~0.042 × viewBox (full-bleed hero).
- Filter IDs must be unique across the whole document.
- Construction, font metrics, and coordinates are never inferred — they must be specified.

### What the current graphics do
Every current graphic is atmospheric or connective. None of them carries an assertion. That is the gap this system closes.

| Current asset | Role today | Carries the claim? |
|---|---|---|
| `hero-glow`, `hero-beam` | Page identity, light | No |
| `bottleneck-group13` | Atmosphere around problem list | No |
| `problem-underline` | Emphasis on each friction | Partially |
| `mobile-light-rays`, `bottleneck-group12` | Atmosphere, section transition | No |
| `outcomes-left/right-glow` | Atmosphere | No |
| `outcomes-connector` | Links artifact list items | Partially (sequence) |
| `cta-glow` | Bookend with hero | No |

### What carries over
The blurred-shape construction, the negative-space rule, the adjacent-stroke rule, and the blur ratios carry over. The ground inverts.

The old hero's "exactly four shapes" and "violet and ember are stroke-only" describe the current dark-mode files. They are not a template. Each new section is distilled from that section's assertion, body, and evidence.

---

## 3. Light-mode translation

### Palette
Hex values are the fills on Figma frame Option 10 (`90:710` in `Prism-Visual-ID-Exploration`). The second `#9DDEFD` swatch is dropped. One sky swatch remains.

| Swatch | Hex | Name | Role |
|---|---|---|---|
| 1 | `#161616` | eclipse | Geometry, type, legacy/"before" states. Never blurred. |
| 2 | `#F8F7F7` | mist | Ground. Negative space between shapes. |
| 3 | `#FDE692` | solar | Fill (light) |
| 4 | `#FBE645` | flare | Stroke / accent |
| 5 | `#FB6F48` | ember | Stroke |
| 6 | `#A3A3E9` | violet | Stroke |
| 7 | `#9DDEFD` | sky | Fill |
| 8 | `#D4FDDE` | mint | Fill (light) |

Names are approved. Aqua and indigo are retired. `MRNDA White` `#FDFCFC` and `MRNDA black` `#262524` are named variables on the same Figma frame and are not part of this palette.

A graphic uses the inner/rim pairs it already has. One mark, such as an underline, uses one pair. Two beams may use two pairs when the source already has two. Do not paint the full palette onto every instance.

Tonality comes from the rays in Color Concept 04 (Figma `90:710`), not from the flat swatches beside them. Those rays are high-key: color is pale, soft, and dissolved into the ground. A token is the center of a wash. Edges do not form a hard shape, and the surface is not glossy. The swatches are the flat tokens. The rays are those tokens pulled back.

### Construction changes [proposed]
- Ground is `#F8F7F7`, not indigo. The negative-space rule now means **visible off-white bands between color bands**, as in Concept 04.
- Light bands follow the fan in `tokens.json`: `fan.upper` 13.98°, `fan.middle` 32.23°, `fan.lower` 52.70°, degrees down from horizontal. Higher bands sit near `fan.upper`. Lower bands sit near `fan.lower`. Angles between are interpolated. Concept 04 sits inside that spread (about 18°, 38°, and 47°).
- The fan origin is the logo's top-left corner. By default it sits off-canvas at the top-left. A composition may move it to the focal point when the light relation is `from-focal`.
- Light takes its direction from the three fan angles by default. Geometric shapes may use any angles, as long as one composition uses one consistent shape system.
- `#161616` is reserved for crisp geometry and type. It is never a blurred shape.
- Text never sits directly on a saturated band; it sits on ground or on a solid panel. (Concept 04's white label over peach fails contrast.)

---

## 4. Two tiers

Meaning is not a locked symbol table. Invariants are hard rules. The lexicon is living and comes from the content.

### Tier 1 — Invariants

- Construction, palette, and blur rules in §2–3.
- `#161616` is crisp geometry and type only. It is never blurred.
- Visual-alone test: the graphic carries the section's assertion without the copy.
- One focus idea per section.
- When the copy argues a ceiling against a solution, the visuals must not mirror. The weaker side is visibly constrained.
- No text baked into graphics.
- Every visual idea must be grounded in the prism metaphor: decomposition, refraction, layers, light passing through structure, one input becoming organized outputs, hidden structure becoming visible.
- Section construction is distilled from that section's subject and content. Do not reuse a fixed shape count, including the old hero's four shapes, as a template.
- Color count follows the graphic. One mark uses one pair. Do not default to the full palette.

### Tier 2 — Lexicon

See [`system.json`](system.json) `vocabulary`. [`lexicon.json`](lexicon.json) is superseded history; each entry's `maps_to` points to its vocabulary key.

```json
{
  "concept": "",
  "form": "",
  "color_state": "",
  "rationale": "",
  "status": "seed | proposed | approved",
  "sources": []
}
```

For each section, derive mappings from the content:

- Reuse an entry when the meaning matches.
- Propose a new entry when the content introduces a concept the lexicon lacks.
- Propose a revision when the content argues against an existing entry.

Within a page, one form means one meaning. Never give an existing form a second meaning. Propose a new form instead.

Show new or revised entries as a separate list when presenting concepts. On approval, write them to `system.json` `vocabulary` with the source section.

### Human and agent marks

The primitives plan is archived in `art-direction/archive/primitives-plan.md`. Geometry is authored as SVG (§5B); an image model renders light only, as a fallback. The lexicon still says a human mark and an agent mark must read as different things.

---

## 5. Pattern types

### A. Background — page identity
- A fixed, pre-approved library, not generated per section. Built once from Concept 04.
- Contents: prism bands along the fan (several crops and intensities), faint grid, faint node field.
- Rendering: raster (WebP @1x/@2x, mobile and desktop crops).

### B. Focus — makes the claim visible
- Two layers composited in CSS:
  1. **Geometry:** crisp marks authored as SVG: exact 1 px strokes (`vector-effect: non-scaling-stroke`), round caps, line color from `system.json` `lines.colors`. Never rendered by an image model, which adds halos and cannot hold line weight.
  2. **Light:** blurred spectrum from the background library, placed behind or through the geometry.
- One focus pattern per section, maximum.

### Pairing geometry and light [proposed]
The live site pairs the two layers hand in hand: sharp elbow routes (`home.bottleneck-group14`) beside the pinched rays, sharp ticks (`group13`) and soft underlines on the same four problem lines, sharp connectors (`home.outcomes-connector`) between cards with soft glows behind them.

- **Geometry** carries structure: steps, sequence, counts, routes, boundaries, the process as designed or as broken. Narrow, crisp, flat, one solid inner color (flare or sky), rounded ends on every line and dash. Never blurred, never glowing. Angles: one consistent shape system per composition.
- **Shapes:** only circles, triangles, squares, rectangles, hexagons, and other regular polygons; never irregular trapezoids or freeform polygons. Every shape has rounded corners, except at a transition point where geometry turns into light. Shapes may be outlined or filled with one solid color. Every symbol is built from these shapes. The full system is in `system.json`.
- **Rendering rule:** anything with a hard edge (a line, a dash, an outline, a filled shape) is one solid flat color. Anything with a gradient or more than one color is diffused light with soft, blurred edges. Never put a crisp edge around a gradient. Lines use only the lighter inner colors, flare (#FBE645) or sky (#9DDEFD); never ember or violet, which read flat as lines. Light is smooth: clean continuous gradients, never grain, noise, speckle, or texture.
- **Light** carries energy and outcome: capacity, clarity, what the work becomes. Diffused prismatic rays with an inner and an outer color, per the tonality rule above. Never outlined.
- The two layers meet at one handoff point: a line opens into a ray, a ray passes through or behind a shape, a connector joins two glows. Name that point in the composition.
- When geometry becomes light (a line opening into a ray), it is the same thing changing state, so the geometry takes the light's color. When geometry is a separate thing (a connector between two glows, a boundary the light meets), it may keep its own color.
- A graphic may be geometry only (a tick, a connector), light only (a page-break wash), or both. Choose by what the copy's claim needs: structure, energy, or the change from one to the other.

### C. Distinguishing — separates concepts
- Same two-layer build as focus.
- Always uses the before/after color split from the grammar.
- Always obeys the asymmetry rule.

### D. Composition [proposed]
A graphic is one designed layout with the page's type, not a mark placed beside a ray.

- **One construction.** Geometry and light are built from the same geometry. The light's origin sits on a point of the geometry (a vertex, an edge, a center), never beside it. The ray's edges continue or run parallel to the geometry's lines, so both share one set of angles (a hexagon's 30° sides give the ray 30° edges). Use the fan angles when the geometry sets no angles of its own.
- **Line weight.** Lines are the lightest stroke on the page, lighter than the thinnest stroke in the body type: 1 px at 1x (`tokens.json` `geometry_line.weight`). If a line reads as bold at a glance, it is too heavy.
- **Type first.** Design the section's layout before the graphic, for each breakpoint: where the headline, body, and CTA sit (left, centered, stacked, split), their widths on a 12-column desktop grid and a 4-column mobile grid, and why that placement serves the section. Record it as `layout` in the readings file, in percent of the frame, and preview it with `node <pipeline>/scripts/sheet.mjs`.
- **Protect the type.** No saturated light, no line crossings, and no focal event behind the headline or the CTA. A quiet line may pass under body text only at the lightest weight.
- **Anchor to the type.** Align the focal event to a type anchor, such as the headline's baseline, the CTA's center line, or the text column's edge, so image and type read as one layout. Sit elements on the 8 px grid (`tokens.json` `grid_px`).
- **Proportion.** Size the geometry and the light against each other and against the text block; the light never dwarfs the headline's line length by accident. Keep at least 40% of the frame as open ground.
- **Reading path.** The eye goes headline, then the focal event, then the CTA. The graphic's direction follows the reading direction (left to right on desktop, top to bottom on mobile) and never pulls the eye off the page before it reaches the CTA.

### E. Color harmony
- **Pairs.** Rays use the four pairs from Color Concept 04 (`tokens.json` `light.pairs`): blue/purple, blue/gold, yellow/red, mint/blue. Colors carry no meaning; they are chosen for harmony.
- **Hero one ray.** The ray that carries the section's claim is the largest, strongest, and nearest the focal point. Other rays support it: fewer, smaller or softer, chosen to sit together the way the four rays do in Concept 04.
- **Construction.** Each ray is a filled shape in the inner color with a thick stroke in the outer color, blurred (`stroke_ratio`, `blur_ratio`). The blue/gold ray keeps its double stroke and stronger blur, which is what lets gold and blue blend cleanly.
- **Lines.** See `system.json` `lines`.

---

## 6. Homepage, re-mapped to the layout construct

Copy is quoted from the live site. Visual lines are hints. The concept step distills each section's assertion, body, and evidence into the graphic.

### 6.1 Hero
- **Assertion:** Redesign work for the age of AI agents.
- **Body:** AI tools are spreading. Work still gets stuck in the same handoffs. Prism helps leadership teams build agent fluency, identify workflow bottlenecks, and create a governed operating model for human-agent work.
- **Evidence:** [gap] — none on page; hero may not need it.
- **CTA:** Schedule a Starter Exercise → / Read the Prism Method
- **Pattern:** Background (full-bleed bands, 4 shapes, hero blur) + Focus.
- **Visual:** A single beam enters the logo's prism geometry and leaves as ordered, parallel spectrum rays. One input becoming organized work.
- **Replaces:** `hero-glow`, `hero-beam`

### 6.2 The Problem
- **Assertion:** AI tools do not make an organization AI-native.
- **Body:** Most enterprises already have AI tools and pilots underway. But the structure of work often stays the same. That is not transformation. It is the old model moving faster.
- **Evidence:** Manual handoffs · Approval chasing · Status checking · Context transfer
- **Pattern:** Distinguishing.
- **Visual:** An unchanged gray block workflow with colored tool tiles bolted onto it. The four frictions are marked as the gaps between gray blocks. Spectrum appears, but the structure stays gray — "the old model moving faster."
- **Replaces:** `bottleneck-group13`; `problem-underline` becomes the friction markers.

### 6.3 The Bottleneck
- **Assertion:** Your people are not the bottleneck. Your workflow is.
- **Body:** Legacy workflows turn people into connectors between systems, teams, and decisions. Agents can expand capacity, but only when roles, access, escalation paths, and review points are designed.
- **Evidence:** Without that model, agents become another layer of fragmentation.
- **Pattern:** Focus.
- **Visual:** Gray system blocks connected only by human nodes stretched between them. The people are the connections. The claim is carried by where the humans sit, not by what they look like.
- **Replaces:** `mobile-light-rays`, `bottleneck-group12`

### 6.4 The Plan
- **Assertion:** Start with one governed agent.
- **Body:** Prism gives leaders a practical way to begin.
- **Evidence:** Build fluency · Find bottlenecks · Redesign work with governance
- **CTA:** Read the Prism Method →
- **Pattern:** Focus, as a three-step sequence.
- **Visual:** (1) One spectrum agent node inside a frame. (2) The gray workflow with its human-connector points highlighted. (3) The redesigned network: agents carrying connections, humans at review points, frame around the whole.

### 6.5 What Changes
- **Assertion:** Move from agent experimentation to managed agent adoption.
- **Body:** With Prism, leaders define where agents belong, where humans remain accountable, who owns each agent, what agents can access, when agents escalate, how agents are reviewed, and when agents are reused, updated, or retired.
- **Evidence:** The goal is not more agents. The goal is a managed agent workforce.
- **Pattern:** Distinguishing (asymmetric).
- **Visual:** Scattered, unconnected spectrum nodes with no frame (experimentation) versus fewer nodes, connected, inside a registry frame (managed). The managed side has fewer agents, making "not more agents" literal.
- **Replaces:** `outcomes-left-glow`, `outcomes-right-glow`

### 6.6 What Prism Produces
- **Assertion:** Concrete artifacts, not generic AI enablement.
- **Evidence:** First governed agent and registry entry · Bottleneck map · Human-agent workflow design · Agent Resources blueprint · Governance seed and scale path · Fit decision
- **Pattern:** Focus — the canonical prism.
- **Visual:** One beam (the engagement) refracts into six rays, each ending at one artifact. This is the literal meaning of the brand and should be the system's reference visual.
- **Replaces:** `outcomes-connector`

### 6.7 Not for Outsourced Transformation
- **Assertion:** Prism is not for outsourced transformation.
- **Body:** Prism works with leadership teams prepared to engage directly.
- **Pattern:** Background only **[proposed]**. This is a qualifier, not a core claim; a visual here would compete with 6.6.

### 6.8 CTA
- **Assertion:** Ready to lead how work changes?
- **Body:** Start with a Starter Exercise and give your leadership team a practical path from AI tools to AI-native work.
- **Pattern:** Background, bookending the hero (same bands, compositional blur).
- **Replaces:** `cta-glow`

---

## 7. Other pages [gap]

Not yet mapped: AI-Native Work, Agents, Method, Workshops, About, Litepaper. Map each section using this template:

```json
{
  "page": "",
  "section": "",
  "assertion": "",
  "body": "",
  "evidence": "",
  "cta": "",
  "pattern_type": "background | focus | distinguishing",
  "grammar": [],
  "visual": "",
  "background": "",
  "replaces": ""
}
```

Known candidate: the copilots-vs-agents comparison on AI-Native Work is a distinguishing pattern and must break symmetry (copilot = ceiling, agent = system).

---

## 8. Open decisions

Resolved:

- Palette names and hexes are the §3 table. Aqua and indigo are retired. MRNDA White and MRNDA black are excluded.
- Duplicate `#9DDEFD` swatch is dropped.
- The grammar table is not a hard rule. Tier 1 is §4 invariants. Tier 2 is the `system.json` vocabulary.
- Section graphics are distilled from that section's content.
- Light direction is the fan in `tokens.json`.
- The primitives plan and the primitive-based geometry skill are archived in `art-direction/archive/`. Geometry is authored as exact SVG (§5B, `prism-asset-pipeline` "Geometry"); an image model renders light only, as a fallback.
