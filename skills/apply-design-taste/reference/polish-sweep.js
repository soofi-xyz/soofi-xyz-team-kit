// Template — NOT a standalone script. Paste into the `code` param of a `use_figma`
// call and replace ROOT_ID. See SKILL.md Workflow step 8 (Final polish pass).
//
// Mechanical polish sweep over one transformed screen. Flags likely:
//   - overlaps:     pairs of text nodes whose boxes intersect
//   - overflowing:  text whose rendered ink escapes its own box (fixed-size text node)
//   - clipped:      text escaping its nearest clipping ancestor (truncation)
//   - lowContrast:  weak luminance delta between a text fill and its backing surface
//   - onBackdrop:   text with no opaque surface between it and the atmosphere —
//                   often legitimate (hero copy), but must be read in a screenshot
// Flags are LEADS, not verdicts — confirm each in a reading-scale screenshot before fixing.

const ROOT_ID = 'REPLACE_ME'; // the transformed screen root

const root = await figma.getNodeByIdAsync(ROOT_ID);
if (!root) throw new Error('ROOT_ID not found: ' + ROOT_ID);
figma.skipInvisibleInstanceChildren = true;

const texts = root.findAll((node) => node.type === 'TEXT' && node.visible);

const lum = (color) => 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;

// Luminance of the topmost effectively-opaque visible fill; null if nothing opaque paints.
// Gradients use average stop luminance — an approximation, hence "leads not verdicts".
function paintedLum(fills) {
  if (!Array.isArray(fills)) return null; // includes figma.mixed
  const visible = fills.filter((fill) => fill.visible !== false);
  for (let i = visible.length - 1; i >= 0; i--) {
    const fill = visible[i];
    const alpha = fill.opacity === undefined ? 1 : fill.opacity;
    if (fill.type === 'SOLID' && alpha > 0.6) return lum(fill.color);
    if (fill.type.startsWith('GRADIENT') && fill.gradientStops && alpha > 0.6) {
      const stops = fill.gradientStops;
      return stops.reduce((sum, stop) => sum + lum(stop.color), 0) / stops.length;
    }
  }
  return null;
}

// Nearest ancestor below the root that paints an opaque backing; null = sits on the backdrop.
function backingOf(node) {
  let current = node.parent;
  while (current && current.id !== root.id) {
    const backingLum = paintedLum(current.fills);
    if (backingLum !== null) return { id: current.id, name: current.name, lum: backingLum };
    current = current.parent;
  }
  return null;
}

const snippet = (text) => text.characters.slice(0, 40);
const flags = { overlaps: [], overflowing: [], clipped: [], lowContrast: [], onBackdrop: [] };

for (const text of texts) {
  const box = text.absoluteBoundingBox;
  if (!box) continue;

  // contrast vs backing
  const textLum = paintedLum(text.fills);
  const backing = backingOf(text);
  if (!backing) {
    flags.onBackdrop.push({ id: text.id, text: snippet(text) });
  } else if (textLum !== null && Math.abs(textLum - backing.lum) < 0.35) {
    flags.lowContrast.push({
      id: text.id, text: snippet(text), textLum: +textLum.toFixed(2),
      backing: backing.name, backingLum: +backing.lum.toFixed(2),
    });
  }

  // ink escaping the text node's own box (fixed-size text overflowing)
  const ink = text.absoluteRenderBounds;
  if (ink && (ink.width > box.width + 2 || ink.height > box.height + 2)) {
    flags.overflowing.push({ id: text.id, text: snippet(text) });
  }

  // box escaping the nearest clipping ancestor (truncation)
  let ancestor = text.parent;
  while (ancestor && ancestor.id !== root.id) {
    if (ancestor.clipsContent && ancestor.absoluteBoundingBox) {
      const clip = ancestor.absoluteBoundingBox;
      if (box.x < clip.x - 1 || box.y < clip.y - 1 ||
          box.x + box.width > clip.x + clip.width + 1 ||
          box.y + box.height > clip.y + clip.height + 1) {
        flags.clipped.push({ id: text.id, text: snippet(text), clipper: ancestor.name });
      }
      break; // only the nearest clipper matters
    }
    ancestor = ancestor.parent;
  }
}

// overlapping text pairs (more than a sliver)
for (let i = 0; i < texts.length; i++) {
  const boxA = texts[i].absoluteBoundingBox;
  if (!boxA) continue;
  for (let j = i + 1; j < texts.length; j++) {
    const boxB = texts[j].absoluteBoundingBox;
    if (!boxB) continue;
    const overlapW = Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x);
    const overlapH = Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y);
    if (overlapW > 4 && overlapH > 4) {
      flags.overlaps.push({
        a: { id: texts[i].id, text: snippet(texts[i]) },
        b: { id: texts[j].id, text: snippet(texts[j]) },
      });
    }
  }
}

const counts = {};
for (const kind of Object.keys(flags)) {
  counts[kind] = flags[kind].length;
  flags[kind] = flags[kind].slice(0, 20); // cap output; counts keep the true totals
}

return { textCount: texts.length, flagCounts: counts, flags };
