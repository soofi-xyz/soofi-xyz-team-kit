#!/usr/bin/env node
// Agent memory probe: records which fields each tool's hooks receive, so we can
// tell whether a hook knows that Wingull is the active agent. It never records
// message text, tool input or output: only field names, types and agent-related
// values. Emails are masked to their domain.
//
//   node scripts/agent-memory-probe.mjs install <cursor|copilot|codex>
//   node scripts/agent-memory-probe.mjs uninstall <cursor|copilot|codex>
//   node scripts/agent-memory-probe.mjs report            # paste this output back
//   node scripts/agent-memory-probe.mjs queue-report <dir> # summarize an agent-memory queue
//   node scripts/agent-memory-probe.mjs record <source>   # called by the hooks

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = resolve(dirname(SCRIPT), "..");
const LOG_DIR = join(homedir(), ".agent-memory-probe");
const MARK = "agent-memory-probe.mjs";
const AGENT_KEY = /agent|subagent|model|version|email|session|conversation|generation|hook_event|event_name|tool_name|toolname|permission_mode|source|reason|stop|transcript/i;
const CONTENT_KEY = /^(prompt|text|response|last_assistant_message|tool_input|tool_response|tool_output|toolargs|toolresult|summary|task|attachments|error|message|content)$/i;

const command = (source) => `node "${SCRIPT}" record ${source}`;

function shape(value, depth = 0) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    if (depth >= 1) return `object{${Object.keys(value).sort().join(",")}}`;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key], depth + 1)]));
  }
  if (typeof value === "string") return `string(${value.length})`;
  return typeof value;
}

function safeValue(key, value) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return undefined;
  if (CONTENT_KEY.test(key) || !AGENT_KEY.test(key)) return undefined;
  const text = String(value);
  if (/email/i.test(key)) return text.replace(/^[^@]*/, "***");
  if (/transcript/i.test(key)) return `${text.split(/[\\/]/).pop()} (exists: ${existsSync(text)})`;
  return text.slice(0, 120);
}

function record(source) {
  let input = "";
  try {
    input = readFileSync(0, "utf8");
  } catch {
    input = "";
  }
  let payload = {};
  try {
    payload = JSON.parse(input || "{}");
  } catch {
    payload = { unparsed: input.length };
  }
  const values = {};
  for (const [key, value] of Object.entries(payload)) {
    const safe = safeValue(key, value);
    if (safe !== undefined) values[key] = safe;
  }
  // The subagent requested through a Task/Agent tool call, without its prompt.
  const subagent = payload.tool_input?.subagent_type ?? payload.toolArgs?.agent_type ?? payload.toolArgs?.subagent_type;
  if (typeof subagent === "string") values["tool_input.subagent_type"] = subagent;
  const env = Object.keys(process.env).filter((name) => /^(CURSOR_|COPILOT_|CODEX_|PLUGIN_|CLAUDE_)/.test(name)).sort();
  mkdirSync(LOG_DIR, { recursive: true, mode: 0o700 });
  appendFileSync(join(LOG_DIR, `${source.split("-")[0]}.jsonl`), `${JSON.stringify({ source, at: new Date().toISOString(), cwd: process.cwd(), values, shape: shape(payload), env })}\n`);
  // Cursor expects JSON on stdout for some events; an empty object changes nothing.
  if (source.startsWith("cursor")) process.stdout.write("{}");
}

function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path) && !existsSync(`${path}.probe-backup`)) copyFileSync(path, `${path}.probe-backup`);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

const CURSOR_EVENTS = ["sessionStart", "beforeSubmitPrompt", "preToolUse", "postToolUse", "subagentStart", "subagentStop", "afterAgentResponse", "stop", "sessionEnd"];
const COPILOT_EVENTS = ["sessionStart", "userPromptSubmitted", "preToolUse", "postToolUse", "subagentStart", "subagentStop", "agentStop", "sessionEnd"];
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"];

