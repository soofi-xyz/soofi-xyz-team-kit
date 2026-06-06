# Training-pair fixtures

Reproducible evidence behind the taste rules in `../../SKILL.md` (see its Provenance section): style
fingerprints of the one training evolution the taste was learned from, captured from the
"Prism Website Design" Figma file on 2026-06-05.

| File | What it is |
| --- | --- |
| `training-v1-fingerprint.json` | The initial design (V1, Cursor-built) — Home page, Wide breakpoint |
| `training-final-fingerprint.json` | The designer's shipped final — same page, same breakpoint |

## How they were captured

`../fingerprint.js` pasted into a `use_figma` call against the node IDs recorded in each file's
`_meta`. The `backgroundConstruction` blocks come from a follow-up inspection script the same day
(gradient instance placement, preset internals, glass recipe); the `root` blocks were captured
separately at the time — the current `fingerprint.js` now includes root signals natively.

## How to use them

- **Offline**: diff the two files dimension by dimension to see exactly what the designer changed —
  this is the evidence the SKILL.md taste rules (T1–T12) were distilled from. Learn mode can be
  dry-run against this pair: feed both fingerprints to the distillation step and compare the
  resulting rules with the shipped SKILL.md.
- **Live**: re-run `../fingerprint.js` against the `_meta` node IDs to reproduce (requires access to
  the Figma file; tallies should match modulo any later edits to the file).

Note: tallies are top-N truncated and aggregate by occurrence count; they characterize style
direction, not the complete node tree.
