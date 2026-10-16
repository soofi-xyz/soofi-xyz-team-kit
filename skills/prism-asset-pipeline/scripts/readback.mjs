#!/usr/bin/env node
// Blind read-back. Run: node scripts/readback.mjs <readings.json> [id...]
// A vision model describes each image without the copy, then scores it against the visual-alone test.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { loadEnv, runPath } from "./prism-paths.mjs";

const model = "gpt-5.5";

await loadEnv();
if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY in .env.");
  process.exit(2);
}

async function ask(content) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, reasoning: { effort: "low" }, input: [{ role: "user", content }] }),
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

const [readingsArg, ...ids] = process.argv.slice(2);
const readingsPath = runPath(readingsArg);
const dir = dirname(readingsPath);
const readings = JSON.parse(await readFile(readingsPath, "utf8"));
const picks = readings.filter((reading) => ids.length === 0 || ids.includes(reading.id));

const results = await Promise.all(
  picks.map(async (reading) => {
    const png = await readFile(resolve(dir, `${reading.id}.png`));
    const blind = await ask([
      {
        type: "input_text",
        text: "This abstract image will sit behind a headline on a website. You have not seen the headline. In one sentence, say what idea or story the image communicates. Then say which parts of the image carry that idea. Be plain and literal. Do not flatter.",
      },
      { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` },
    ]);
    const verdict = await ask([
      {
        type: "input_text",
        text: `Intended idea: "${reading.visual_alone_test}"\nHeadline: "${reading.copy}"\nA viewer who had not seen the headline described the image as:\n"""${blind}"""\n\nReturn JSON only: {"score": 1-5 for how well the viewer's reading matches the intended idea, "gap": "what the viewer missed or misread, in one sentence", "fix": "one concrete change to the image that would close the gap"}`,
      },
    ]);
    const parsed = JSON.parse(verdict.slice(verdict.indexOf("{"), verdict.lastIndexOf("}") + 1));
    const pairedText = await ask([
      {
        type: "input_text",
        text: `This abstract image sits behind the headline "${reading.copy}". The image must stay abstract light; icons, arrows, and checkmarks are not allowed. Return JSON only: {"reading": "what each part of the image means next to this headline, one sentence", "paired_score": 1-5 for how clearly the image reinforces this specific headline rather than any headline}`,
      },
      { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` },
    ]);
    const paired = JSON.parse(pairedText.slice(pairedText.indexOf("{"), pairedText.lastIndexOf("}") + 1));
    let bindings = [];
    if (reading.bindings?.length) {
      const list = reading.bindings.map((binding, index) => `${index + 1}. ${binding.how}`).join("\n");
      const checkText = await ask([
        {
          type: "input_text",
          text: `Look at this abstract image. A first-time viewer described it as:\n"""${blind}"""\n\nFor each statement, mark it seen only if that viewer's description shows they noticed it, or it is so dominant nobody could miss it. Something technically present but read as something else is not seen.\n${list}\n\nReturn JSON only: {"checks": [{"n": 1, "seen": true or false, "why": "one short sentence"}]}`,
        },
        { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}` },
      ]);
      const checks = JSON.parse(checkText.slice(checkText.indexOf("{"), checkText.lastIndexOf("}") + 1)).checks;
      bindings = reading.bindings.map((binding, index) => ({ word: binding.word, ...checks.find((check) => check.n === index + 1) }));
    }
    const missed = bindings.filter((binding) => !binding.seen).map((binding) => binding.word);
    console.log(`${reading.id}: blind ${parsed.score}/5, with headline ${paired.paired_score}/5, missed [${missed.join(", ")}] — ${parsed.gap}`);
    return { id: reading.id, intended: reading.visual_alone_test, blind, ...parsed, paired: paired.reading, paired_score: paired.paired_score, bindings, missed };
  }),
);

const outPath = resolve(dir, "readback.json");
const previous = JSON.parse(await readFile(outPath, "utf8").catch(() => "[]"));
const merged = [...previous.filter((row) => !results.some((result) => result.id === row.id)), ...results];
await writeFile(outPath, JSON.stringify(merged, null, 2));
