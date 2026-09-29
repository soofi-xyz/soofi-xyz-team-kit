---
name: prism-concept
description: Turns a Prism section (assertion, evidence, goal) into visual concepts and a structured brief. Use before any graphic is built.
---

# Prism concept

Paths: `art-direction/...` means `<pipeline>/art-direction/...` and `<runs>` is the runs root, both defined in `prism-asset-pipeline`.

Read one approved visual from `asset_plan.json`, art-direction.md §4 (two tiers) and §5 (pattern types), `art-direction/lexicon.json`, and approved briefs in `art-direction/references/approved/` as examples. Do not invent assets the plan did not approve.

## Method
1. State the assertion in ≤10 words.
2. State the visual-alone test: what a reader should conclude from the graphic with no copy.
3. Identify the claim's shape: contrast (A vs B), transformation (before → after), decomposition (one → many), sequence (steps), structure (how parts relate), or quality (one state shown well, no before/after). Shape decides composition.
4. Map every noun in the claim to the lexicon. Reuse an entry when the meaning matches. If a noun is missing, propose an entry with a rationale tied to the prism metaphor: decomposition, refraction, layers, light passing through structure, one input becoming organized outputs, hidden structure becoming visible. If the content argues against an existing entry, propose a revision. Within a page, one form means one meaning. Never give an existing form a second meaning; propose a new form instead.
5. Write 3 concepts that differ in *idea*, not styling.

## Output — one object per concept
```json
{
  "section_id": "",
  "pattern_type": "background | focus | distinguishing",
  "assertion": "",
  "claim_shape": "contrast | transformation | decomposition | sequence | structure | quality",
  "concept": "one sentence",
  "visual_alone_test": "",
  "lexicon": [{"noun": "", "concept": "", "action": "reuse"}],
  "lexicon_changes": [{"concept": "", "form": "", "color_state": "", "rationale": "", "status": "proposed", "sources": []}],
  "composition": {
    "aspect_desktop": "16:9",
    "aspect_mobile": "4:5",
    "focal_point": "",
    "reading_direction": "along the fan, origin at the top-left",
    "text_zone": "region reserved for HTML copy; no saturated light here"
  },
  "geometry": [{"primitive": "", "count": 0, "state": "legacy | prism", "arrangement": ""}],
  "light": {"source": "library:<name> | construct", "relation": "behind | through | from-focal"},
  "asymmetry": "how the legacy side is visibly constrained, or n/a",
  "labels": [{"text": "", "anchor": "primitive id"}],
  "avoid": []
}
```

## Rules
- One focus idea per section. If a concept needs a caption to make sense, it fails.
- Prefer fewer elements. Count primitives; justify any count above 7.
- Contrast and transformation claims always use the gray → spectrum split.
- Label text comes from the section's own copy, verbatim.
- Show new or revised lexicon entries as a separate list from the three concepts. On approval, write them to `lexicon.json` with the source section. Do not write them before approval.
