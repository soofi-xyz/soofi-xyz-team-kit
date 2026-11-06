#!/usr/bin/env node
// Codex hook entry point. Codex runs custom agents (.codex/agents/*.toml) only as
// subagents spawned with spawn_agent; every hook that fires inside one names it in
// `agent_type` (bare name, such as "wingull") with the parent's session_id and the
// subagent's own turn_id. The main session's events carry no agent_type, so this
// adapter keeps only events of agents with memory.

import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hasMemory } from "./memory.mjs";

const agentName = (value) => (typeof value === "string" && value.length > 0 ? value.split(":").pop() : undefined);
const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value ?? null));

export function toMemory(event, now = Date.now()) {
  const agent = agentName(event.agent_type);
  if (!hasMemory(agent)) return undefined;
  const base = { client: "CODEX", sessionId: event.session_id, turnId: event.turn_id, cwd: event.cwd, agentName: agent };
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      // Inside a subagent this is the task the spawning agent handed it.
      return { ...base, callerAgentName: "main", messages: [{ kind: "AGENT_REQUEST", content: event.prompt, occurredAt: now }] };
    case "PostToolUse":
      // Codex reports no duration or failure flag; the call is placed just before its result.
      return {
        ...base,
        messages: [
          { kind: "TOOL_CALL", toolName: event.tool_name, toolCallId: event.tool_use_id, content: asText(event.tool_input), occurredAt: now - 1 },
          { kind: "TOOL_RESULT", toolName: event.tool_name, toolCallId: event.tool_use_id, content: asText(event.tool_response), occurredAt: now },
        ],
      };
    case "SubagentStop":
      return event.last_assistant_message ? { ...base, messages: [{ kind: "AGENT_REPLY", content: event.last_assistant_message, occurredAt: now }] } : undefined;
    default:
      return undefined;
  }
}

// Codex stops background (async) hooks when it exits, so the hook stays synchronous and hands the
// send to a detached process, returning at once.
async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const context = toMemory(JSON.parse(input || "{}"));
  if (!context) return;
  const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), "memory.mjs")], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(JSON.stringify(context));
  child.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => process.stderr.write(`agent memory: ${error?.message ?? error}\n`));
}
