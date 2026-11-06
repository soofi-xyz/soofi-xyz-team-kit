// Agent memory writer: turns one hook event into an agent-memory graph fact and
// sends it to soofi-safavi's Persist through POST /persist/ingest with the shared
// x-api-key. No AWS and no store of its own: a failed send waits in a local
// delivery queue that is emptied into Persist and never read back as memory.

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { knownSecretValues, redact } from "./redact.mjs";

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_PERSIST_URL = "https://soofi-safavi.account.prismteam.ai/persist";
const MAX_CONTENT_CHARS = 100_000;
const SEND_TIMEOUT_MS = 4_000;
const QUEUE_MAX_FILES = 2_000;
const QUEUE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const FLUSH_BATCH = 25;

export const CLIENTS = {
  CLAUDE_CODE: { slug: "claude-code", manifest: ".claude-plugin/plugin.json", agent: (n) => `agents-claude/${n}.md` },
  CURSOR: { slug: "cursor", manifest: ".cursor-plugin/plugin.json", agent: (n) => `agents/${n}.md` },
  COPILOT_CLI: { slug: "copilot-cli", manifest: "plugin.json", agent: (n) => `agents-copilot/${n}.agent.md` },
  CODEX: { slug: "codex", manifest: ".codex-plugin/plugin.json", agent: (n) => `.codex/agents/${n}.toml` },
};

const DIRECTION = { USER_PROMPT: "INPUT", AGENT_REQUEST: "INPUT", TOOL_RESULT: "INPUT", AGENT_REPLY: "OUTPUT", TOOL_CALL: "OUTPUT" };

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function memoryAgents(root = PLUGIN_ROOT) {
  return JSON.parse(readFileSync(join(root, "hooks/agent-memory/agents.json"), "utf8")).agents;
}

export function hasMemory(agentName, root = PLUGIN_ROOT) {
  return typeof agentName === "string" && memoryAgents(root).includes(agentName);
}

export function promptVersion(client, agentName, root = PLUGIN_ROOT) {
  const spec = CLIENTS[client];
  const manifest = JSON.parse(readFileSync(join(root, spec.manifest), "utf8"));
  const agentFile = join(root, spec.agent(agentName));
  return {
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    promptSha256: sha256(readFileSync(agentFile)),
  };
}

