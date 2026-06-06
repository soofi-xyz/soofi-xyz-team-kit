---
name: use-figma-mcp
description: "User guide for reading and writing Figma design files through the official Figma MCP server — tool selection (get_metadata, get_design_context, get_screenshot, use_figma), the use_figma execution model, Plugin API mutation rules, and error recovery. Use whenever a task inspects or modifies a Figma file via MCP tools. Not for translating Figma designs into application code — use figma-to-code for that."
license: Complete terms in LICENSE.txt
---

# Use Figma MCP

How to drive the **official Figma MCP server** correctly. Read this before calling any Figma MCP tool. If your environment already provides Figma's own `figma-use` skill, load that as the authoritative reference and treat this as the repo-local summary.

## Setup & Preconditions

- The official Figma MCP server must be connected in your MCP client. Verify identity and seat with the `whoami` tool when permission errors appear.
- Every tool call needs a `fileKey`. Extract it from the file URL: `figma.com/design/:fileKey/:fileName?node-id=:nodeId`. Convert `node-id` dashes to colons (`10-3` → `10:3`). For branch URLs (`/design/:fileKey/branch/:branchKey/`), use the branch key.
- The MCP does NOT auto-detect the file open in the desktop app — always obtain a URL.
- Writing requires edit access to the file. Confirm cheaply before relying on it: create a tiny node, then `remove()` it in the same script.

## Choosing the Right Tool

