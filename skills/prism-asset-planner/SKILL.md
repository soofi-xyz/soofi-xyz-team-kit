---
name: prism-asset-planner
description: Decides which graphics a Prism page needs from raw copy. Use before prism-concept, when given pasted page or section text with no pre-structuring.
---

# Prism asset planner

Paths: `art-direction/...` means `<pipeline>/art-direction/...` and `<runs>` is the runs root, both defined in `prism-asset-pipeline`.

Run this before `prism-concept` and `prism-prompt-writer`. The input is raw copy for a page or a section. It is pasted text or a document. It is not a section file, and it is not `art-direction/sections/home.json`.

Read:

- `art-direction/system.json` `visual_slots` first. The vocabulary is the drawing kit. It does not choose the style. A page outline is not in the system.
- `art-direction/page-rhythm.md`
- `art-direction/references/decisions.json` only to see style, verb meaning, and which live sections are gaps

Take three inputs for every section before a picture is planned: the section copy (headline, body, parts, buttons), emphasis (`high`, `low`, or `none`), and depiction (`user`, `us`, or `about_us`). Show all three. The copy may inform emphasis when the brief states what to emphasize (the main claim, the stake, the close). If emphasis is not provided and the brief does not state what to emphasize, stop and ask. If depiction is not provided, stop and ask. Do not invent emphasis or depiction. Do not ignore a provided value. Depiction does not choose the style. `user`: the reader is a circle, and the feeling happens to that circle. `us`: Prism is a rounded square. `about_us`: the work or the system, and the picture may stay abstract. Who the section is for does not choose depiction.

Suggest exactly one visual style per visual: `background`, `focus`, or `distinguishing`. Apply `visual_slots.suggestion` in order. The first matching rule wins. Run the rule again on the new inputs. Depiction does not change that rule. Do not skip it. What is drawn is `visual_slots.selection`: the copy proposes candidates, and the subject and the feeling decide the cut. Article words do not propose candidates. A section may have more than one visual, each with its own style. Suggested style `none` means no visual. A gap in `decisions.json` is a section the current site left bare. Never copy that omission onto a section that has a suggested style.

Then state the compositional layer separately. It does not pick the style. `single`: one dominant frame. `flow`: one equal mark per peer part, same size, same weight, in a row or a path. Flow is not a style. A section may combine a style with a compositional treatment.

One background can still underlie the page. That is the background style used where a section's suggested style is background, not a second style invented per section.

On a section record, `focus` is who the section is for. It is not the focus style, and it is not depiction.

## Steps

1. Segment the copy into sections. For each, extract the assertion, the body, the parts, the buttons, and the evidence. Leave a field empty when the copy has none. Record emphasis and depiction.
2. Show the copy, the emphasis, and depiction. Apply `visual_slots.suggestion` in order, before any keyword mapping. Suggest `background`, `focus`, or `distinguishing`, or `none` when the rule says no visual. Homepage sections store inputs and a suggestion. Run the rule on copy and emphasis. Do not copy the stored style and skip the rule. Depiction chooses the subject. It does not choose the style.
3. State the compositional layer after the style: `single`, `flow`, or `none`. Peer parts stay on this layer. They do not become a style.
4. State the section's job in the page's argument, then the goal. The goal does not suggest the style and does not set the compositional layer.
   - makes a claim → emphasis
   - explains how something works → clarity
   - moves the reader between ideas → flow
   The goal name `flow` is the page-rhythm goal. It is not the compositional layer and it is not a visual style. Clarity is not the default. Do not run more than two clarity sections in a row. Write a one-line reason for the job and the goal.
5. Score seed verbs 1–5 against that section's copy only after the style and the compositional layer are suggested. Verb fit does not suggest the style and does not invent the picture. Read each verb's direction. Never use a verb against its direction. Split means one source becomes several outputs. Route means paths connecting parts that already exist. If the best score is below 4, propose a new lexicon entry instead of forcing a fit. Flag proposed entries.
6. Secondary marks: underline, tick, or connector, only on the words that carry the claim, and only when the primary does not already carry them. Apply the caps in `page-rhythm.md`. The cap is a ceiling.
7. One background can still underlie the page, used where a section's suggested style is background. Neighboring sections must not share the same goal and verb. Write `<runs>/<page>/asset_plan.json` and the full plan: the page atmosphere, every section, its copy, emphasis, depiction, `copy_shape`, `suggested_style`, compositional layer, job, goal, form, fit score, reason, secondary marks, and any proposed lexicon entry. STOP.

Do not plan an indigo wash as its own asset.

## Output

```json
{
  "page": "",
  "sections": [
    {
      "id": "",
      "copy": "",
      "emphasis": "high | low | none",
      "depiction": "user | us | about_us",
      "assertion": "",
      "copy_shape": "one assertion | peer parts only | contrast | one assertion and peer parts | utility",
      "suggested_style": "background | focus | distinguishing | none",
      "composition": "single | flow | none",
      "visuals": [{ "style": "background | focus | distinguishing", "job": "feeling | explanation | neither" }],
      "job": "makes a claim | explains how something works | moves the reader between ideas",
      "goal": "flow | emphasis | clarity",
      "goal_reason": "",
      "verb": "",
      "verb_status": "seed | proposed",
      "direction": "",
      "fit": 0,
      "fit_reason": "",
      "rejected": [{ "verb": "", "fit": 0, "reason": "" }],
      "placement": "behind the section | on the assertion | between the parts",
      "secondary_marks": [{ "mark": "underline | tick | connector", "items": [], "reason": "" }],
      "secondary_reason": ""
    }
  ],
  "proposed_lexicon": [{ "verb": "", "direction": "", "why": "" }]
}
```