export function personEmail(clientEmail, cwd) {
  const valid = (value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  if (valid(clientEmail)) return { email: clientEmail.trim().toLowerCase(), source: "CLIENT_ACCOUNT" };
  try {
    const git = execFileSync("git", ["config", "user.email"], { cwd, encoding: "utf8", timeout: 1_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (valid(git)) return { email: git.toLowerCase(), source: "GIT_CONFIG" };
  } catch {
    // No git or no user.email: the thread is saved without a person.
  }
  return undefined;
}

function toText(value) {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

// Builds the GraphSON ingest request. Every vertex holds only stable facts, so
// resending the agent, prompt version, thread and email on each message upserts
// the same vertices (Persist hashes IDs from label and properties).
export function buildGraph({ client, sessionId, turnId, agentName, callerAgentName, version, person, messages, secrets = [] }) {
  const spec = CLIENTS[client];
  if (!spec) throw new Error(`unknown client ${client}`);
  const agentIdentifier = `${version.pluginName}:agent/${agentName}`;
  const threadIdentifier = `agent-memory:thread/${spec.slug}/${sessionId}/${agentName}`;
  const vertices = [];
  const edges = [];
  let nextId = 1;

  const vertex = (label, properties) => {
    const id = nextId++;
    vertices.push({
      "@type": "g:Vertex",
      "@value": {
        id: { "@type": "g:Int64", "@value": id },
        label,
        properties: Object.fromEntries(
          Object.entries(properties)
            .filter(([, value]) => value !== undefined)
            .map(([key, value], index) => [
              key,
              [{ "@type": "g:VertexProperty", "@value": { id: { "@type": "g:Int64", "@value": index }, label: key, value: typed(value) } }],
            ]),
        ),
      },
    });
    return { id, label };
  };
  const edge = (label, from, to, properties = {}) => {
    const value = {
      id: { "@type": "g:Int64", "@value": nextId++ },
      label,
      outV: { "@type": "g:Int64", "@value": from.id },
      outVLabel: from.label,
      inV: { "@type": "g:Int64", "@value": to.id },
      inVLabel: to.label,
    };
    const entries = Object.entries(properties).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      value.properties = Object.fromEntries(entries.map(([key, v]) => [key, { "@type": "g:Property", "@value": { key, value: typed(v) } }]));
    }
    edges.push({ "@type": "g:Edge", "@value": value });
  };

  const agent = vertex("agent", { agent_identifier: agentIdentifier, agent_name: agentName, plugin_name: version.pluginName });
  const prompt = vertex("agent_prompt_version", {
    prompt_version_identifier: `${agentIdentifier}@${version.pluginVersion}#${version.promptSha256}`,
    plugin_version: version.pluginVersion,
    prompt_sha256: version.promptSha256,
  });
  const thread = vertex("agent_thread", { thread_identifier: threadIdentifier, client, session_id: sessionId });
  edge("agent_has_agent_prompt_version", agent, prompt);
  edge("agent_thread_with_agent", thread, agent);
  edge("agent_thread_ran_agent_prompt_version", thread, prompt);
  if (person) edge("email_started_agent_thread", vertex("email", { email_address: person.email }), thread, { identity_source: person.source });
  let turn;
  if (typeof turnId === "string" && turnId.length > 0) {
    turn = vertex("agent_turn", { turn_identifier: `${threadIdentifier}/turn/${turnId}`, client_turn_id: turnId });
    edge("agent_thread_has_agent_turn", thread, turn);
  }

  const byToolCall = new Map();
  for (const message of messages) {
    const direction = DIRECTION[message.kind];
    if (!direction) throw new Error(`unknown message kind ${message.kind}`);
    const redacted = redact(toText(message.content), secrets);
    const truncated = redacted.text.length > MAX_CONTENT_CHARS;
    const content = truncated ? redacted.text.slice(0, MAX_CONTENT_CHARS) : redacted.text;
    const occurredAt = new Date(message.occurredAt ?? Date.now()).toISOString();
    const toolCallId = message.toolCallId || undefined;
    const node = vertex("agent_message", {
      message_identifier: `${threadIdentifier}/message/${sha256([message.kind, occurredAt, toolCallId ?? "", content].join("\u0000"))}`,
      direction,
      message_kind: message.kind,
      occurred_at: occurredAt,
      content,
      tool_name: message.toolName || undefined,
      tool_call_identifier: toolCallId,
      caller_agent_name: message.kind === "AGENT_REQUEST" ? callerAgentName || undefined : undefined,
      // Left out when the client does not report failures (Codex).
      tool_failed: message.kind === "TOOL_RESULT" && typeof message.failed === "boolean" ? message.failed : undefined,
      redaction_count: redacted.count,
      content_truncated: truncated,
      content_length: redacted.text.length,
    });
    edge("agent_thread_has_agent_message", thread, node);
    if (turn) edge("agent_turn_has_agent_message", turn, node);
    if (message.kind === "TOOL_CALL") byToolCall.set(toolCallId ?? message.toolName, node);
    if (message.kind === "TOOL_RESULT") {
      const call = byToolCall.get(toolCallId ?? message.toolName);
      if (call) edge("agent_message_answers_agent_message", node, call);
    }
  }
  return { "@type": "tinker:graph", "@value": { vertices, edges } };
}

function typed(value) {
  if (Number.isInteger(value)) return { "@type": "g:Int32", "@value": value };
  return value;
}

export function persistSettings(env = process.env) {
  let key = env.PRISM_API_KEY;
  if (!key) {
    try {
      key = readFileSync(join(homedir(), ".config/prism/soofi-safavi.key"), "utf8").trim();
    } catch {
      key = undefined;
    }
  }
  return {
    url: (env.AGENT_MEMORY_PERSIST_URL || DEFAULT_PERSIST_URL).replace(/\/+$/, ""),
    key: key || undefined,
    queueDir: env.AGENT_MEMORY_QUEUE_DIR || join(homedir(), ".config/prism/agent-memory/queue"),
  };
}

// Returns "sent", "retry" (network, auth, throttling or server error: keep it) or
// "rejected" (Persist refused the payload itself: retrying cannot help).
export async function send(payload, { url, key }, timeoutMs = SEND_TIMEOUT_MS) {
  if (!key) return { status: "retry", detail: "no Prism API key (PRISM_API_KEY or ~/.config/prism/soofi-safavi.key)" };
  try {
    const response = await fetch(`${url}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) return { status: "sent" };
    const body = (await response.text()).slice(0, 500);
    const retryable = [401, 403, 404, 408, 409, 425, 429].includes(response.status) || response.status >= 500;
    return { status: retryable ? "retry" : "rejected", detail: `HTTP ${response.status} ${body}` };
  } catch (error) {
    return { status: "retry", detail: String(error?.message ?? error) };
  }
}

export function enqueue(queueDir, payload) {
  mkdirSync(queueDir, { recursive: true, mode: 0o700 });
  const name = `${Date.now().toString().padStart(15, "0")}-${randomUUID()}.json`;
  const temp = join(queueDir, `.${name}.tmp`);
  writeFileSync(temp, JSON.stringify(payload), { mode: 0o600 });
  renameSync(temp, join(queueDir, name));
}

function queued(queueDir) {
  if (!existsSync(queueDir)) return [];
  return readdirSync(queueDir).filter((name) => name.endsWith(".json") && !name.startsWith(".")).sort();
}

// Sends queued payloads oldest first. One flusher at a time per machine; stops at
// the first payload that still needs a retry so order is preserved.
export async function flush(settings, sendFn = send) {
  const warnings = [];
  const lock = join(settings.queueDir, ".lock");
  if (!existsSync(settings.queueDir)) return { sent: 0, pending: 0, warnings };
  try {
    mkdirSync(lock);
  } catch {
    try {
      if (Date.now() - statSync(lock).mtimeMs < 60_000) return { sent: 0, pending: queued(settings.queueDir).length, warnings };
      rmSync(lock, { recursive: true, force: true });
      mkdirSync(lock);
    } catch {
      return { sent: 0, pending: queued(settings.queueDir).length, warnings };
    }
  }
  let sent = 0;
  try {
    let names = queued(settings.queueDir);
    const now = Date.now();
    const expired = names.filter((name) => now - Number(name.split("-")[0]) > QUEUE_MAX_AGE_MS);
    const overflow = Math.max(0, names.length - expired.length - QUEUE_MAX_FILES);
    const dropped = [...expired, ...names.filter((name) => !expired.includes(name)).slice(0, overflow)];
    for (const name of dropped) rmSync(join(settings.queueDir, name), { force: true });
    if (dropped.length > 0) warnings.push(`agent memory: dropped ${dropped.length} undelivered message(s) older than 14 days or over the ${QUEUE_MAX_FILES}-message queue limit`);
    names = queued(settings.queueDir);
    for (const name of names.slice(0, FLUSH_BATCH)) {
      const path = join(settings.queueDir, name);
      const result = await sendFn(JSON.parse(readFileSync(path, "utf8")), settings);
      if (result.status === "retry") break;
      if (result.status === "rejected") warnings.push(`agent memory: Persist rejected a queued message and it was dropped: ${result.detail}`);
      rmSync(path, { force: true });
      if (result.status === "sent") sent += 1;
    }
  } finally {
    rmdirSync(lock);
  }
  return { sent, pending: queued(settings.queueDir).length, warnings };
}

// Records messages for one agent session. Never throws: memory must not break
// the conversation. Returns warnings for the client adapter to show the person.
export async function record(context, { env = process.env, root = PLUGIN_ROOT, sendFn = send } = {}) {
  const warnings = [];
  try {
    if (!hasMemory(context.agentName, root) || context.messages.length === 0) return { recorded: false, warnings };
    const settings = persistSettings(env);
    const payload = buildGraph({
      ...context,
      version: promptVersion(context.client, context.agentName, root),
      person: personEmail(context.clientEmail, context.cwd),
      secrets: knownSecretValues(env, [settings.key]),
    });
    // Queued payloads go first so a thread's messages reach Persist in order.
    const before = await flush(settings, sendFn);
    warnings.push(...before.warnings);
    const result = before.pending > 0 ? { status: "retry", detail: "earlier messages are still queued" } : await sendFn(payload, settings);
    if (result.status === "retry") {
      enqueue(settings.queueDir, payload);
      warnings.push(`agent memory: Persist unavailable, message queued for retry (${result.detail})`);
    } else if (result.status === "rejected") {
      warnings.push(`agent memory: Persist rejected the message: ${result.detail}`);
    }
    return { recorded: result.status === "sent", warnings };
  } catch (error) {
    warnings.push(`agent memory: not saved: ${error?.message ?? error}`);
    return { recorded: false, warnings };
  }
}

// Run directly with a memory context on stdin (used by adapters that must not
// wait for the network, such as Cursor's synchronous hooks).
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const { warnings } = await record(JSON.parse(input));
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
}
