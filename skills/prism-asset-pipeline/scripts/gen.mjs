#!/usr/bin/env node
// Raster light (fallback only, never geometry). Run: node scripts/gen.mjs --reading <run>/readings.json [id...]
// Phase B light-mode edits of the live site's assets: PRISM_SITE_DIR=<prismteam checkout> node scripts/gen.mjs [--gpt|--from-copy] [id...]
// Reads GEMINI_API_KEY and OPENAI_API_KEY (see prism-paths.mjs for .env lookup). Does not write a style paragraph.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { artDirection, loadEnv, pipelineFile, runPath } from "./prism-paths.mjs";

const siteDir = process.env.PRISM_SITE_DIR ? resolve(process.env.PRISM_SITE_DIR) : null;
const assets = siteDir && resolve(siteDir, "public/assets");
const styleRef = resolve(artDirection, "references/color-concept-04.png");
const outDir = runPath("phase-b");

const jobs = [
  {
    id: "home.hero-glow",
    role: "page break",
    source: "home/hero-glow-desktop.svg",
    copy: "Redesign work for the age of AI agents.",
    fromCopy:
      "For the sentence \"Redesign work for the age of AI agents.\" This is a claim that opens the page. Make one field of light that lets that claim land. One color only, flare #FBE645, pale and high-key, dissolved into ground #F8F7F7. Edges disappear. No gloss, no hard shape. Do not add a second color. No people, tools, icons, or letters.",
    prompt:
      "The headline is \"Redesign work for the age of AI agents.\" This light sits behind that sentence and opens the page. Keep the two beams and the gap already in the image. Change the black ground to #F8F7F7. Do not add colors that are not already in the beams. Do not draw tools, people, handoffs, or letters.",
  },
  {
    id: "home.problem-underline",
    role: "emphasis",
    source: "home/problem-underline-desktop.svg",
    copy: "Manual handoffs. Approval chasing. Status checking. Context transfer.",
    fromCopy:
      "For the evidence lines \"Manual handoffs. Approval chasing. Status checking. Context transfer.\" The claim is that these are the old model, not transformation. Make one small soft mark that could sit under a single line, so the line lands. One color only, sky #9DDEFD, pale and high-key, dissolved into ground #F8F7F7. No hard edge, no gloss. Do not draw the four activities. No other colors. No letters, icons, or people.",
    prompt:
      "These words are the evidence: \"Manual handoffs. Approval chasing. Status checking. Context transfer.\" A single short glow sits under a line like those, so the line lands. Keep it one color, the color already in the mark. Change the black ground to #F8F7F7. Do not illustrate the four activities. Do not add other colors. Do not draw letters.",
  },
  {
    id: "home.bottleneck-rays",
    role: "comprehension",
    source: "home/bottleneck-ray-top-left-desktop.png",
    copy: "Your people are not the bottleneck. Your workflow is.",
    fromCopy:
      "For the sentence \"Your people are not the bottleneck. Your workflow is.\" Show the constraint: light forced toward one point, because the workflow is what squeezes. One color only, sky #9DDEFD, pale and high-key, edges dissolved into ground #F8F7F7. No gloss, no hard silhouette. Do not draw people. No other colors. No letters or icons.",
    tone: "art-direction/references/color-concept-04.png",
    prompt:
      "The sentence is \"Your people are not the bottleneck. Your workflow is.\" The light narrows to a point because the workflow is the constraint. Keep that pinch and the gaps. The second image is tonality only: match how pale, soft, and high-key those washes are. Color sits back into the ground and the edges disappear. Do not copy that image's layout, logo, words, stripes, or its set of colors. This ray stays the one blue already in the first image, washed back to that softness. Ground is #F8F7F7. No gloss. No hard edge. No extra colors. No letters.",
  },
];

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

async function rasterize(svgPath, pngPath) {
  if (svgPath.endsWith(".png")) {
    const png = await readFile(svgPath);
    await writeFile(pngPath, png);
    return png;
  }
  let svg = await readFile(svgPath, "utf8");
  svg = svg.replace('width="100%"', 'width="1200"').replace('height="100%"', 'height="800"');
  const playwright = createRequire(resolve(siteDir, "package.json")).resolve("playwright");
  const { chromium } = await import(pathToFileURL(playwright).href);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.setContent(
    `<!doctype html><body style="margin:0;background:#161616">${svg}</body>`,
    { waitUntil: "load" },
  );
  const png = await page.locator("svg").screenshot({ type: "png", timeout: 15000 });
  await browser.close();
  await writeFile(pngPath, png);
  return png;
}

