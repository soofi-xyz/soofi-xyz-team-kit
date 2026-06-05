---
name: apply-design-taste
description: Transform an initial or AI-generated Figma design into a polished, art-directed final by applying the studio designer's learned taste. Use when asked to refine, elevate, polish, or "finalize" a draft Figma design. Prefer routing through the mimikyu agent, which owns input collection (scope, placement) and the non-destructive guarantees; load this skill directly only when that agent is unavailable.
license: Complete terms in LICENSE.txt
---

This skill encodes the studio designer's taste, learned from a real V1 → final design evolution. It tells you the **direction** a draft must move in — never the destination. Two runs on the same input SHOULD produce different results that share the same taste trajectory.

## When to Use

- A draft, first-pass, or AI-generated Figma design needs to be elevated to a final-quality design.
- An agent (e.g. `mimikyu`) is asked to "do what the designer would have done" to a V1.

## Terminology

Three distinct things are easy to conflate — this skill uses these terms exactly:

- **Figma page**: an entry in the file's page list (a canvas; `PageNode`). One file holds several Figma pages.
- **Screen**: one designed page of the website/app — a screen-sized top-level frame or `Pages/*`-style component set sitting ON a Figma page. One Figma page often holds many screens side by side.
- **Screen root**: a screen's own top-level frame — the node every taste rule operates within.

**Blast radius rule: all work is confined to the single targeted Figma page (and its duplicate). NEVER touch other Figma pages in the file.**

## Required Inputs

- Figma file key and the node ID of the target — a Figma page or a single screen root.
- **Scope**: ONE screen per run is the default. Transform the screen the user pointed at (the provided node ID, or the screen containing it). Transform additional screens ONLY when the user explicitly asks for them. If the target is a whole Figma page holding multiple screens: ask which screen(s) if you can; if you cannot ask, pick the primary screen (the home/first screen, at its widest breakpoint), state that choice, and stop there. UI library components, standalone artwork, and scratch/experiment frames are never in scope unless explicitly requested.
- **Placement**: ask the user whether transforming in place is allowed. If asking is not possible, NEVER transform in place — always work on a copy.
- Figma write access via the Figma MCP (`use_figma`, `get_screenshot`, `get_metadata`).
- Load [`use-figma-mcp`](../use-figma-mcp/SKILL.md) before calling any Figma MCP tool — it covers the execution model, mutation rules, and error recovery this workflow depends on.

## The Prime Directive: Derive, Never Copy

Every concrete value you apply MUST be derived from the target file itself — its dominant typeface, its existing brand hues, its spacing quantum. The taste rules below are expressed as **transformations relative to the file's current state**.

- Do NOT carry literal values (hex colors, px paddings, font names) from this skill, from training examples, or from any other design into the target.
- Where a rule leaves room for interpretation (which accent hue to tint surfaces with, where light sections go, how moody the gradients are), make a deliberate choice and record it in your output. Different runs SHOULD make different choices. Taste fixes the direction, not the destination.

## Taste Rules

Apply each rule by first measuring the file (see Workflow), then moving it in the stated direction. Magnitudes are ranges, not targets. Rules operate on one screen at a time.

### T1 — One voice: consolidate typography
Reduce to a single type family — the file's dominant or brand face. Re-set every text node using secondary families (a second family is acceptable only for code/mono semantics). Establish a clear ramp: hero display, section heading, subheading, body, eyebrow/caption.

### T2 — Fewer, bigger words
Cut text node count noticeably (target 25–40% reduction): merge fragmented labels, delete filler copy, drop redundant micro-captions. Eliminate sub-12px text entirely; promote the body size one step. Less text, more presence. **Content guardrail:** never remove or alter CTAs, navigation labels, legal/compliance copy, or factual product claims — cuts target redundancy and filler only, and every proposed cut MUST be listed in the declared interpretation (Workflow step 3) before it is applied.

### T3 — Center the narrative spine
Center-align hero and full-width section headings (and their lead paragraphs). Keep left alignment inside multi-column structures, cards, and data-dense blocks. The screen should read as a centered story interrupted by structured asides. The spine applies to pictures as much as words: when an image, diagram, or illustration is the main point of a section, center it horizontally.

### T4 — Chroma over neutral alpha
Find surfaces and hairlines built from white/black at low opacity on a dark base (the flat "AI dark mode" tell). Replace them with brand-tinted equivalents: tinted translucent fills, colored strokes drawn from the file's own accent palette. Neutral alpha is a placeholder, not a finish.

### T5 — Light/dark rhythm
Break a monotone screen by inverting the value of 1–3 sections (light sections in a dark screen, or the reverse). Place inversions where the narrative shifts. Which sections flip is an interpretation choice — vary it.

