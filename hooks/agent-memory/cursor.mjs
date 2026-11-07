#!/usr/bin/env node
// Cursor hook entry point. Cursor runs plugin agents as subagents: the main agent
// calls the Task tool with subagent_type "wingull", even for "/wingull …". The
// subagent's own tool calls carry no agent name, only parent_tool_call_id, the id
// of that Task call. So when a Task call starts an agent with memory, this adapter
// writes a small route file (Task call id -> agent and thread) and removes it when
// the subagent stops. The route file is delivery routing, never read as memory.
//
// Cursor waits for each hook, so the send runs in a detached child process.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hasMemory, persistSettings } from "./memory.mjs";

const ROUTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function routesDir(env = process.env) {
  return join(dirname(persistSettings(env).queueDir), "cursor-subagents");
}

const routePath = (dir, toolCallId) => join(dir, `${createHash("sha256").update(String(toolCallId)).digest("hex").slice(0, 32)}.json`);

function writeRoute(dir, toolCallId, route) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(routePath(dir, toolCallId), JSON.stringify(route), { mode: 0o600 });
}

function readRoute(dir, toolCallId) {
  if (!toolCallId) return undefined;
  try {
    return JSON.parse(readFileSync(routePath(dir, toolCallId), "utf8"));
  } catch {
    return undefined;
  }
}

function dropStaleRoutes(dir, now) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (now - statSync(path).mtimeMs > ROUTE_MAX_AGE_MS) rmSync(path, { force: true });
  }
}

const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value ?? null));
// Cursor Cloud gives a subagent's own events no parent id: they carry a new conversation id whose
// first prompt is the task the parent handed over. A route keyed by that task text links them.
const taskKey = (task) => `task:${typeof task === "string" ? task : JSON.stringify(task ?? null)}`;
const conversationKey = (id) => `conversation:${id}`;
// Newer Cursor answers a Task call with a status ({"status":"success","agentId":…}); the
// subagent's answer then arrives as subagentStop's summary.
function isStatusOnly(output) {
  try {
    const value = typeof output === "string" ? JSON.parse(output) : output;
    return Boolean(value && typeof value === "object" && "agentId" in value && "status" in value);
  } catch {
    return false;
  }
}

const slashAgent = (prompt) => /^\s*\/([a-z0-9-]+)(?:\s|$)/i.exec(prompt ?? "")?.[1]?.toLowerCase();

