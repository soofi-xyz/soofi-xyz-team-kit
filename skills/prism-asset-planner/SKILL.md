---
name: prism-asset-planner
description: Decides which graphics a Prism page needs from raw copy. Use before prism-concept, when given pasted page or section text with no pre-structuring.
---

# Prism asset planner

Paths: `art-direction/...` means `<pipeline>/art-direction/...` and `<runs>` is the runs root, both defined in `prism-asset-pipeline`.

Run this before `prism-concept` and `prism-prompt-writer`. The input is raw copy for a page or a section. It is pasted text or a document. It is not a section file, and it is not `art-direction/sections/home.json`.

Read:

- `art-direction/page-rhythm.md`
- `art-direction/lexicon.json`
- `art-direction/references/decisions.json` only to see style, verb meaning, and which live sections are gaps

A gap in `decisions.json` is a section the current site left bare. Never copy that omission. "No graphic" is not an output.

## Steps

1. Segment the copy into sections. For each, extract the assertion, the body, the evidence, and the CTA. Leave a field empty when the copy has none.
2. State the section's job in the page's argument, then the goal:
   - makes a claim → emphasis, pattern focus
   - explains how something works → clarity, pattern focus, or distinguishing only when the copy contrasts two or more things
   - moves the reader between ideas → flow, pattern background
   Clarity is not the default. Do not run more than two clarity sections in a row. Write a one-line reason for the job and the goal.
3. Score seed verbs 1–5 against that section's copy. Read each verb's direction. Never use a verb against its direction. Split means one source becomes several outputs. Route means paths connecting parts that already exist. If the best score is below 4, propose a new lexicon entry instead of forcing a fit. Flag proposed entries.
4. Secondary marks: underline, tick, or connector, only on the words that carry the claim, and only when the primary does not already carry them. Apply the caps in `page-rhythm.md`. The cap is a ceiling.
5. The hero visual expresses the page's thesis. The CTA bookends it. Neighboring sections must not share the same goal and verb. Write `<runs>/<page>/asset_plan.json` and the full plan: every section, its job, goal, form, fit score, reason, secondary marks, and any proposed lexicon entry. STOP.

Do not plan an indigo wash as its own asset.

## Output

```json
{
  "page": "",
  "sections": [
    {
      "id": "",
      "assertion": "",
      "job": "makes a claim | explains how something works | moves the reader between ideas",
      "goal": "flow | emphasis | clarity",
      "goal_reason": "",
      "pattern_type": "background | focus | distinguishing",
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