async function gemini(sourcePng, stylePng, prompt) {
  const model = "gemini-3-pro-image";
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/png", data: b64(sourcePng) } },
          { inline_data: { mime_type: "image/png", data: b64(stylePng) } },
        ],
      },
    ],
    generationConfig: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  const image = parts.find((part) => part.inlineData || part.inline_data);
  const data = image?.inlineData?.data || image?.inline_data?.data;
  if (!data) throw new Error("Gemini returned no image");
  return Buffer.from(data, "base64");
}

async function openaiGenerate(prompt, size = "1536x1024") {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-2.5-sunburst",
      prompt,
      size,
      quality: "high",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const data = json.data?.[0]?.b64_json;
  if (!data) throw new Error("OpenAI returned no image");
  return Buffer.from(data, "base64");
}

async function openai(sourcePng, prompt, tonePng) {
  const form = new FormData();
  form.set("model", "gpt-image-2.5-sunburst");
  form.set("prompt", prompt);
  form.set("quality", "high");
  form.append("image[]", new Blob([sourcePng], { type: "image/png" }), "source.png");
  if (tonePng) form.append("image[]", new Blob([tonePng], { type: "image/png" }), "tone.png");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const data = json.data?.[0]?.b64_json;
  if (!data) throw new Error("OpenAI returned no image");
  return Buffer.from(data, "base64");
}

await loadEnv();

const args = process.argv.slice(2);
const readingIndex = args.indexOf("--reading");
if (readingIndex !== -1) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in .env. No images were generated.");
    process.exit(2);
  }
  const readingPath = runPath(args[readingIndex + 1]);
  const picks = new Set(args.filter((arg, i) => !arg.startsWith("--") && i !== readingIndex + 1));
  const readings = JSON.parse(await readFile(readingPath, "utf8"));
  await Promise.all(
    readings
      .filter((reading) => picks.size === 0 || picks.has(reading.id))
      .map(async (reading) => {
        const png = await openaiGenerate(reading.prompt, reading.size);
        await writeFile(resolve(dirname(readingPath), `${reading.id}.png`), png);
        console.log(`${reading.id}: from reading`);
      }),
  );
  process.exit(0);
}
const gptOnly = args.includes("--gpt");
const fromCopy = args.includes("--from-copy");
const only = new Set(args.filter((arg) => !arg.startsWith("--")));
const needed = gptOnly ? ["OPENAI_API_KEY"] : ["GEMINI_API_KEY", "OPENAI_API_KEY"];
const missing = needed.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing ${missing.join(" and ")} in .env. No images were generated.`);
  process.exit(2);
}
if (!fromCopy && !siteDir) {
  console.error("Set PRISM_SITE_DIR to the prismteam site checkout; edits read its public/assets. No images were generated.");
  process.exit(2);
}

const runDir = fromCopy ? runPath("phase-b-from-copy") : gptOnly ? runPath("phase-b-copy") : outDir;
await mkdir(runDir, { recursive: true });
await writeFile(
  resolve(runDir, "prompts.json"),
  JSON.stringify(jobs.map(({ id, copy, prompt, fromCopy: developed }) => ({ id, copy, prompt: fromCopy ? developed : prompt })), null, 2),
);
if (fromCopy) {
  for (const job of jobs.filter((job) => only.size === 0 || only.has(job.id))) {
    const png = await openaiGenerate(job.fromCopy);
    await writeFile(resolve(runDir, `${job.id}.png`), png);
    console.log(`${job.id}: from-copy`);
  }
} else {
  const stylePng = gptOnly ? null : await readFile(styleRef);
  for (const job of jobs.filter((job) => only.size === 0 || only.has(job.id))) {
    const sourcePath = resolve(assets, job.source);
    const sourcePng = await rasterize(sourcePath, resolve(runDir, `${job.id}.source.png`));
    if (!gptOnly) {
      const gem = await gemini(sourcePng, stylePng, job.prompt);
      await writeFile(resolve(runDir, `${job.id}.gemini.png`), gem);
      console.log(`${job.id}: gemini`);
    }
    const tonePng = job.tone ? await readFile(pipelineFile(job.tone)) : null;
    const oa = await openai(sourcePng, job.prompt, tonePng);
    await writeFile(resolve(runDir, `${job.id}.openai.png`), oa);
    console.log(`${job.id}: openai`);
  }
}
