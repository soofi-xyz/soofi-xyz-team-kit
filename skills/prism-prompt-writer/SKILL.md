---
name: prism-prompt-writer
description: Turns one approved Prism visual (section copy, job, goal, verb) into an image-model prompt, then checks the result with a blind read-back. Use after prism-asset-planner or prism-concept, before showing any generated image.
---

# Prism prompt writer

Paths: `art-direction/...` means `<pipeline>/art-direction/...` and `<runs>` is the runs root, both defined in `prism-asset-pipeline`.

If `ANTHROPIC_API_KEY` is set, run steps 1–4 with `node <pipeline>/scripts/ideate.mjs`. If it is missing, use Claude in Cursor for those steps. Do not stop and do not ask for the key. Write the geometry and the light prompt into the run's `readings.json`. Painting the ray still uses `OPENAI_API_KEY`.

Inputs: the section from `asset_plan.json` (assertion, body, evidence, CTA, job, goal, pattern type, verb), `art-direction/system.json` (grammar, color, lines, vocabulary), `art-direction/art-direction.md` §5, `art-direction/prismatic-symbolism.md`, `art-direction/tokens.json`. Never attach or describe a shipped graphic.

## 1. Select what is drawn
Run `system.json` `visual_slots.selection`. There is no stored sentence.

1. If the prompt does not state the subject, stop and ask. The subject is `user` (circle), `us` (rounded square), or `about_us` (the work or the system). Do not read it off a stored `depiction` field.
2. If the prompt does not state the feeling, stop and ask. Follow `motif_sourcing`. Read `sources/approved-motifs.json` with `sources/prism-feelings-proposed.json`, `sources/ampharos-motif-lexicon.json`, `sources/metanet-index.json`, and `sources/imageschemanet-index.json`. An approved motif is a candidate. Offer it only when it is the best fit for this section. From the proposed file, take the situation name only. Do not map it until one name is locked. After it is locked, write the event before any element. Stop and ask only when no source yields a situation that fits. When the visual's job is explanation, do not draw a feeling.
3. Then read the section copy. It does not choose the subject or replace the feeling. The situation has to hold what the copy is about: how long the hard part is, and whether the subject is still in it or already past it. Drop a situation that matches the feeling word and misses the copy, after checking whether a join would hold the copy. Crossing a finish is finishing. Do not drop that picture because it is also a race, when the copy is about finishing.
4. The subject stays. A shape is a subject. The line builds the situation. Each ray takes one job from `composition.jobs.light`: guide, uncover, highlight, power, or focus. A composition may contain more than one ray. When a shape sits on a line, the line breaks at the shape. A composition may join more than one motif when the join is the situation. The drawing has to read as the motif.
5. Keep a candidate only when removing it would change that interaction. Cut the rest. When the visual's job is explanation, the copy's parts are the marks. Do not cut them down to a mood.

## 2. Rank, then illustrate
For the ranking, show situation names only, in ordinary words. Show the best fits for this section, up to three names. An approved name appears only when it is one of those fits. Do not describe the line, where the subject sits, or the rays. Do not invent a motif that no source supports.

Stop for the ranking. Do not paint before one name is locked.

After one name is locked, search for photographs of that situation. Download several into the run's references folder and look at the pictures before writing the event. Use them to see the moment: where the subject is, what the path does, and what is in front of and behind the subject. Translate that moment into this kit. Do not copy an object the kit cannot build. Do not attach the photographs to the ray. Then write the picture as one event before any element. The event says where the hard part is relative to the subject, what the subject is doing, and what the light is doing. Say it without the words line, circle, or ray. If you cannot, it is not a picture yet. If two events in one set would be drawn the same way, one of them is not that event. Then draw only that event. An element that does not change the event is not in the frame. Do not place a line, a circle, and a ray and then look for a story. Do not add a prize icon. Do not reopen the ranking.

## 3. Composition spec
- Type first. Headline and body stay in the open ground. The path passes below or beside the type, never through it.
- Name where the path changes, in percent of the frame. That change is the meaning.
- Name where the subject is in the event. The subject does not have to sit on the path. Where a shape does sit on a line, the line breaks at the shape's edge and continues on the other side. A line enters from one edge of the frame and leaves through another. It does not begin or end in open ground.
- Name every ray, the region it covers, and its one job. A ray covers an outcome. It does not have to leave from the subject. A composition may contain more than one ray. Do not add a ray that was not named.
- Each ray uses one pair. Name it.
- Desktop `1536x1024` and mobile `1024x1536`, recomposed, not cropped. On mobile the idea reads top to bottom. Do not end in a symmetric downward cone.

## 4. Two paint artifacts
Write both. Do not combine them into one image prompt. Do not ask the image model to draw the line or the circle.

### Geometry (`geometry`)
The SVG. 1.5 px stroke, round caps, the graphic color of the pair. Positions in percent of the frame. A large shape has no fill. A shape small enough to read as a dot is filled with the graphic color.
- The line builds the motif. The subject sits in that situation. Direction comes from the motif. Where a shape sits on the line, stop the line at the shape's edge and resume it on the other side.
- The subject: which shape, how big, and where.

### Light prompt (`light_prompt`)
Sent only to `gpt-image-2.5-sunburst`. Light only. Name the pair and its hex values from `tokens.json` `light.pairs`. Name every ray the composition uses: its pair, where it sits, in percent of the frame, and that the rest stays empty ground. Name the ground hex from `tokens.json` `palette.mist`. Do not add a ray that was not named. No lines, no shapes, no text, no grain. Do not attach a reference image.

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
  "vocab": {"transformation": "", "supporting": []}, "concept": "", "fit": 0, "composition": {}, "geometry": "", "light_prompt": "", "rejected": []
}
```