### T6 — Continuous atmosphere
The draft tells: every section paints its own background color that trumps the screen; or only the hero gets any atmosphere and the rest of the scroll is bare; or glow artwork is stretched (aspect-squashed) to exactly fill its section like wallpaper. The taste: **the background is a screen-level concern, never a section-level one** — one continuous light field that the entire scroll floats in. Mechanics, in order:

1. **One backdrop, screen-scale.** Tint the screen base toward a brand hue (never neutral black/gray). Then build a SINGLE atmosphere layer at the bottom of the z-order: absolutely positioned, full screen width, spanning all or nearly all of the screen height. Reuse the file's existing atmosphere/gradient components when present; when none exist, GENERATE the artwork — a transparent screen-tall frame holding large, heavily blurred color fields in the file's brand hues (soft ellipses/vectors, blur radius a large fraction of their size), densest around the hero and recurring down the whole scroll so no stretch of the screen goes dead.
2. **Sections are transparent by default.** Remove per-section background fills so the backdrop shows through everywhere. Failure modes this forbids: the atmosphere stopping after the first section; every section restating its own background; the input's flat fills surviving untouched.
3. **Overrides are deliberate exceptions.** Only T5's 1–3 inverted sections and elevated elements (glass surfaces, featured cards) may paint over the backdrop. Where an override meets the backdrop, hand off with a vertical fade (transparent edge → override color), never a hard seam.
4. **Local accents bleed and peek.** Extra artwork instances may be placed absolutely for emphasis: oversized relative to their container (~1.5–3×), offset past its edges, optionally rotated, opacity reduced — *bleeding* across boundaries (unclipped parent) or *peeking* through a card's clipping window (clipped parent). NEVER stretch or aspect-squash artwork to fit a container.
5. **Glass above the atmosphere.** Every surface sitting on the backdrop gets one uniform recipe derived from the brand palette: tinted low-alpha fill (~10–20%) + large background blur + same-hue hairline stroke + the card radius tier (and optionally a soft shadow). One recipe, applied consistently — not per-card improvisation.

**Figma implementation of the backdrop.** Screen roots are usually vertical auto-layout frames, so:
- Set the screen root to clip (`clipsContent = true`). Atmosphere may cross section boundaries freely, but NOTHING ever renders outside the screen root onto the Figma page.
- Create the backdrop as a DIRECT child of the screen root with `layoutPositioning = 'ABSOLUTE'`, pinned at (0, 0), full screen width, spanning ≥80% of the screen height, and send it to the back (`insertChild(0, …)`).
- Do NOT nest the backdrop inside the first section. A backdrop living in the hero dies at the hero's bottom edge — that is exactly the sharp-stop failure this rule exists to prevent.
- The backdrop itself does not clip; distribute the blurred color fields down its entire height, then let the screen root do the cropping.
- Verify with a full-screen screenshot: scan every section boundary for abrupt background changes, and the screen edges for artwork escaping the frame.

### T7 — Multiply whitespace
Increase section vertical padding by 1.5–2.5×. Introduce larger spacing tiers above the file's current maximum (roughly: add tiers at 2× and 4× the current largest gap). Narrow the content column — generous horizontal insets at wide breakpoints. The screen gets taller while text gets shorter; that is correct.

### T8 — Round up
Roughly double the corner-radius scale and keep it tiered and consistent (e.g. controls / cards / featured surfaces). No sharp-cornered cards on an atmospheric screen.

### T9 — Parallel content sits side by side
Adjacent stacked sections with parallel content (two pillars, two halves of one argument) become one section with columns. Compress vertical repetition into horizontal rhythm.

### T10 — The header floats
Take the header out of the screen's flow: overlay/sticky on top of the hero atmosphere, slightly taller, with a glass treatment consistent with T6.

### T11 — Systematize while you style
Repeated decoration becomes a component with presets. Missing interaction states (hover, confirmation, mobile menu) get added to touched components. Standalone artwork (diagrams, illustrations) is extracted into its own components rather than living inline.

### T12 — Accent is seasoning
Demote overused accent colors: reserve them for eyebrows, links, and one or two key highlights per viewport. If an accent appears on dozens of text nodes, most of them revert to the neutral foreground.

## Workflow

