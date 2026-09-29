#!/usr/bin/env node
// Ideation. Run: node scripts/ideate.mjs --copy "<headline>" [--body "..."] [--evidence "a|b|c"] [--pattern focus] [--id hero] [--run <page>/<stamp>] [--top 1]
//   or:          node scripts/ideate.mjs <section.json> [--run <dir>] [--top 1]
//   critic only: node scripts/ideate.mjs --ideas <file.ideas.json>   (candidates written elsewhere; adds critiques to the file)
// Relative paths resolve against the runs root (see prism-paths.mjs), not the cwd.
// Claude reads the section and the art direction and writes readings and eight ideas. A separate critic reads each idea
// as plain visual description, without the copy, and says what it communicates. Claude then picks, and writes desktop and
// mobile prompts into the run's readings.json for `node scripts/gen.mjs --reading`.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { artDirection, loadEnv, pipelineFile, runPath, skillFile } from "./prism-paths.mjs";

await loadEnv();
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const ideasPath = flag("ideas", null);

for (const key of ideasPath ? ["OPENAI_API_KEY"] : ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"]) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in .env.`);
    process.exit(2);
  }
}

const config = JSON.parse(await readFile(pipelineFile("models.config.json"), "utf8")).ideate;
const parseJson = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

if (ideasPath) {
  const file = runPath(ideasPath);
  const written = JSON.parse(await readFile(file, "utf8"));
  written.critic = config.critic;
  written.critiques = await critique(written.section, written.candidates);
  await writeFile(file, JSON.stringify(written, null, 2));
  process.exit(0);
}

const sectionPath = args[0] && !args[0].startsWith("--") ? args[0] : null;
const section = sectionPath
  ? JSON.parse(await readFile(runPath(sectionPath), "utf8"))
  : {
      id: flag("id", "section"),
      assertion: flag("copy", ""),
      body: flag("body", ""),
      evidence: (flag("evidence", "") || "").split("|").filter(Boolean),
      pattern_type: flag("pattern", ""),
    };
if (!section.assertion) {
  console.error('Give a section file or --copy "<headline>".');
  process.exit(2);
}
const runDir = runPath(flag("run", "ideate"));
const top = Number(flag("top", "1"));
await mkdir(runDir, { recursive: true });

async function resolveModel() {
  if (config.model !== "latest-opus") return config.model;
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
  });
  if (!res.ok) throw new Error(`models ${res.status} ${await res.text()}`);
  const opus = (await res.json()).data.find((model) => model.id.includes("opus"));
  if (!opus) throw new Error("No Opus model listed; set ideate.model in models.config.json.");
  return opus.id;
}
const model = await resolveModel();
console.log(`author: ${model}, critic: ${config.critic}`);

async function claude(system, user) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 32000,
      thinking: { type: "enabled", budget_tokens: config.thinking_budget },
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}

async function critic(text) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.critic, reasoning: { effort: "medium" }, input: [{ role: "user", content: text }] }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.output
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content)
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("");
}

const read = (path) => readFile(path, "utf8");
const art = (name) => read(resolve(artDirection, name));
const system = [
  "You are the Prism visual agent. You decide what a graphic should show so that it makes one section's claim easier to understand. Follow these documents exactly.",
  `# prompt-writer skill\n${await read(skillFile("prism-prompt-writer"))}`,
  `# art-direction.md\n${await art("art-direction.md")}`,
  `# prismatic-symbolism.md\n${await art("prismatic-symbolism.md")}`,
  `# tokens.json\n${await art("tokens.json")}`,
  `# lexicon.json\n${await art("lexicon.json")}`,
].join("\n\n");

const readingsPath = resolve(runDir, "readings.json");
const readings = JSON.parse(await readFile(readingsPath, "utf8").catch(() => "[]"));
const used = [...new Set(["a line opening into a ray", ...readings.map((reading) => reading.structure).filter(Boolean)])];

