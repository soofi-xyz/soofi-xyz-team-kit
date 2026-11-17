#!/usr/bin/env node
// Packages kit agents (agents/*.md) as Enact agent directories under enact/<agent>/ and writes
// enact/inventory.json. Enact's contract: prismteam-ai/enact docs/agent-contract.md; its schema is
// copied to enact/schema/ by scripts/sync-enact-schema.sh.
//
//   node scripts/sync-enact-agents.mjs [sync|check] [--contract current|next]
//
// --contract (default: enact/config.json contract, else "current") picks the Enact contract:
// "current" is prismteam-ai/enact main (enact/schema/); "next" adds the open pieces' manifest
// fields (library_skills, mcp_servers, secrets, browser) and writes the skill library to
// enact/library/ (enact/schema/next/, scripts/sync-enact-schema.sh next). Both write bundle-ready
// packed files (gitignored): enact/dist/agents/<agent>.json and enact/dist/skills/<skill>.json,
// each the exact PUT body {manifest, files} as canonical JSON, the source file of Build's
// enact/agent and enact/skill configuration kinds.
//
// sync (default) rewrites the generated files; check exits 1 when they differ from what is
// committed. Inputs: enact/config.json (stays-local set, waves, model map, defaults, limits) and
// enact/overrides/<agent>.json (manifest fields, declared requires_mcp, needs_secrets, extra
// "Running on Enact" lines). Output is deterministic: sorted keys, sorted files, no timestamps.
//
// Node standard library only.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const enactDir = path.join(root, "enact");
const RESERVED = new Set(["config.json", "dist", "inventory.json", "library", "overrides", "schema", "README.md"]);
// Reserved top-level directories the generator itself writes.
const GENERATED_DIRS = new Set(["dist", "library"]);
const SKILL_REF = /(?:^|[^A-Za-z0-9_-])skills\/([a-z0-9][a-z0-9-]*)\//g;
const SIBLING_REF = /(?:^|[(\s`"'])\.\.\/([a-z0-9][a-z0-9-]*)\//g;
const FILE_PATH =
  /^(instructions\.md|tools\/[a-z][a-z0-9-]{0,62}\.ts|subagents\/[a-z][a-z0-9-]{0,62}\.md|skills\/[a-z][a-z0-9-]{0,62}\/([A-Za-z0-9_][A-Za-z0-9._-]{0,99}\/){0,8}[A-Za-z0-9_][A-Za-z0-9._-]{0,99})$/;

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const normalize = (text) => text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");

// Stable JSON: keys sorted at every level, two-space indent, trailing newline.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, sortKeys(value[k])]),
    );
  }
  return value;
}
const stableJson = (value) => JSON.stringify(sortKeys(value), null, 2) + "\n";

function parseFrontmatter(text, where) {
  if (!text.startsWith("---\n")) throw new Error(`${where}: missing YAML frontmatter`);
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) throw new Error(`${where}: malformed YAML frontmatter`);
  const raw = text.slice(4, end);
  const fields = {};
  for (const line of raw.split("\n")) {
    const m = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1).replace(/''/g, "'");
    fields[m[1]] = value;
  }
  return { fields, raw, body: text.slice(end + "\n---\n".length) };
}

function mapModel(kitModel, config) {
  if (!kitModel) return config.default_model;
  const map = config.model_map;
  if (map[kitModel]) return map[kitModel];
  for (const [pattern, family] of Object.entries(map)) {
    if (!pattern.includes("*")) continue;
    const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    if (re.test(kitModel)) return family;
  }
  return config.default_model;
}

function listSkillFiles(name) {
  const rel = `skills/${name}`;
  let files;
  try {
    files = execFileSync("git", ["-C", root, "ls-files", "-z", "--", rel], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  } catch {
    files = [];
  }
  if (files.length === 0) {
    const walk = (dir) =>
      readdirSync(path.join(root, dir)).flatMap((entry) => {
        const p = `${dir}/${entry}`;
        return statSync(path.join(root, p)).isDirectory() ? walk(p) : [p];
      });
    files = walk(rel).filter((p) => !p.split("/").includes("node_modules") && !p.endsWith(".DS_Store"));
  }
  return files.filter((p) => existsSync(path.join(root, p))).sort();
}

function referencedSkills(text, allowSibling, known) {
  const found = new Set();
  for (const m of text.matchAll(SKILL_REF)) if (known.has(m[1])) found.add(m[1]);
  if (allowSibling) for (const m of text.matchAll(SIBLING_REF)) if (known.has(m[1])) found.add(m[1]);
  return found;
}

function stripDisableModelInvocation(text) {
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---\n", 4);
  if (end === -1) return text;
  const head = text
    .slice(4, end)
    .split("\n")
    .filter((line) => !/^disable-model-invocation\s*:/.test(line))
    .join("\n");
  return `---\n${head}\n---\n${text.slice(end + "\n---\n".length)}`;
}

function scanFlags(text, file, patterns) {
  const hits = {};
  const lines = text.split("\n");
  for (const [kind, re] of patterns) {
    lines.forEach((line, i) => {
      if (re.test(line)) (hits[kind] ??= []).push(`${file}:${i + 1}`);
    });
  }
  return hits;
}

function scanSecrets(text, re) {
  const names = new Set();
  for (const m of text.matchAll(new RegExp(re.source, "g"))) names.add(m[0]);
  return names;
}

function mergeFlags(into, from) {
  for (const [k, v] of Object.entries(from)) (into[k] ??= []).push(...v);
}

function describeRepositories(manifest) {
  const lines = [];
  const repos = manifest.repositories ?? [];
  if (repos.length === 0 && !manifest.run_repositories) {
    lines.push(
      "- **Repositories.** This agent is given no repositories. Git can clone public repositories read-only over HTTPS; you cannot push, and `gh` is not signed in. Put changes you would make in your result as a patch or a proposal.",
    );
    return lines;
  }
  lines.push(
    "- **Repositories.** Git over HTTPS is signed in to exactly the repositories of this run (`git clone https://github.com/<owner>/<repo>.git`). A pre-push hook refuses the default branch: push a branch and open the pull request with the `open_pull_request` tool when the repository allows it. Nothing lets you merge, and `gh` is not signed in: use git and the `open_pull_request` tool.",
  );
  for (const r of repos) {
    lines.push(`  - \`${r.name}\`: contents ${r.permissions.contents}, pull requests ${r.permissions.pull_requests}.`);
  }
  if (manifest.run_repositories) {
    const p = manifest.run_repositories.permissions;
    lines.push(
      `  - Each run may name up to ${manifest.run_repositories.max} more repositories, with contents ${p.contents} and pull requests ${p.pull_requests}.`,
    );
  }
  return lines;
}

function appendix(manifest, skills, info, override) {
  const lines = [
    "",
    "# Running on Enact",
    "",
    "You run as an Enact agent in an isolated sandbox, not in a person's editor. These rules win over anything above that assumes a local machine.",
    "",
    "- **Sandbox.** Each run works in a fresh Linux sandbox with Node.js 22 and git. Newer sandbox images also have `curl`, `jq`, `unzip`, `python3`, `gh` and the `aws` CLI; check with `command -v` before relying on one. Prefer Node.js (`fetch`) for HTTP and fall back to `curl` when it is there. There is no local machine, no person's home directory or checkout, no Cursor or IDE, no AWS profile and no credentials beyond what this section names, so `gh` and `aws` are not signed in. Nothing outside this session's transcript survives the session. Where the text above runs a command or tool the sandbox lacks, or needs a sign-in it does not have, do the equivalent with Node.js or git, or report the step as blocked.",
    "- **Nobody answers during a run.** Where the text above says to ask the person, wait for approval or hand a command to the user, do not act on the step: finish what you can, then end the run with the question, the proposed change or the command, and why it is needed. Never treat silence as approval.",
  ];
  if (skills.length) {
    lines.push(
      `- **Skills.** Paths above such as \`skills/<name>/\` or \`../skills/<name>/…\` refer to the skills installed under \`.claude/skills/<name>/\`: ${skills.map((s) => `\`${s}\``).join(", ")}. Other kit files and skills are not available.`,
    );
  } else {
    lines.push("- **Skills.** No kit skills are installed. Kit files the text above links to are not available.");
  }
  const tools = ["Claude Code's built-in tools"];
  if ((manifest.tools ?? []).includes("browser")) {
    tools.push(
      "the `browser` MCP server (a Chromium through Playwright's MCP tools: `mcp__browser__browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_take_screenshot` and the rest; load them with ToolSearch before the first call)",
    );
  }
  if (info.next && info.mcpServers.length) {
    tools.push(
      `the remote MCP ${info.mcpServers.length === 1 ? "server" : "servers"} ${info.mcpServers.map((s) => `\`${s}\` (\`mcp__${s}__…\`)`).join(", ")}, which Enact registers in every turn (load their tools with ToolSearch before the first call)`,
    );
  }
  lines.push(
    `- **Tools.** You have ${tools.join(" and ")}. No other MCP server is connected unless this run also has Enact's own \`enact\` server. Other kit agents are not installed in the sandbox: where the text above hands work to another agent, and this run has the \`enact\` server with that agent's \`ask_<agent>\` tool (\`mcp__enact__ask_<agent>\`, with \`-\` in the name as \`_\`), you may ask it and use its result; otherwise do that part yourself only when it is inside this request, and otherwise name the agent in your result for the person to run.`,
  );
  if (info.requiresMcp.length) {
    lines.push(
      `- **Required MCP.** This agent's work depends on ${info.requiresMcp.map((s) => `\`${s}\``).join(", ")}. When such a server is not connected, say so in your result and stop rather than reaching the data another way.`,
    );
  }
  if (info.next && info.sandboxLocalhost) {
    lines.push(
      "- **Your own app in the browser.** `http://localhost:<port>/` and `127.0.0.1` in the `browser` tool are this sandbox's own loopback: start the app's dev server in the sandbox, then open it there.",
    );
  }
  if (info.next && info.needsSecrets.length) {
    lines.push(
      `- **Secrets.** ${info.needsSecrets.map((s) => `\`${s}\``).join(", ")} ${info.needsSecrets.length === 1 ? "is an environment variable" : "are environment variables"} in every turn, set by an operator for this agent. Use ${info.needsSecrets.length === 1 ? "it" : "them"} only for the requests this prompt describes; never print, log or return a value.`,
    );
  }
  lines.push(...describeRepositories(manifest));
  const hosts = manifest.hosts ?? [];
  lines.push(
    hosts.length
      ? `- **Network.** Besides what every run needs, you may reach only ${hosts.map((h) => `\`${h}\``).join(", ")}.`
      : "- **Network.** You may reach only what every Enact run needs (the model, GitHub for git) and public hosts Enact allows; expect other requests to fail and report them as blocked.",
  );
  if (info.readonly) {
    lines.push(
      "- **Read-only.** Do not create, edit or delete files in any repository and do not push. Scratch files in your working directory are allowed only to inspect or analyze; your deliverable is the result message.",
    );
  }
  lines.push(
    "- **Result.** Your final message is the run's result, returned to whoever started the run (cut at 128 KiB). Put the complete answer there, in the output format the text above defines; when the run's message asks for a specific format, such as JSON only, reply with exactly that.",
  );
  for (const extra of override.appendix ?? []) lines.push(`- ${extra}`);
  return lines.join("\n") + "\n";
}

// Enact package version for a kit version: 1.<kit minor>.<kit patch>, so every generated version
// sorts above the hand-made slowking 1.0.0 deployed before the generator existed.
function enactVersion(kitVersion) {
  const m = /^(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?$/.exec(kitVersion);
  if (!m) throw new Error(`plugin.json version ${kitVersion} is not a semantic version`);
  return `1.${m[2]}.${m[3]}${m[4] ?? ""}`;
}

// A library skill's version is derived from its content, so a version always names the same
// files: 1.0.0-sha256-<first 16 hex digits of the SHA-256 of {name, description, files}>.
function librarySkillVersion(name, description, files) {
  const digest = createHash("sha256").update(stableJson({ description, files, name })).digest("hex");
  return `1.0.0-sha256-${digest.slice(0, 16)}`;
}

const canonicalJson = (value) => JSON.stringify(sortKeys(value));
const MIB = 1024 * 1024;
const LIBRARY_LIMITS = { skill_bytes: 3 * MIB, skill_files: 500, stored_bytes: 4 * MIB, pinned_bytes: 8 * MIB, pins: 100 };
const LIBRARY_FILE_PATH = /^([A-Za-z0-9_][A-Za-z0-9._-]{0,99}\/){0,8}[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

function build(contract) {
  const config = readJson(path.join(enactDir, "config.json"));
  const plugin = readJson(path.join(root, "plugin.json"));
  const next = contract === "next";
  const patterns = Object.entries(config.flag_patterns).map(([k, v]) => [k, new RegExp(v)]);
  const secretRe = new RegExp(config.secret_pattern);
  const knownSkills = new Set(
    readdirSync(path.join(root, "skills")).filter((d) => existsSync(path.join(root, "skills", d, "SKILL.md"))),
  );
  const stays = new Set(config.stays_local);
  const waveOf = new Map();
  for (const [wave, names] of Object.entries(config.waves)) for (const n of names) waveOf.set(n, wave);
  const builtinMcp = config.mcp_builtin;
  // current: only Enact's own servers exist. next: plus the environment's allowed remote servers.
  const allowedMcp = next ? [...builtinMcp, ...(config.mcp_allow_list ?? [])] : [...builtinMcp];

  const outputs = new Map(); // enact-relative path -> content
  const skillCache = new Map();

  function loadSkill(name) {
    if (skillCache.has(name)) return skillCache.get(name);
    const files = {};
    const omitted = [];
    const flags = {};
    const secrets = new Set();
    let refs = new Set();
    let description = "";
    for (const rel of listSkillFiles(name)) {
      const buf = readFileSync(path.join(root, rel));
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      } catch {
        omitted.push({ path: rel, reason: "not UTF-8 text" });
        continue;
      }
      text = normalize(text);
      if (rel === `skills/${name}/SKILL.md`) {
        text = stripDisableModelInvocation(text);
        refs = referencedSkills(text, true, knownSkills);
        try {
          description = parseFrontmatter(text, rel).fields.description ?? "";
        } catch {
          description = "";
        }
      }
      files[rel] = text;
      mergeFlags(flags, scanFlags(text, rel, patterns));
      for (const s of scanSecrets(text, secretRe)) secrets.add(s);
    }
    refs.delete(name);
    const bytes = Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0);
    const entry = { name, files, omitted, flags, secrets, refs: [...refs].sort(), bytes, description };
    skillCache.set(name, entry);
    return entry;
  }

  // Why a skill cannot be a library skill, or null.
  function libraryProblem(entry) {
    const problems = [];
    if (entry.omitted.length) {
      const shown = entry.omitted.slice(0, 3).map((o) => o.path);
      problems.push(`${entry.omitted.length} non-UTF-8 files (${shown.join(", ")}${entry.omitted.length > 3 ? ", …" : ""})`);
    }
    if (entry.bytes > LIBRARY_LIMITS.skill_bytes) problems.push(`${entry.bytes} bytes of text, over 3 MiB`);
    const count = Object.keys(entry.files).length;
    if (count > LIBRARY_LIMITS.skill_files) problems.push(`${count} files, over ${LIBRARY_LIMITS.skill_files}`);
    const prefix = `skills/${entry.name}/`;
    const bad = Object.keys(entry.files).filter((p) => !LIBRARY_FILE_PATH.test(p.slice(prefix.length)));
    if (bad.length) problems.push(`paths the library refuses: ${bad.join(", ")}`);
    if (!entry.description || entry.description.length > 1024) problems.push("SKILL.md description missing or over 1024 characters");
    return problems.length ? problems.join("; ") : null;
  }

  const inventory = {
    kit_version: plugin.version,
    enact_version: enactVersion(plugin.version),
    contract,
    mcp_allow_list: allowedMcp,
    agents: {},
    skills: {},
  };
  const agentFiles = readdirSync(path.join(root, "agents"))
    .filter((f) => f.endsWith(".md"))
    .sort();

  // Pass 1: read every agent and resolve its skills.
  const agents = [];
  const staysLocalSkills = new Map(); // skill -> stays-local agents that use it (next: library report)
  const closure = (body) => {
    const queue = [...referencedSkills(body, false, knownSkills)].sort();
    const included = new Set();
    while (queue.length) {
      const s = queue.shift();
      if (included.has(s)) continue;
      included.add(s);
      for (const r of loadSkill(s).refs) if (!included.has(r)) queue.push(r);
    }
    return [...included].sort();
  };
  for (const file of agentFiles) {
    const source = `agents/${file}`;
    const { fields, body } = parseFrontmatter(normalize(readFileSync(path.join(root, source), "utf8")), source);
    const name = fields.name;
    if (!name || `${name}.md` !== file) throw new Error(`${source}: name must match the file name`);
    if (RESERVED.has(name)) throw new Error(`${source}: agent name ${name} collides with enact/${name}`);

    if (stays.has(name)) {
      inventory.agents[name] = { wave: "stays-local", wave_reason: "enact/config.json stays_local" };
      if (next) for (const s of closure(body)) staysLocalSkills.set(s, [...(staysLocalSkills.get(s) ?? []), name]);
      continue;
    }

    const overridePath = path.join(enactDir, "overrides", `${name}.json`);
    const override = existsSync(overridePath) ? readJson(overridePath) : {};
    const requiresMcp = [...(override.requires_mcp ?? [])].sort();
    const manifest = {
      ...structuredClone(config.default_manifest),
      name,
      version: enactVersion(plugin.version),
      description: fields.description,
      model: mapModel(fields.model, config),
      ...(override.manifest ?? {}),
    };
    const declared = override.needs_secrets ?? config.needs_secrets_by_role?.[fields.role] ?? [];
    agents.push({
      name,
      fields,
      body,
      override,
      manifest,
      requiresMcp,
      needsSecrets: [...declared].sort(),
      sandboxLocalhost: override.browser?.sandbox_localhost === true,
      skills: closure(body),
      readonly: String(fields.readonly ?? "").toLowerCase() === "true",
    });
  }

  // Pass 2 (next): choose library skills. A skill goes to the library when two or more packaged
  // agents use it, or when keeping it in an agent's own files breaks that agent's limits.
  const library = new Map(); // skill -> reason
  const libraryExcluded = {};
  if (next) {
    const users = new Map();
    for (const a of agents) for (const s of a.skills) users.set(s, [...(users.get(s) ?? []), a.name]);
    for (const [s, names] of [...users].sort()) {
      if (names.length < 2) continue;
      const problem = libraryProblem(loadSkill(s));
      if (problem) libraryExcluded[s] = { reason: problem, used_by: names };
      else library.set(s, `used by ${names.length} packaged agents`);
    }
    for (const a of agents) {
      for (;;) {
        const own = a.skills.filter((s) => !library.has(s));
        const sizes = ownSizes(a, own);
        if (!overLimits(sizes, config.limits)) break;
        const candidates = own.filter((s) => !libraryExcluded[s] && !libraryProblem(loadSkill(s)));
        // The skill holding an over-limit file first, else the largest.
        const pick =
          (sizes.largest > config.limits.max_file_bytes &&
            candidates.find((s) => Object.values(loadSkill(s).files).some((t) => Buffer.byteLength(t) > config.limits.max_file_bytes))) ||
          candidates.sort((x, y) => loadSkill(y).bytes - loadSkill(x).bytes || (x < y ? -1 : 1))[0];
        if (!pick) {
          for (const s of own) {
            const problem = libraryProblem(loadSkill(s));
            if (problem) libraryExcluded[s] = { reason: problem, used_by: [a.name] };
          }
          break;
        }
        library.set(pick, `keeps ${a.name} within the package limits`);
      }
    }
    // Report every other skill the library could not hold, and who uses it.
    for (const s of [...knownSkills].sort()) {
      if (library.has(s) || libraryExcluded[s]) continue;
      const problem = libraryProblem(loadSkill(s));
      if (!problem) continue;
      libraryExcluded[s] = { reason: problem, used_by: users.get(s) ?? [], used_by_stays_local: staysLocalSkills.get(s) ?? [] };
    }
    for (const s of Object.keys(libraryExcluded)) {
      libraryExcluded[s].used_by_stays_local ??= staysLocalSkills.get(s) ?? [];
    }
  }

  function ownSizes(a, own) {
    // instructions.md is a few KiB; count the body plus a generous appendix allowance.
    const sizes = [Buffer.byteLength(a.body) + 8192];
    for (const s of own) for (const t of Object.values(loadSkill(s).files)) sizes.push(Buffer.byteLength(t));
    return { bytes: sizes.reduce((n, b) => n + b, 0), files: sizes.length, largest: Math.max(...sizes) };
  }
  function overLimits(sizes, limits) {
    return sizes.bytes > limits.max_total_bytes || sizes.files > limits.max_files || sizes.largest > limits.max_file_bytes;
  }

  const librarySkills = {};
  for (const s of [...library.keys()].sort()) {
    const entry = loadSkill(s);
    const prefix = `skills/${s}/`;
    const files = Object.fromEntries(Object.entries(entry.files).map(([rel, t]) => [rel.slice(prefix.length), t]));
    const skillManifest = { name: s, version: librarySkillVersion(s, entry.description, files), description: entry.description };
    const doc = { manifest: skillManifest, files };
    const canonical = canonicalJson(doc);
    librarySkills[s] = {
      version: skillManifest.version,
      digest: `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
      bytes: entry.bytes,
      files: Object.keys(files).length,
      stored_bytes: Buffer.byteLength(canonical),
      reason: library.get(s),
      used_by: [],
    };
    outputs.set(`library/${s}/skill.json`, stableJson(skillManifest));
    // Bundle-ready: the exact PUT /skills/{name} body, as canonical JSON (its SHA-256 is the digest).
    outputs.set(`dist/skills/${s}.json`, canonical);
    for (const [rel, t] of Object.entries(files)) outputs.set(`library/${s}/${rel}`, t);
  }

  // Pass 3: write each package.
  const usedSkills = new Set();
  for (const a of agents) {
    const { name, fields, body, override, requiresMcp, needsSecrets, readonly, skills } = a;
    const manifest = a.manifest;
    const pinned = skills.filter((s) => library.has(s));
    const own = skills.filter((s) => !library.has(s));
    const mcpServers = requiresMcp.filter((s) => !builtinMcp.includes(s));
    if (next) {
      if (pinned.length) manifest.library_skills = pinned.map((s) => ({ name: s, version: librarySkills[s].version }));
      if (mcpServers.length) manifest.mcp_servers = mcpServers;
      if (needsSecrets.length) manifest.secrets = needsSecrets;
      if (a.sandboxLocalhost) {
        manifest.tools = [...new Set([...(manifest.tools ?? []), "browser"])].sort();
        manifest.browser = { sandbox_localhost: true };
      }
      for (const s of pinned) librarySkills[s].used_by.push(name);
    }
    for (const s of skills) usedSkills.add(s);

    const info = { requiresMcp, readonly, next, mcpServers, needsSecrets, sandboxLocalhost: a.sandboxLocalhost };
    const instructions = body.replace(/^\n+/, "").replace(/\n*$/, "\n") + appendix(manifest, skills, info, override);
    const files = { "instructions.md": instructions };
    const flags = scanFlags(body.replace(/^\n+/, ""), "instructions.md", patterns);
    const secrets = scanSecrets(body, secretRe);
    const omitted = [];
    for (const s of skills) {
      const entry = loadSkill(s);
      if (!library.has(s)) for (const [rel, text] of Object.entries(entry.files)) files[rel] = text;
      mergeFlags(flags, entry.flags);
      for (const x of entry.secrets) secrets.add(x);
      if (!library.has(s)) omitted.push(...entry.omitted);
    }

    const bytes = Object.values(files).reduce((n, t) => n + Buffer.byteLength(t), 0);
    const fileCount = Object.keys(files).length;
    const largest = Math.max(...Object.values(files).map((t) => Buffer.byteLength(t)));
    const badPaths = Object.keys(files).filter((p) => !FILE_PATH.test(p));
    const pinnedBytes = pinned.reduce((n, s) => n + librarySkills[s].stored_bytes, 0);

    const blockedBy = new Set();
    if (bytes > config.limits.max_total_bytes || fileCount > config.limits.max_files || largest > config.limits.max_file_bytes) {
      blockedBy.add("shared-skill-library");
    }
    if (next && (pinnedBytes > LIBRARY_LIMITS.pinned_bytes || pinned.length > LIBRARY_LIMITS.pins)) blockedBy.add("shared-skill-library");
    const outside = requiresMcp.some((s) => !allowedMcp.includes(s));
    // current: the remote-mcp piece is missing. next: the server is not on the environment's list.
    if (outside) blockedBy.add(next ? "mcp-allow-list" : "remote-mcp");
    if (!next && needsSecrets.length) blockedBy.add("agent-secrets");
    // Only an agent that opens an app it runs inside its sandbox (a localhost dev server) needs the
    // browser-preview piece; the browser tool itself already reaches hosted URLs.
    if (!next && a.sandboxLocalhost) blockedBy.add("browser-preview");

    let wave = override.wave ?? waveOf.get(name);
    let waveReason = override.wave ? "override" : wave ? "enact/config.json waves" : undefined;
    if (!wave && requiresMcp.some((s) => !builtinMcp.includes(s))) {
      wave = config.wave_rules.requires_remote_mcp;
      waveReason = "requires a remote MCP server";
    }
    if (!wave && config.wave_rules[fields.role]) {
      wave = config.wave_rules[fields.role];
      waveReason = `role: ${fields.role}`;
    }
    if (!wave) {
      wave = config.wave_rules.default;
      waveReason = "retained specialist (default)";
    }

    outputs.set(`${name}/agent.json`, stableJson(manifest));
    // Bundle-ready: the exact PUT /agents/{name} body, as canonical JSON (its SHA-256 is the digest).
    outputs.set(`dist/agents/${name}.json`, canonicalJson({ manifest, files }));
    for (const [rel, text] of Object.entries(files)) outputs.set(`${name}/${rel}`, text);

    const sortedFlags = sortFlags(flags);
    inventory.agents[name] = {
      wave,
      wave_reason: waveReason,
      model: manifest.model,
      kit_model: fields.model ?? null,
      readonly,
      bytes,
      files: fileCount,
      skills,
      ...(next ? { own_skills: own, library_skills: pinned, library_pinned_bytes: pinnedBytes, mcp_servers: mcpServers } : {}),
      requires_mcp: requiresMcp,
      requires_mcp_reason: override.requires_mcp_reason ?? "No mcp__ tool reference and no instruction that calls an MCP server.",
      needs_secrets: needsSecrets,
      needs_secrets_source:
        override.needs_secrets !== undefined ? "override" : config.needs_secrets_by_role?.[fields.role] ? `role: ${fields.role}` : "none declared",
      ...(a.sandboxLocalhost ? { browser_sandbox_localhost: true } : {}),
      secret_env_mentions: [...secrets].filter((s) => !config.secret_ignore.includes(s)).sort(),
      flag_counts: Object.fromEntries(Object.entries(sortedFlags).map(([k, v]) => [k, v.length])),
      instruction_flags: sortFlags(scanFlags(body.replace(/^\n+/, ""), "instructions.md", patterns)),
      assumptions: Object.keys(sortedFlags),
      omitted_files: omitted.map((o) => o.path).sort(),
      invalid_paths: badPaths.sort(),
      blocked_by: [...blockedBy].sort(),
    };
  }
  for (const name of [...usedSkills].sort()) {
    const entry = loadSkill(name);
    inventory.skills[name] = {
      bytes: entry.bytes,
      files: Object.keys(entry.files).length,
      flags: sortFlags(entry.flags),
      omitted: entry.omitted,
      references: entry.refs,
    };
  }
  outputs.set("inventory.json", stableJson(inventory));
  if (next) {
    outputs.set(
      "library/index.json",
      stableJson({
        kit_version: plugin.version,
        version_rule: "1.0.0-sha256-<first 16 hex digits of SHA-256 over {name, description, files}>: a version always names the same content",
        limits: LIBRARY_LIMITS,
        skills: librarySkills,
        excluded: libraryExcluded,
      }),
    );
  }
  return outputs;
}

