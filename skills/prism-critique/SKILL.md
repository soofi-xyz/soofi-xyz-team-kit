---
name: prism-critique
description: Scores Prism graphic variants against the brief and art direction, and decides revise or present. Use after compositing and read-back, before showing variants to Miranda.
---

# Prism critique

Look at each composite preview PNG. Score 1–5 with one line of evidence each.

| Criterion | Pass |
|---|---|
| Visual-alone test — ignoring copy, is the brief's conclusion obvious? | ≥4 |
| Lexicon — consistent with the lexicon; new entries justified | ≥4 |
| Asymmetry (contrast claims) — legacy side visibly constrained | ≥4 |
| Palette — every color in the SVG is a token; line colors follow `system.json` `lines.colors`; every named ray is present and no unnamed ray was added; a shape associated with the line stays about 16 pixels off it, and the line stays whole; a shape that is the start or the end of the line is a small dot (circle about 5–7% of desktop frame height) filled with the pair's graphic color, with no separate stroke; a large unfilled outline appears only on a shape not connected to the line; only `system.json` grammar shapes and vocabulary treatments | pass |
| Construction — light starts on a point of the geometry or on the scene element its `ray_role` names, and shares the angles that role sets; a scene-set ray follows the scene's direction (a power_source ray may trail down and to the left); a compositional ray uses a fan angle, down and to the right; no ray runs level; ground visible between bands; no adjacent shared stroke | pass |
| Ray role — every ray has a recorded `ray_role` and `ray_from`; its origin, angle, and extent follow that role; no ray is placed at random | pass |
| Rendering — hard edges one flat color; gradients diffused; smooth light, no grain | pass |
| Mobile — recomposed, not cropped; no vertical element ending in a symmetric downward cone | pass |
| Text zone — clear, contrast AA | pass |
| Economy — nothing removable without losing the claim | ≥4 |
| Family resemblance — same system as approved references | ≥4 |

Any fail → name the single change that fixes it, apply, re-render. Max 2 rounds, then present with the remaining issue stated.

Write `<run>/critique.md`: scores per variant, revisions made, recommended variant and why in one sentence.
