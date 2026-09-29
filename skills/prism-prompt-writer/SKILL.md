---
name: prism-prompt-writer
description: Turns one approved Prism visual (section copy, job, goal, verb) into an image-model prompt, then checks the result with a blind read-back. Use after prism-asset-planner or prism-concept, before showing any generated image.
---

# Prism prompt writer

Paths: `art-direction/...` means `<pipeline>/art-direction/...` and `<runs>` is the runs root, both defined in `prism-asset-pipeline`.

Run steps 1–4 with `node <pipeline>/scripts/ideate.mjs`, not by hand in chat. It sends this skill to the model set in `<pipeline>/models.config.json` `ideate`, has a separate critic read each idea blind as text before any image is made, and writes the picked prompts into the run's `readings.json`.

Inputs: the section from `asset_plan.json` (assertion, body, evidence, CTA, job, goal, pattern type, verb), `art-direction/system.json` (grammar, color, lines, vocabulary), `art-direction/art-direction.md` §5, `art-direction/prismatic-symbolism.md`, `art-direction/tokens.json`. Never attach or describe a shipped graphic.

## 1. Read the section
1. Read all four parts of the section, not only the headline. Each does a different job:
   - Assertion: the claim the visual must prove. Write it in ≤10 words.
   - Body: how the copy characterizes each thing. Map its descriptive words to `system.json` vocabulary states and treatments: "rigid" → `states.unfit`; "manual hand-off" → broken `relations.routed`; "reusable" → `relations.repeated_identity`; "slow" → `states.dashed`.
   - Evidence: the concrete parts. A list sets the count of elements (four problems → four marks). The evidence decides what the pieces are; the assertion decides what happens to them.
   - CTA: no visual weight unless the section bookends the page.
2. Take the pattern type from the plan. It sets what the visual must do:
   - Background: atmosphere only. It carries no claim, so skip steps 3–6. Use the background library (§5A); write a prompt only when the plan asks for a new crop.
   - Focus: make the assertion visible, as one idea.
   - Distinguishing: separate two concepts. Give each side its own form from how the body characterizes it ("COTS is rigid" → fixed blocks; "Prism is reusable" → a network of identical agent units). Obey the asymmetry rule and the before/after color split (§5C).
   If the plan has no pattern type, decide it from the section's job and record why.
3. Name the claim shape, using the same names as `prism-concept`: contrast, transformation, decomposition, sequence, structure, or quality (one state shown well). Only a transformation gets `before`, `turn`, and `after`, with the turn given its own visible stretch. Do not force a story onto copy that has none.
4. Name the ONE visible property that carries the idea: continuity, order, width, direction, count, separation, or color temperature. If you need two properties, the idea is not clear yet.
5. Bind specific words only when they matter. If the section carries a specific the image must show (a duration like "years", an amount, a named actor), bind that word to a variable from "Visual variables" in `prismatic-symbolism.md` and write how the image exaggerates it. Otherwise leave `bindings` empty; the claim and the property are enough.
6. Decide identity. The same thing keeps one color everywhere except at the prism, where a color change means transformation. Colors carry no other meaning.
7. Write the visual-alone test as one sentence a stranger could say with no copy: "Scattered pieces settle into one clear order."

Proposed, not yet approved (report it, do not act on it): load test. Note any image element with no reason in the copy, and any bound word with no element.

## 2. Diverge within the system, then choose
Read `art-direction/system.json` first. Every candidate is composed from its vocabulary: elements, states, treatments, relations, and transformations. Never invent a mark. Precedents (the worked example, approved graphics, ideas Miranda has given) show how to reason, not what to draw.

- Map the reading's words to vocabulary keys. If a needed word is `unmapped`, stop and propose a treatment through pipeline phase 0 (7 options generated, top 3 shown, each a treatment that applies to any element).
- A candidate is one transformation (the claim) plus at most two relations, treatments, or states, arranged in a layout. Two candidates with the same keys must differ in composition: which element carries the claim, where the prism sits, how the hero ray leaves, what the type anchors to.

1. Write 3 different readings of the section: what else could it be about? Take different angles on the same copy: the problem, the moment of change, the result, the feeling, the hidden structure.
2. From those readings, write 8 candidates, each naming its vocabulary keys. Name each one's structure in three words or fewer ("open form closes", "layers fall into alignment", "pool breaks free"). No two candidates may share a structure; restyling one idea (a different angle, color, or layout) is the same candidate.
3. Spread the set. Include at least two that are light-led, two that are geometry-led, and two that pair both. Use at least three composition types: one focal event, a field across the frame, a split, a sequence, or layered planes. Draw from `prismatic-symbolism.md` and from anything else a prism or light does: layers, planes, caustics, cast shadows, closure, alignment, filling a space.
4. Each candidate must express something a prism does: decomposition, refraction, structure, layers, light passing through a system, one input becoming organized outputs, or hidden structure becoming visible.
5. Flag any candidate whose structure matches a precedent or another section's graphic as `precedent`. It may stay in the set as the baseline to beat, but it wins only if it scores clearly higher.
6. Score each 1–5 on: one-glance readability (would a stranger name it in 2 seconds?), fit to the copy, and distinct silhouette from neighboring sections and precedents.
7. Pick one and say why it beats the runner-up. Record the rest under `rejected` with the score and reason. Show Miranda all eight, one line each, with the pick.