function sortFlags(flags) {
  const out = {};
  for (const k of Object.keys(flags).sort()) out[k] = [...new Set(flags[k])].sort(byLocation);
  return out;
}
function byLocation(a, b) {
  const [pa, la] = splitLoc(a);
  const [pb, lb] = splitLoc(b);
  return pa < pb ? -1 : pa > pb ? 1 : la - lb;
}
function splitLoc(s) {
  const i = s.lastIndexOf(":");
  return [s.slice(0, i), Number(s.slice(i + 1))];
}

function existingGenerated() {
  const found = new Map();
  if (!existsSync(enactDir)) return found;
  const walk = (dir) => {
    for (const entry of readdirSync(path.join(enactDir, dir))) {
      const rel = dir ? `${dir}/${entry}` : entry;
      if (!dir && RESERVED.has(entry) && !GENERATED_DIRS.has(entry) && entry !== "inventory.json") continue;
      if (statSync(path.join(enactDir, rel)).isDirectory()) walk(rel);
      else found.set(rel, readFileSync(path.join(enactDir, rel), "utf8"));
    }
  };
  walk("");
  return found;
}

function main() {
  const args = process.argv.slice(2);
  const usage = "usage: node scripts/sync-enact-agents.mjs [sync|check] [--contract current|next]";
  let command = "sync";
  let contract;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--contract") contract = args[++i];
    else if (args[i].startsWith("--contract=")) contract = args[i].slice("--contract=".length);
    else if (["sync", "check"].includes(args[i])) command = args[i];
    else {
      console.error(usage);
      process.exit(2);
    }
  }
  contract ??= readJson(path.join(enactDir, "config.json")).contract ?? "current";
  if (!["current", "next"].includes(contract)) {
    console.error(usage);
    process.exit(2);
  }
  const outputs = build(contract);
  const existing = existingGenerated();
  const stale = [...existing.keys()].filter((p) => !outputs.has(p)).sort();
  const changed = [...outputs.keys()].filter((p) => existing.get(p) !== outputs.get(p)).sort();
  // Skill copies are gitignored (enact/*/skills/): a fresh checkout has none, so check compares
  // only the committed parts (agent.json, instructions.md, inventory.json).
  const committed = (p) => !/^[^/]+\/skills\//.test(p) && !/^library\/[^/]+\//.test(p) && !p.startsWith("dist/");
  const agents = new Set(
    [...outputs.keys()].filter((p) => p.includes("/") && !GENERATED_DIRS.has(p.split("/")[0])).map((p) => p.split("/")[0]),
  );

  if (command === "check") {
    const staleC = stale.filter(committed);
    const changedC = changed.filter(committed);
    if (staleC.length || changedC.length) {
      for (const p of staleC.slice(0, 50)) console.log(`stale: enact/${p}`);
      for (const p of changedC.slice(0, 50)) console.log(`out of sync: enact/${p}`);
      console.error("enact/ is out of sync; run node scripts/sync-enact-agents.mjs sync");
      process.exit(1);
    }
    console.log(`enact/ is synced (${agents.size} agent packages, contract ${contract})`);
    return;
  }
  for (const p of stale) rmSync(path.join(enactDir, p));
  // Remove directories emptied by stale files.
  const prune = (dir) => {
    const abs = path.join(enactDir, dir);
    for (const entry of readdirSync(abs)) {
      const rel = dir ? `${dir}/${entry}` : entry;
      if (!dir && RESERVED.has(entry) && !GENERATED_DIRS.has(entry)) continue;
      if (statSync(path.join(enactDir, rel)).isDirectory()) prune(rel);
    }
    if (dir && readdirSync(abs).length === 0) rmSync(abs, { recursive: true });
  };
  for (const p of changed) {
    mkdirSync(path.dirname(path.join(enactDir, p)), { recursive: true });
    writeFileSync(path.join(enactDir, p), outputs.get(p));
  }
  prune("");
  const libraryCount = new Set([...outputs.keys()].filter((p) => /^library\/[^/]+\//.test(p)).map((p) => p.split("/")[1])).size;
  console.log(
    `synced ${agents.size} Enact agent packages${contract === "next" ? ` and ${libraryCount} library skills` : ""} (contract ${contract}; ${changed.length} files written, ${stale.length} removed)`,
  );
}

main();
