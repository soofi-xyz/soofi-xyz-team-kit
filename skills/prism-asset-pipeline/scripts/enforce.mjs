#!/usr/bin/env node
// Enforce the Prism system on a generated SVG. Run: node enforce.mjs <file.svg>...
// Thin shapes become sky hairlines, large and gradient shapes become diffused light with
// colors snapped to tokens.json, and compact solid shapes (the players) are recolored sky.

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { artDirection } from "./prism-paths.mjs";

const tokens = JSON.parse(await readFile(resolve(artDirection, "tokens.json"), "utf8")).palette;
const palette = ["sky", "violet", "mint", "solar", "ember", "flare"].map((name) => ({ name, ...rgb(tokens[name].hex) }));

const hue = (r, g, b) => {
  const [x, y, z] = [r, g, b].map((v) => v / 255);
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  if (max === min) return 0;
  const d = max - min;
  const h = max === x ? (y - z) / d : max === y ? 2 + (z - x) / d : 4 + (x - y) / d;
  return ((h * 60) + 360) % 360;
};
function nearest(color) {
  const h = hue(color.r, color.g, color.b);
  return palette.reduce((best, token) => {
    const rgbDist = Math.hypot(color.r - token.r, color.g - token.g, color.b - token.b);
    const hueDist = Math.min(Math.abs(h - hue(token.r, token.g, token.b)), 360 - Math.abs(h - hue(token.r, token.g, token.b)));
    const dist = rgbDist + hueDist * 1.4;
    return dist < best.dist ? { token, dist } : best;
  }, { dist: Infinity }).token;
}
function rgb(hex) {
  return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
}
const css = (color) => `rgb(${color.r},${color.g},${color.b})`;
const parse = (text) => {
  const m = text.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
};

for (const file of process.argv.slice(2)) {
  let svg = (await readFile(file, "utf8")).replace(/<metadata>[\s\S]*?<\/metadata>/, "");
  const width = +svg.match(/viewBox="0 0 ([\d.]+)/)[1];
  const blur = (0.016 * width).toFixed(1);
  const snaps = new Map();
  const snap = (text) => {
    const color = parse(text);
    if (!color) return text;
    const token = nearest(color);
    snaps.set(text, token.name);
    return css(token);
  };

  svg = svg.replace(/stop-color="(rgb\([^)]*\))"/g, (_, c) => `stop-color="${snap(c)}"`);

  let n = 0;
  svg = svg.replace(/<path\b([^>]*)>/g, (tag, attrs) => {
    const fill = attrs.match(/fill="([^"]*)"/)?.[1] ?? "";
    const d = attrs.match(/d="([^"]*)"/)?.[1] ?? "";
    const nums = (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const color = parse(fill);
    const mist = rgb(tokens.mist.hex);
    const ground = color && Math.hypot(color.r - mist.r, color.g - mist.g, color.b - mist.b) < 12;
    const thin = Math.min(w, h) < 40;
    const background = ground || w > width * 0.9;
    const light = !background && (fill.startsWith("url(") || Math.min(w, h) > 200);
    if (background) return tag.replace(/fill="[^"]*"/, `fill="${css(rgb(tokens.mist.hex))}"`);
    if (thin) return tag.replace(/fill="[^"]*"/, `fill="${css(rgb(tokens.sky.hex))}"`);
    if (!light) return tag.replace(/fill="(rgb\([^)]*\))"/, (_, c) => `fill="${css(rgb(tokens.sky.hex))}"`);
    const id = `enf${n++}`;
    const snapped = tag.replace(/fill="(rgb\([^)]*\))"/, (_, c) => `fill="${snap(c)}"`);
    return `<g filter="url(#${id})">${snapped}</g>` +
      `<defs><filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${blur}"/></filter></defs>`;
  });

  const out = file.replace(/\.svg$/, ".enforced.svg");
  await writeFile(out, svg);
  console.log(`${file} -> ${out}  snaps: ${[...snaps.entries()].map(([from, to]) => `${from}->${to}`).join(", ")}`);
}
