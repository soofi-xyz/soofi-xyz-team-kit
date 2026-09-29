#!/usr/bin/env node
// Layout preview. Run: node scripts/sheet.mjs <readings.json> <id-prefix> [...]
// Lays each reading's headline, body, and CTA over its image at the positions in `layout`, desktop and mobile side by side.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { runPath } from "./prism-paths.mjs";

const [readingsArg, ...prefixes] = process.argv.slice(2);
const readingsPath = runPath(readingsArg);
const readings = JSON.parse(await readFile(readingsPath, "utf8"));
const picks = readings.filter((reading) => prefixes.some((prefix) => reading.id.startsWith(prefix)));

const frames = { desktop: { width: 960, headline: 52, body: 18 }, mobile: { width: 390, headline: 32, body: 16 } };
const escape = (text) => String(text).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
const box = (spec) => `left:${spec.left}%;top:${spec.top}%;${spec.width ? `width:${spec.width}%;` : ""}`;

const cards = picks.map((reading) => {
  const frame = frames[reading.breakpoint] ?? frames.desktop;
  const [w, h] = (reading.size ?? "1536x1024").split("x").map(Number);
  const layout = reading.layout ?? {};
  const type = [
    layout.headline && `<h1 style="${box(layout.headline)}font-size:${frame.headline}px">${escape(reading.copy)}</h1>`,
    layout.body && `<p style="${box(layout.body)}font-size:${frame.body}px">${escape(layout.body.text ?? "Supporting body copy sits here, one or two lines long, to show its real weight.")}</p>`,
    layout.cta && `<a style="${box(layout.cta)}font-size:${frame.body}px">${escape(layout.cta.text ?? "Get started")}</a>`,
  ].filter(Boolean).join("");
  return `<figure><div class="frame" style="width:${frame.width}px;aspect-ratio:${w}/${h};background-image:url('${reading.image ?? `${reading.id}.png`}')">${type}</div><figcaption>${escape(reading.id)}${layout.headline ? "" : " — no layout recorded"}</figcaption></figure>`;
});

const html = `<!doctype html><meta charset="utf-8"><title>${escape(prefixes.join(", "))}</title>
<style>
body{margin:32px;background:#e9e8e8;font-family:Inter,system-ui,sans-serif;display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start}
figure{margin:0}.frame{position:relative;background-size:cover;background-color:#F8F7F7;box-shadow:0 1px 4px #0002}
.frame>*{position:absolute;margin:0;color:#161616}
h1{font-weight:500;line-height:1.05;letter-spacing:-0.02em}p{line-height:1.4;color:#161616b3}
a{background:#161616;color:#F8F7F7;padding:12px 20px;border-radius:999px;white-space:nowrap;text-decoration:none}
figcaption{font-size:12px;color:#555;margin-top:8px}
</style>${cards.join("")}`;

const out = resolve(dirname(readingsPath), `${prefixes[0]}.sheet.html`);
await writeFile(out, html);
console.log(out);
