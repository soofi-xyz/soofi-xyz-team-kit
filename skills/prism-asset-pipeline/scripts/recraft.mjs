#!/usr/bin/env node
// Recraft vector generation. Run: node recraft.mjs <readings.json> <id...>
// Each reading needs `recraft_prompt` and `breakpoint`. Writes <id>.recraft.svg next to the readings file.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { artDirection, loadEnv, pipelineFile, runPath } from "./prism-paths.mjs";

await loadEnv();
if (!process.env.RECRAFT_API_KEY) {
  console.error("Missing RECRAFT_API_KEY.");
  process.exit(2);
}

const config = JSON.parse(await readFile(pipelineFile("models.config.json"), "utf8")).vector.optional.recraft;
const tokens = JSON.parse(await readFile(resolve(artDirection, "tokens.json"), "utf8"));
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const palette = ["sky", "violet", "mint", "solar", "ember", "flare"].map((name) => ({ rgb: rgb(tokens.palette[name].hex) }));

const [readingsArg, ...ids] = process.argv.slice(2);
const readingsPath = runPath(readingsArg);
const readings = JSON.parse(await readFile(readingsPath, "utf8"));
const picks = readings.filter((reading) => ids.includes(reading.id) && reading.recraft_prompt);

async function generate(reading, size) {
  const res = await fetch("https://external.api.recraft.ai/v1/images/generations/vector", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RECRAFT_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: reading.recraft_prompt,
      model: config.model,
      size,
      controls: { colors: palette, background_color: { rgb: rgb(tokens.palette.mist.hex) } },
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const url = (await res.json()).data[0].url;
  return (await fetch(url)).text();
}

await Promise.all(
  picks.map(async (reading) => {
    const sizes = reading.breakpoint === "mobile" ? ["2:3", "9:16"] : ["3:2", "16:9"];
    let svg;
    for (const size of sizes) {
      try {
        svg = await generate(reading, size);
        break;
      } catch (error) {
        if (size === sizes.at(-1)) throw error;
      }
    }
    const out = resolve(dirname(readingsPath), `${reading.id}.recraft.svg`);
    await writeFile(out, svg);
    console.log(`${reading.id}: ${out}`);
  }),
);