const ideas = parseJson(
  await claude(
    system,
    `Section:\n${JSON.stringify(section, null, 2)}\n\nStructures already used (precedents; baseline to beat, never the starting point): ${used.join("; ")}\n\n` +
      `Do steps 1 and 2 of the prompt-writer skill. For each candidate, write "image" as what a viewer literally sees, in visual terms only: shapes, positions, light, color, change across the frame. No meaning words, no metaphors, nothing a critic could use to guess the copy.\n\n` +
      `Return JSON only: {"claim": "", "pattern_type": "", "claim_shape": "", "contrast_property": "", "readings": ["", "", ""], ` +
      `"candidates": [{"n": 1, "structure": "", "reading": "which of the three readings", "layers": "light-led|geometry-led|both", "composition_type": "", "prism_meaning": "", "image": "", "intended": "what it should communicate", "precedent": false}]}`,
  ),
);

const critiques = await critique(section, ideas.candidates);

async function critique(section, candidates) {
  return Promise.all(
  candidates.map(async (candidate) => {
    const blind = await critic(
      `An abstract image will sit on a website. You have not seen any of the words on the page. The image shows:\n"""${candidate.image}"""\n\nIn one sentence, say what idea it communicates to a first-time viewer. Then name its most likely misreading. Be plain and literal. Do not flatter.`,
    );
    const verdict = parseJson(
      await critic(
        `Headline: "${section.assertion}"\nIntended idea: "${candidate.intended}"\nA viewer who had not seen the headline read the image as:\n"""${blind}"""\n\n` +
          `Return JSON only: {"blind_match": 1-5 for how closely the viewer's reading matches the intended idea, "headline_fit": 1-5 for how much the image makes this specific headline easier to understand, "generic": true if it could sit under almost any headline, "gap": "one sentence"}`,
      ),
    );
    console.log(`${candidate.n}. ${candidate.structure}: blind ${verdict.blind_match}/5, headline ${verdict.headline_fit}/5${verdict.generic ? ", generic" : ""}`);
    return { n: candidate.n, blind, ...verdict };
  }),
  );
}

const decision = parseJson(
  await claude(
    system,
    `Section:\n${JSON.stringify(section, null, 2)}\n\nYour candidates:\n${JSON.stringify(ideas.candidates, null, 2)}\n\nBlind critic results:\n${JSON.stringify(critiques, null, 2)}\n\n` +
      `Pick the ${top} strongest by blind_match and headline_fit; drop generic ones; a precedent wins only if clearly higher. Say why the pick beats the runner-up. ` +
      `For each pick, do steps 3 and 4 of the prompt-writer skill for desktop (1536x1024) and mobile (1024x1536), recomposing mobile rather than cropping. Add bindings only where the skill says they matter.\n\n` +
      `Return JSON only: {"picks": [{"n": 1, "why": ""}], "runner_up": {"n": 0, "why_not": ""}, "readings": [{"n": 1, "breakpoint": "desktop|mobile", "size": "", "structure": "", "concept": "", "claim_shape": "", "pattern_type": "", "visual_alone_test": "", "composition": "", "color": {"pair": ""}, "bindings": [{"word": "", "how": ""}], "prompt": ""}]}`,
  ),
);

const entries = decision.readings.map((reading) => ({
  id: `${section.id}.idea${reading.n}.${reading.breakpoint}`,
  copy: section.assertion,
  ...reading,
}));
const ids = new Set(entries.map((entry) => entry.id));
await writeFile(readingsPath, JSON.stringify([...readings.filter((reading) => !ids.has(reading.id)), ...entries], null, 2));
await writeFile(
  resolve(runDir, `${section.id}.ideas.json`),
  JSON.stringify({ model, critic: config.critic, section, ...ideas, critiques, picks: decision.picks, runner_up: decision.runner_up }, null, 2),
);

for (const pick of decision.picks) console.log(`pick ${pick.n}: ${pick.why}`);
console.log(`runner-up ${decision.runner_up.n}: ${decision.runner_up.why_not}`);
console.log(`next: node ${resolve(import.meta.dirname, "gen.mjs")} --reading ${readingsPath} ${[...ids].join(" ")}`);