| Task | Tool |
| --- | --- |
| Overview of pages / node tree (IDs, names, sizes) | `get_metadata` — cheap, XML, no styles |
| Styles, layout, and reference code for implementing a node | `get_design_context` |
| Visual inspection, before/after verification | `get_screenshot` |
| Any mutation; any read that needs computed Plugin API state | `use_figma` (JavaScript in the file's plugin sandbox) |

Prefer `get_metadata` for orientation and `use_figma` read scripts for aggregate analysis; `get_design_context` on large nodes returns a lot of output — scope it to the smallest node that answers the question.

## `use_figma` Execution Model

1. Write plain JavaScript with top-level `await`. Do NOT wrap code in an async IIFE — it is wrapped for you.
2. `return` is the ONLY output channel. `console.log` is invisible. `figma.notify()` throws "not implemented".
3. Scripts are **atomic**: a script that throws applied NOTHING. On error: stop, read the message, fix, retry. Do not retry verbatim.
4. **No state persists between calls.** Variables die with the script. Return every created/mutated node ID (`return { createdNodeIds: [...] }`) and pass IDs into later scripts as string literals.
5. Each call starts on the file's first page. Switch with `await figma.setCurrentPageAsync(page)` — the sync setter `figma.currentPage = page` throws. Switch at most ONCE per call; for multi-page work, issue one parallel `use_figma` call per page in a single message.
6. Work incrementally: ~10 logical operations per call, then verify. Do not build a whole screen in one script. Exception: uniform bulk mutations — the same property change applied to many matched nodes via a query/loop — may run as ONE script regardless of node count; scripts are atomic, and the aggregate counts the script returns are the verification.
7. `await` every Promise. Fire-and-forget async calls cause silent half-applied state.
8. `getPluginData`/`setPluginData` are unsupported. Use `getSharedPluginData` or returned IDs.

## Mutation Rules

- **Colors are 0–1 floats**: `{r: 1, g: 0, b: 0}` is red. No `a` key inside `color` — opacity sits at the paint level: `{type: 'SOLID', color, opacity: 0.5}`.
- **`fills`/`strokes`/`effects` are read-only arrays**: clone, modify the clone, reassign the whole array.
- **Text requires loaded fonts.** Before mutating `characters`, font, or size: `await figma.loadFontAsync({family, style})`. For existing text, discover its current fonts via `node.getStyledTextSegments(['fontName'])` and load those — not a guessed default. Style names are exact strings ("Semi Bold", not "SemiBold"); verify with `figma.listAvailableFontsAsync()` when unsure.
- **Auto-layout for related children.** Use `figma.createAutoLayout('VERTICAL', {...})` instead of `createFrame` + absolute x/y when children stack, align, or gap. Append the child BEFORE setting `layoutSizingHorizontal/Vertical = 'FILL'`; `'HUG'` is valid only on the auto-layout frame itself or its TEXT children; call `resize()` BEFORE setting sizing modes (resize resets them).
- **Containers never auto-grow.** Appending or moving a child beyond a container's bounds leaves the container's size unchanged — the child shows in the layers panel but renders cropped or fully invisible (clipping frames and component sets especially; the UI grows a set when you drag a variant in, the API does not). After inserting, grow the container to enclose the union of its children's bounds — `resizeWithoutConstraints`, so existing children don't stretch — then verify visibility with a screenshot.
- **`resize()` moves the envelope only — `rescale()` scales the content.** Resizing a frame leaves children at their original size (they follow constraints/auto-layout), which crops or overflows freeform content. For composite artwork — diagrams, illustrations, any frame or instance whose children sit at fixed positions — use `node.rescale(factor)` (the Scale-tool equivalent) so the whole subtree scales proportionally.
- `lineHeight`/`letterSpacing` take `{unit, value}` objects, not bare numbers.
- **`clone()` and `create*()` parent new nodes under `figma.currentPage`** — which resets to the file's FIRST page at the start of every call. A node landing on the wrong Figma page throws no error; it is silent. When the work targets any other page, `await figma.setCurrentPageAsync(workingPage)` BEFORE creating or cloning, and verify the new node's page before building on it (check `node.parent`). Rescue a stray with `workingPage.appendChild(node)` — appendChild moves the node.
- Position new top-level nodes away from (0,0) — scan existing children and place clear of them. Nested children are positioned by their parent.
- Never mutate a design you were asked to analyze or use as input. Duplicate (`node.clone()`), transform the clone, return its IDs.

## Efficient Helpers

- `node.query('FRAME[name^=Card] TEXT')` — CSS-like subtree search (types, `[attr=…]`, `>`, `:nth-child`). Page-wide: `figma.currentPage.query(...)`. Extract with `.values(['name','x'])`, batch-update with `.set({...})`.
- `node.set({opacity: 0.5, cornerRadius: 8, name: 'Card'})` — batch property assignment; `width`/`height` route through `resize()`.
- `await node.screenshot()` — inline PNG for verification inside the same call; `{scale: N}` to control size.
- `figma.skipInvisibleInstanceChildren = true` before `findAll`/`findAllWithCriteria` — dramatically faster traversal.
- `node.placeholder = true` — shimmer overlay while building a section; ALWAYS set back to `false` when done.

## Verification Loop

After each compositional mutation step: structural check via returned IDs or `get_metadata` (counts, hierarchy, positions), visual check via `get_screenshot` or inline `screenshot()` (look for clipped text, overlaps, broken spacing). Uniform bulk mutations verify numerically via the counts they return — screenshot at milestones rather than per step. Fix before building further — never stack work on a broken foundation.

## Error Recovery

| Error | Cause | Fix |
| --- | --- | --- |
| `Cannot write to node with unloaded font "…"` | Text mutation without `loadFontAsync` | Load the node's actual fonts first (see Mutation Rules) |
| `Setting figma.currentPage is not supported` | Sync page setter | `await figma.setCurrentPageAsync(page)` |
| `FILL/HUG can only be set on…` | Sizing set before append, or wrong node kind | Append first; `HUG` only on auto-layout frames/TEXT; otherwise `FIXED` + `resize()` |
| `"not implemented"` | `figma.notify()` | Remove it; `return` data instead |
| Property value out of range | 0–255 color channels | Divide by 255 |
| `The node with id X does not exist` | Stale ID (detached instance, removed node) | Re-discover from a stable parent via query/metadata |
| New/cloned node appeared on the file's first page | `clone()`/`create*` parent to `figma.currentPage`, which reset between calls | `setCurrentPageAsync(workingPage)` before creating; move strays with `workingPage.appendChild(node)` |
| Script hangs | Unawaited Promise or infinite loop | `await` everything; bound loops |

Remember: failed scripts changed nothing — fixing and retrying is safe.

## Pre-Flight Checklist

- [ ] `fileKey` extracted from a URL; node IDs use `:` form.
- [ ] Output returned via `return`, including ALL created/mutated node IDs.
- [ ] At most one `setCurrentPageAsync` per call; multi-page work fanned out in parallel.
- [ ] Working page set at the start of every call that creates or clones — new nodes land on `figma.currentPage`, which reset to the first page.
- [ ] Fonts loaded before any text mutation; style names verified, not guessed.
- [ ] Colors 0–1; paint arrays cloned and reassigned, not mutated in place.
- [ ] ≤ ~10 logical operations, then a verification step.
- [ ] Input designs untouched — mutations land on copies.