## 3. Composition spec (write before the prompt)
Follow `art-direction.md` §5D (composition) and §5E (color harmony).
- Type first: design the layout for each breakpoint before any graphic element: where the headline, body, and CTA sit and why. Record it as `layout` (percent of the frame: `{"headline": {"left", "top", "width"}, "body": {...}, "cta": {"left", "top"}}`). Name the type anchor the focal event aligns to. Keep the graphic out of the type's area.
- One construction: name the point of the geometry the light starts from, and the angles the geometry and the ray's edges share.
- Color: name the hero ray's pair and any supporting rays, per `art-direction.md` §5E (colors carry no meaning; one hero ray). Line color comes from `system.json` `lines.colors`.
- Where each part sits and how much of the frame it takes. For a change, put `before` where the eye starts (left on desktop, top on mobile) and size it by its binding: a long wait gets a long run.
- Both states must be clearly visible. The weaker state is at least half the intensity of the stronger one; never let it fade into the ground.
- The one focal event and where it sits.
- The headline zone.
- One primary phenomenon plus at most one supporting (see `prismatic-symbolism.md`).
- Breakpoints: write a desktop spec (landscape, `size` `1536x1024`) and a mobile spec (portrait, `size` `1024x1536`). Recompose mobile; never crop desktop. On mobile the headline sits at the top and the reader scrolls down, so the idea reads top to bottom: geometry may run at 90°, and the light opens below the text. Never end a vertical element in a symmetrical downward cone of light; it reads as a rocket launch or upward progress in every test so far. Run the sequence diagonally or keep it horizontal, and let the light leave at an angle. Keep the same pair, the same handoff, and the same meaning on both. Save them as `<id>.desktop` and `<id>.mobile`, and read back both.
- Layers: say which elements are geometry (sharp, carries structure) and which are light (diffused, carries energy), and name the handoff point where they meet. See "Pairing geometry and light" in `art-direction.md`.

## 4. Prompt order
1. The story in one sentence, in visual terms only ("A soft band of light circles back on itself three times, then breaks free into a straight, luminous fan.").
2. Layout from the composition spec, with positions and sizes.
3. Color: each ray's inner and outer color by token hex, from `tokens.json` `light.pairs`.
4. Rendering: describe each layer separately. Never ask for grain, noise, or texture; ask for smooth, clean gradients. Geometry: "crisp, narrow, flat, like a precise vector line; no blur, no glow." Light: the shared `Look:` paragraph from the latest readings file.
5. At most five exclusions. Long negative lists make the image worse.

## 5. Blind read-back
Run `node <pipeline>/scripts/readback.mjs <run>/readings.json <id...>`. A separate model describes the image without the copy, then scores it against the visual-alone test.
It also checks each binding and reports which were `missed`.
- Blind score ≥4 and no missed bindings: show it.
- Otherwise, fix the missed bindings first. Exaggerate that binding's variable (longer, more, wider, more uneven); do not add a new element. If the variable is exaggerated and still missed, the binding is wrong; pick another variable from the table. Regenerate and read back again. Stop after two revisions and report the gap.
- If the prompt said it and the image did not render it (for example dots instead of dashes), that is a rendering miss. Restate the rule as a physical measure ("each dash about eight times as long as it is thick") instead of repeating it.

Preview each image with its type: `node <pipeline>/scripts/sheet.mjs <run>/readings.json <id-prefix>`. Show Miranda the preview, the blind description, and the score together.

## Output (append to the run's `readings.json`)
```json
{
  "id": "", "breakpoint": "desktop|mobile", "size": "", "copy": "", "body": "", "evidence": [], "claim": "",
  "pattern_type": "background|focus|distinguishing", "pattern_reason": "",
  "claim_shape": "contrast|transformation|decomposition|sequence|structure|quality",
  "forms": [{"thing": "", "copy_words": "", "form": ""}],
  "story": {"before": "", "turn": "", "after": ""}, "contrast_property": "",
  "bindings": [{"word": "", "meaning": "", "variable": "", "element": "", "how": ""}],
  "visual_alone_test": "", "candidates": [{"idea": "", "phenomenon": "", "readability": 0, "fit": 0, "distinct": 0}],
  "vocab": {"transformation": "", "supporting": []}, "concept": "", "fit": 0, "composition": {}, "prompt": "", "rejected": []
}
```