function install(client) {
  if (client === "cursor") {
    const path = join(homedir(), ".cursor", "hooks.json");
    const config = readJson(path, { version: 1, hooks: {} });
    config.version ??= 1;
    config.hooks ??= {};
    for (const event of CURSOR_EVENTS) {
      config.hooks[event] = (config.hooks[event] ?? []).filter((hook) => !String(hook.command).includes(MARK));
      config.hooks[event].push({ command: command(`cursor-${event}`) });
    }
    writeJson(path, config);
    console.log(`Added probe hooks to ${path}. Restart Cursor, then follow the Cursor steps.`);
  } else if (client === "copilot") {
    // 1) User-level hooks: does any root payload name the agent?
    const userHooks = { version: 1, hooks: Object.fromEntries(COPILOT_EVENTS.map((event) => [event, [{ type: "command", command: command(`copilot-user-${event}`) }]])) };
    writeJson(join(homedir(), ".copilot", "hooks", "agent-memory-probe.json"), userHooks);
    // 2) Agent-scoped hooks in a plugin agent: a renamed local copy of this plugin
    //    whose wingull agent declares hooks in its frontmatter.
    const copy = join(tmpdir(), "soofi-xyz-team-kit-probe");
    rmSync(copy, { recursive: true, force: true });
    cpSync(ROOT, copy, { recursive: true, filter: (path) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(path) });
    const manifest = readJson(join(copy, "plugin.json"));
    manifest.name = "soofi-xyz-team-kit-probe";
    writeFileSync(join(copy, "plugin.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const agentPath = join(copy, "agents-copilot", "wingull.agent.md");
    const agent = readFileSync(agentPath, "utf8");
    const scoped = ["hooks:", ...COPILOT_EVENTS.flatMap((event) => [`  ${event}:`, "    - type: command", `      command: ${JSON.stringify(command(`copilot-agent-${event}`))}`])].join("\n");
    writeFileSync(agentPath, agent.replace(/^---\n/, `---\n${scoped}\n`));
    console.log(`Wrote ~/.copilot/hooks/agent-memory-probe.json and a probe plugin at ${copy}.`);
    console.log(`Install it with: copilot plugin install ${copy}`);
  } else if (client === "codex") {
    const path = join(homedir(), ".codex", "hooks.json");
    const config = readJson(path, { hooks: {} });
    config.hooks ??= {};
    for (const event of CODEX_EVENTS) {
      config.hooks[event] = (config.hooks[event] ?? []).filter((group) => !JSON.stringify(group).includes(MARK));
      config.hooks[event].push({ hooks: [{ type: "command", command: command(`codex-${event}`), timeout: 10 }] });
    }
    writeJson(path, config);
    console.log(`Added probe hooks to ${path}. In Codex, open /hooks and trust them.`);
  } else {
    throw new Error("client must be cursor, copilot or codex");
  }
}

function uninstall(client) {
  if (client === "cursor" || client === "codex") {
    const path = join(homedir(), client === "cursor" ? ".cursor" : ".codex", "hooks.json");
    const config = readJson(path, undefined);
    if (config?.hooks) {
      for (const [event, entries] of Object.entries(config.hooks)) {
        config.hooks[event] = entries.filter((entry) => !JSON.stringify(entry).includes(MARK));
        if (config.hooks[event].length === 0) delete config.hooks[event];
      }
      writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
    }
    console.log(`Removed probe hooks from ${path}.`);
  } else if (client === "copilot") {
    rmSync(join(homedir(), ".copilot", "hooks", "agent-memory-probe.json"), { force: true });
    rmSync(join(tmpdir(), "soofi-xyz-team-kit-probe"), { recursive: true, force: true });
    console.log("Removed ~/.copilot/hooks/agent-memory-probe.json. Also run: copilot plugin uninstall soofi-xyz-team-kit-probe");
  }
}

function report() {
  if (!existsSync(LOG_DIR)) return console.log("No probe logs yet.");
  for (const file of readdirSync(LOG_DIR).filter((name) => name.endsWith(".jsonl")).sort()) {
    console.log(`## ${file}`);
    const seen = new Map();
    for (const line of readFileSync(join(LOG_DIR, file), "utf8").split("\n").filter(Boolean)) {
      const entry = JSON.parse(line);
      const key = `${entry.source} ${JSON.stringify(entry.values)}`;
      if (!seen.has(key)) seen.set(key, { ...entry, count: 0 });
      seen.get(key).count += 1;
    }
    for (const entry of seen.values()) {
      console.log(`- ${entry.source} x${entry.count} values=${JSON.stringify(entry.values)}`);
      console.log(`  fields=${JSON.stringify(entry.shape)}`);
    }
    const last = [...seen.values()].pop();
    if (last) console.log(`  env=${last.env.join(",")}`);
  }
}

function queueReport(dir) {
  const files = existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).sort() : [];
  console.log(`${files.length} queued payload(s) in ${dir}`);
  for (const file of files) {
    const vertices = JSON.parse(readFileSync(join(dir, file), "utf8"))["@value"].vertices;
    const prop = (v, k) => v["@value"].properties[k]?.[0]["@value"].value;
    const thread = vertices.find((v) => v["@value"].label === "agent_thread");
    const prompt = vertices.find((v) => v["@value"].label === "agent_prompt_version");
    const email = vertices.find((v) => v["@value"].label === "email");
    const messages = vertices.filter((v) => v["@value"].label === "agent_message").map((v) => {
      const redactions = prop(v, "redaction_count")?.["@value"] ?? 0;
      return `${prop(v, "message_kind")}${prop(v, "tool_name") ? `(${prop(v, "tool_name")})` : ""} ${prop(v, "occurred_at")} len=${prop(v, "content_length")?.["@value"]} redactions=${redactions} "${String(prop(v, "content")).slice(0, 60).replace(/\s+/g, " ")}"`;
    });
    console.log(`- ${prop(thread, "thread_identifier")} prompt=${prop(prompt, "plugin_version")}#${String(prop(prompt, "prompt_sha256")).slice(0, 12)} person=${email ? "yes" : "no"}`);
    for (const message of messages) console.log(`    ${message}`);
  }
}

const [action, arg] = process.argv.slice(2);
if (action === "record") record(arg ?? "unknown");
else if (action === "install") install(arg);
else if (action === "uninstall") uninstall(arg);
else if (action === "report") report();
else if (action === "queue-report") queueReport(arg ?? join(homedir(), ".config/prism/agent-memory/queue"));
else console.log(readFileSync(SCRIPT, "utf8").split("\n").slice(1, 11).join("\n"));