1. **Fingerprint first.** Copy the contents of `reference/fingerprint.js` into the `code` parameter of a `use_figma` call, replacing the constants: `PAGE_ID` = the targeted Figma page, `ROOT_ID` = the screen root (it is a template, not a standalone script). It returns tallies of fonts, sizes, alignments, fills, strokes, spacings, paddings, radii, and effects. Take a screenshot for visual context.
2. **Diagnose.** For each taste rule T1–T12, note what the fingerprint says and whether the rule fires (e.g. "two families found → T1 fires"; "no sub-12px text → T2 partially satisfied"). Rules that don't fire are skipped — do not invent work.
3. **Declare an interpretation.** Write down the concrete choices you will make (accent hue for tinting, which sections invert, gradient mood, padding multiplier). This is the run's creative signature — it should differ between runs.
4. **Work on a copy — never in place.** Duplicate the in-scope screen(s) — or the whole targeted Figma page when instructed — and transform only the copies. Transform in place ONLY when the user has explicitly allowed it for this run. If a required copy cannot be created for any reason (permissions, component restrictions, errors), STOP and report — do not fall back to in-place editing.
5. **Apply in two gears.** *Bulk rules* — uniform mutations across many matched nodes (T1 typography, T4 tint/stroke swaps, T7 spacing, T8 radii, T12 accent demotion) — run as ONE atomic script per rule: query/loop over every matching node, apply the change, and return aggregate counts as the verification. *Compositional rules* — T6's backdrop, T2's content edits, T9–T11 restructuring — stay incremental: small scripts (~10 logical operations), one section or structure at a time. Start with the widest breakpoint; propagate to other breakpoints only if asked. When time or budget is constrained, apply the high-signal rules first (T1, T2, T3, T6, T7, T8), then the structural ones (T9–T11) — a clean partial pass beats a scattered full pass.
6. **Verify at milestones, not after every step.** Bulk rules verify numerically from the counts each script returns. Screenshots happen at three milestones only: after the T6 backdrop, once mid-pass, and on the finished result (use a small `maxDimension` for all but the final one). Fix what a milestone reveals before continuing; the T6 boundary scan runs on the final screenshot.
7. **Verify by re-fingerprinting.** Run the fingerprint script on the result and compare against step 1 using the Direction Checks below.

## Direction Checks (verification, not targets)

After transforming, ALL applicable checks must hold relative to the original fingerprint:

- [ ] Scope: only the requested screen(s) were transformed — one screen unless more were explicitly requested; all changes are confined to the targeted Figma page (and its duplicate); no other Figma page in the file was touched.
- [ ] Type families: reduced to 1 (+ optional mono).
- [ ] Text nodes: fewer; sub-12px sizes: zero; body size: not smaller.
- [ ] Full-width headings: predominantly centered; section-defining images/diagrams: centered.
- [ ] Neutral low-alpha surfaces/hairlines: replaced with tinted/colored equivalents.
- [ ] At least one value-inverted (light/dark) section on a previously monotone screen.
- [ ] Atmosphere: ONE backdrop exists as a direct, absolutely-positioned child of the screen root spanning ≥80% of the screen height — never nested inside the hero; sections are transparent by default, with per-section background fills removed except declared overrides (inversions, glass); accent artwork bleeds/peeks with zero stretched-to-fit wallpaper.
- [ ] Boundary scan: the screen root clips; a full-screen screenshot shows no abrupt background change at any section seam (declared overrides hand off with fades) and no artwork rendering outside the screen root.
- [ ] Glass: surfaces above the atmosphere share one uniform recipe (tinted low-alpha fill + background blur + same-hue hairline + card radius).
- [ ] Spacing: larger top tiers exist; section paddings increased; screen taller despite less text.
- [ ] Radius scale: increased, tiered.
- [ ] Header: overlays content instead of sitting in flow.
- [ ] Accent color usage count: reduced, concentrated in eyebrows/highlights.
- [ ] The input design is untouched and all changes live in the copy — unless the user explicitly permitted in-place editing for this run.

## Output Expectations

- The transformed design (node IDs of the copy).
- The declared interpretation (the choices made this run).
- Before/after fingerprint summaries and which Direction Checks pass.
- Honest notes on gaps — what taste calls for that wasn't applied and why.

## Provenance (evidence, not targets)

These rules were distilled by diffing a real V1 ("V0 Cursor build") against the designer's shipped final on the same site. Sample evidence: secondary font eliminated (26 nodes re-set); text nodes −37% with body promoted 17→18; 16 white@4% surfaces and 16 white@12% hairlines replaced by brand-tinted glass and colored strokes; section padding 56px → 104–208px with ~14% horizontal insets; radius scale 6 → 12/16/32; headings left → centered; header moved to floating overlay; two stacked 279px sections merged into one 2-column section; backdrop-blur glass introduced (×9). Background evidence (T6): screen base went neutral `#161616` → brand-tinted `#1d1736`; the gradient preset components' opaque base layer was removed so they composite; instance usage went from squashed-to-section wallpaper (1000×800 artwork crushed to 1536×283, pinned at 0,0) to oversized/rotated/bleeding placements (1536×1536 in a 699px-tall unclipped hero at y=−260; 831×1453 rotated −36° at 66% opacity peeking into a 518×509 clipping card); flat section fills became transparent-to-neighbor-hue vertical fades; glass was standardized across 9 surfaces (`#342d52@15%` fill + background blur 100 + `#4d456e` hairline + radius 12). **Every number in this paragraph is evidence of direction — never copy any of them into a target file.** The full captured fingerprints of both training versions live in `reference/fixtures/` for offline inspection and reproduction.
