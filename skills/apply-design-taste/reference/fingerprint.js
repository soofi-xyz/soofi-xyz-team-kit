// Read-only style fingerprint for a Figma subtree.
//
// NOT a standalone script — the `figma` global only exists inside the Figma MCP sandbox.
// Usage: copy this file's entire contents into the `code` parameter of a `use_figma`
// tool call, replacing PAGE_ID and ROOT_ID below. Use it verbatim twice per run —
// once to diagnose the input (Workflow step 1), once to verify the output (step 6) —
// so the before/after tallies are directly comparable.
//
// PAGE_ID: the Figma page (canvas) containing the screen. ROOT_ID: the screen root —
// the designed page's top-level frame/component. To fingerprint a whole Figma page,
// set ROOT_ID to the page id as well.

const PAGE_ID = '0:0'; // <-- replace
const ROOT_ID = '0:0'; // <-- replace

const page = await figma.getNodeByIdAsync(PAGE_ID);
await figma.setCurrentPageAsync(page);
figma.skipInvisibleInstanceChildren = true;
const root = await figma.getNodeByIdAsync(ROOT_ID);

const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
const tally = (map, key) => { map[key] = (map[key] || 0) + 1; };
const top = (map, n = 15) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);

const fonts = {}, sizes = {}, textFills = {}, aligns = {}, lineHeights = {},
      spacings = {}, paddings = {}, radii = {}, solidFills = {}, gradientFills = {},
      effectsTally = {}, strokes = {};
const headings = [];
let textCount = 0;

// findAll returns descendants only — include the root itself, since page/frame base
// signals (base tint, root effects, radius) live there and feed the Direction Checks.
const all = [root, ...root.findAll(() => true)];
for (const node of all) {
  if (node.type === 'TEXT') {
    textCount++;
    const fontName = typeof node.fontName === 'symbol' ? 'mixed' : node.fontName.family + ' ' + node.fontName.style;
    tally(fonts, fontName);
    const fontSize = typeof node.fontSize === 'symbol' ? 'mixed' : node.fontSize;
    tally(sizes, String(fontSize));
    tally(aligns, node.textAlignHorizontal);
    const lh = typeof node.lineHeight === 'symbol' ? 'mixed' : (node.lineHeight.unit === 'AUTO' ? 'AUTO' : node.lineHeight.value + node.lineHeight.unit);
    tally(lineHeights, String(fontSize) + '/' + lh);
    if (Array.isArray(node.fills) && node.fills[0] && node.fills[0].type === 'SOLID') tally(textFills, hex(node.fills[0].color));
    if (typeof fontSize === 'number' && fontSize >= 28) headings.push({ size: fontSize, align: node.textAlignHorizontal, text: node.characters.slice(0, 60) });
  } else if ('fills' in node && Array.isArray(node.fills)) {
    for (const fill of node.fills) {
      if (!fill.visible && fill.visible !== undefined) continue;
      if (fill.type === 'SOLID') tally(solidFills, hex(fill.color) + (fill.opacity !== undefined && fill.opacity < 1 ? '@' + Math.round(fill.opacity * 100) + '%' : ''));
      else if (fill.type.startsWith('GRADIENT')) tally(gradientFills, fill.type.replace('GRADIENT_', '') + ':' + fill.gradientStops.map(s => hex(s.color)).join('>'));
    }
  }
  if ('layoutMode' in node && node.layoutMode !== 'NONE') {
    tally(spacings, String(node.itemSpacing));
    tally(paddings, [node.paddingTop, node.paddingRight, node.paddingBottom, node.paddingLeft].join(','));
  }
  if ('cornerRadius' in node && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) tally(radii, String(node.cornerRadius));
  if ('effects' in node) for (const effect of node.effects) tally(effectsTally, effect.type + (effect.radius ? ':' + effect.radius : ''));
  if ('strokes' in node && Array.isArray(node.strokes) && node.strokes.length && node.strokes[0].type === 'SOLID') {
    tally(strokes, hex(node.strokes[0].color) + (node.strokes[0].opacity !== undefined && node.strokes[0].opacity < 1 ? '@' + Math.round(node.strokes[0].opacity * 100) + '%' : '') + ' w' + String(node.strokeWeight));
  }
}

const sections = 'children' in root ? root.children.map(child => ({
  name: child.name, h: Math.round(child.height),
  layout: child.layoutMode || 'NONE',
  align: child.counterAxisAlignItems || null,
})) : [];

// Root's own signals, reported separately so Direction Checks can distinguish
// page-level atmosphere from child surfaces. PageNode uses `backgrounds`, not `fills`.
const rootPaints = root.type === 'PAGE' ? root.backgrounds : (Array.isArray(root.fills) ? root.fills : []);
const rootInfo = {
  name: root.name, type: root.type,
  w: 'width' in root ? Math.round(root.width) : null,
  h: 'height' in root ? Math.round(root.height) : null,
  fills: rootPaints.filter(f => f.visible !== false).map(f =>
    f.type === 'SOLID'
      ? hex(f.color) + (f.opacity !== undefined && f.opacity < 1 ? '@' + Math.round(f.opacity * 100) + '%' : '')
      : f.type),
  effects: 'effects' in root ? root.effects.filter(e => e.visible !== false).map(e => e.type + ':' + Math.round(e.radius || 0)) : [],
};

return {
  node: root.name, root: rootInfo, totalNodes: all.length, textCount,
  sections, headings: headings.slice(0, 25),
  fonts: top(fonts), sizes: top(sizes), aligns: top(aligns), lineHeights: top(lineHeights, 10),
  textFills: top(textFills, 10), solidFills: top(solidFills, 15), gradientFills: top(gradientFills, 10),
  spacings: top(spacings), paddings: top(paddings, 10), radii: top(radii), effects: top(effectsTally, 10), strokes: top(strokes, 10),
};