// Returns the memory context for one Cursor hook event, or undefined.
export function toMemory(event, { dir = routesDir(), now = Date.now() } = {}) {
  const base = { client: "CURSOR", turnId: event.generation_id, clientEmail: event.user_email, cwd: event.workspace_roots?.[0] };
  switch (event.hook_event_name) {
    case "beforeSubmitPrompt": {
      // "/wingull …" typed by the person: the thread is the person's conversation.
      const agent = slashAgent(event.prompt);
      if (!hasMemory(agent)) {
        // A subagent's own conversation starting with its task: route its tool calls.
        const route = readRoute(dir, taskKey(event.prompt));
        if (route && event.conversation_id) writeRoute(dir, conversationKey(event.conversation_id), route);
        return undefined;
      }
      return { ...base, sessionId: event.conversation_id, agentName: agent, messages: [{ kind: "USER_PROMPT", content: event.prompt, occurredAt: now }] };
    }
    case "preToolUse": {
      const agent = event.tool_name === "Task" ? event.tool_input?.subagent_type : undefined;
      if (!hasMemory(agent)) return undefined;
      dropStaleRoutes(dir, now);
      const route = { agentName: agent, sessionId: event.conversation_id, turnId: event.generation_id };
      writeRoute(dir, event.tool_use_id, route);
      writeRoute(dir, taskKey(event.tool_input?.prompt), route);
      return {
        ...base,
        sessionId: event.conversation_id,
        agentName: agent,
        callerAgentName: "cursor-agent",
        messages: [{ kind: "AGENT_REQUEST", content: event.tool_input?.prompt ?? event.tool_input, occurredAt: now }],
      };
    }
    case "subagentStart": {
      if (hasMemory(event.subagent_type)) {
        const route = { agentName: event.subagent_type, sessionId: event.parent_conversation_id ?? event.conversation_id, turnId: event.generation_id };
        if (event.tool_call_id && !readRoute(dir, event.tool_call_id)) writeRoute(dir, event.tool_call_id, route);
        if (event.task && !readRoute(dir, taskKey(event.task))) writeRoute(dir, taskKey(event.task), route);
      }
      return undefined;
    }
    case "postToolUse":
    case "postToolUseFailure": {
      // Wingull's reply is the Task call's result in the parent conversation.
      if (event.tool_name === "Task" && hasMemory(event.tool_input?.subagent_type)) {
        if (isStatusOnly(event.tool_output)) return undefined;
        return {
          ...base,
          sessionId: event.conversation_id,
          agentName: event.tool_input.subagent_type,
          messages: [{ kind: "AGENT_REPLY", content: event.tool_output ?? event.error_message ?? event.error, occurredAt: now }],
        };
      }
      // A tool call made inside the subagent.
      const route = readRoute(dir, event.parent_tool_call_id) ?? readRoute(dir, conversationKey(event.conversation_id));
      if (!route) return undefined;
      const failed = event.hook_event_name === "postToolUseFailure";
      const output = failed ? { error: event.error_message ?? event.error } : event.tool_output;
      return {
        ...base,
        sessionId: route.sessionId,
        // The subagent's own generation_id belongs to its child conversation; the turn is the parent's.
        turnId: route.turnId,
        agentName: route.agentName,
        messages: [
          { kind: "TOOL_CALL", toolName: event.tool_name, toolCallId: event.tool_use_id, content: asText(event.tool_input), occurredAt: now - (event.duration ?? 0) },
          { kind: "TOOL_RESULT", toolName: event.tool_name, toolCallId: event.tool_use_id, content: asText(output), occurredAt: now, failed },
        ],
      };
    }
    case "subagentStop": {
      if (event.tool_call_id) rmSync(routePath(dir, event.tool_call_id), { force: true });
      else if (event.subagent_id) rmSync(routePath(dir, event.subagent_id), { force: true });
      if (event.task) rmSync(routePath(dir, taskKey(event.task)), { force: true });
      // The subagent's answer, when Cursor reports it here instead of in the Task result.
      if (!hasMemory(event.subagent_type) || typeof event.summary !== "string" || event.summary.length === 0) return undefined;
      return {
        ...base,
        sessionId: event.parent_conversation_id ?? event.conversation_id,
        agentName: event.subagent_type,
        messages: [{ kind: "AGENT_REPLY", content: event.summary, occurredAt: now }],
      };
    }
    default:
      return undefined;
  }
}

// In this repository Cursor runs both the plugin's hooks and the project's .cursor/hooks.json
// (which Cloud Agents need) for the same event. Only the first copy of an event is recorded.
export function claimEvent(input, { dir = join(dirname(persistSettings().queueDir), "cursor-events"), now = Date.now() } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  dropStaleRoutes(dir, now);
  try {
    writeFileSync(join(dir, createHash("sha256").update(input).digest("hex").slice(0, 32)), "", { flag: "wx", mode: 0o600 });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") return false;
    throw error;
  }
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  // Cursor reads JSON from some hooks' stdout; an empty object changes nothing.
  process.stdout.write("{}");
  if (!claimEvent(input)) return;
  const event = JSON.parse(input || "{}");
  const context = toMemory(event);
  if (!context) return;
  const sender = join(dirname(fileURLToPath(import.meta.url)), "memory.mjs");
  const child = spawn(process.execPath, [sender], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(JSON.stringify(context));
  child.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => process.stderr.write(`agent memory: ${error?.message ?? error}\n`));
}
