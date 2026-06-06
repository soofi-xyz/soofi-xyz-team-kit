// Template — NOT a standalone script. Paste into the `code` param of a `use_figma`
// call and replace the constants. See SKILL.md Workflow step 4 (and step 6 for
// propagated breakpoint copies — same recipe).
//
// Canonical duplication step. `clone()` parents the copy under `figma.currentPage`,
// which resets to the file's FIRST page on every call — an unset page silently drops
// the copy there. This script makes misplacement impossible by construction:
// set page BEFORE cloning, assert the parent, position beside the source.

const WORKING_PAGE_ID = 'REPLACE_ME'; // the targeted Figma page (or its duplicate)
const SOURCE_ID = 'REPLACE_ME';       // the screen root (or component set) to copy
const GAP = 200;                      // px between the source and the copy

const workingPage = await figma.getNodeByIdAsync(WORKING_PAGE_ID);
if (!workingPage || workingPage.type !== 'PAGE') {
  throw new Error('WORKING_PAGE_ID is not a Figma page: ' + WORKING_PAGE_ID);
}
await figma.setCurrentPageAsync(workingPage); // BEFORE cloning — clones parent here

const source = await figma.getNodeByIdAsync(SOURCE_ID);
if (!source) throw new Error('SOURCE_ID not found: ' + SOURCE_ID);

const copy = source.clone();

// Belt and suspenders: assert the parent even though the page was just set.
if (!copy.parent || copy.parent.id !== workingPage.id) {
  workingPage.appendChild(copy); // appendChild MOVES the node
}

// Guideline placement: beside the source, off to its right, top-aligned.
// absoluteBoundingBox works even when the source is nested (e.g. a variant in a set).
const sourceBox = source.absoluteBoundingBox;
copy.x = sourceBox.x + sourceBox.width + GAP;
copy.y = sourceBox.y;

return {
  copyId: copy.id,
  copyName: copy.name,
  parentPage: { id: copy.parent.id, name: copy.parent.name },
  x: copy.x, y: copy.y, w: copy.width, h: copy.height,
};
// Next: screenshot the copy (SKILL.md step 4 verification gate) before transforming.
