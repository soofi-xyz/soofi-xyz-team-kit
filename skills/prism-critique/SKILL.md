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
| Palette — every color in the SVG is a token; line colors follow `system.json` `lines.colors`; every named ray is present and no unnamed ray was added; a shape on a line breaks that line; only `system.json` grammar shapes and vocabulary treatments | pass |
| Construction — light starts on the geometry and shares its angles; ground visible between bands; no adjacent shared stroke | pass |
| Rendering — hard edges one flat color; gradients diffused; smooth light, no grain | pass |
| Mobile — recomposed, not cropped; no vertical element ending in a symmetric downward cone | pass |
| Text zone — clear, contrast AA | pass |
| Economy — nothing removable without losing the claim | ≥4 |
| Family resemblance — same system as approved references | ≥4 |

Any fail → name the single change that fixes it, apply, re-render. Max 2 rounds, then present with the remaining issue stated.

Write `<run>/critique.md`: scores per variant, revisions made, recommended variant and why in one sentence.
