#!/usr/bin/env node
// Claude Code hook entry point. Claude Code runs plugin hooks for every agent and
// names the active one in `agent_type` (the --agent main session, or the subagent
// a hook fires in), so this adapter keeps only events of agents with memory.

import { existsSync, readdirSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { hasMemory, persistSettings, record } from "./memory.mjs";

// agent_type is the plugin-scoped name ("soofi-xyz-team-kit:wingull") or the bare name.
const agentName = (value) => (typeof value === "string" && value.length > 0 ? value.split(":").pop() : undefined);

const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value ?? null));

export function toMemory(event, now = Date.now()) {
  const agent = agentName(event.agent_type);
  // In Amp, Claude Code runs as the signed-in Amp user; elsewhere the person comes from git.
  const base = { client: "CLAUDE_CODE", sessionId: event.session_id, turnId: event.prompt_id, cwd: event.cwd, clientEmail: process.env.AMP_USER_EMAIL };
  const at = now;
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return hasMemory(agent) ? { ...base, agentName: agent, messages: [{ kind: "USER_PROMPT", content: event.prompt, occurredAt: at }] } : undefined;
    case "Stop":
    case "SubagentStop":
      return hasMemory(agent) && event.last_assistant_message
        ? { ...base, agentName: agent, messages: [{ kind: "AGENT_REPLY", content: event.last_assistant_message, occurredAt: at }] }
        : undefined;
    case "PreToolUse": {
      // Another agent (or the main session) hands a task to an agent with memory.
      const callee = agentName(event.tool_input?.subagent_type);
      if (!["Agent", "Task"].includes(event.tool_name) || !hasMemory(callee)) return undefined;
      return {
        ...base,
        agentName: callee,
        callerAgentName: agent ?? "main",
        messages: [{ kind: "AGENT_REQUEST", content: event.tool_input?.prompt ?? event.tool_input, occurredAt: at }],
      };
    }
    case "PostToolUse":
    case "PostToolUseFailure": {
      if (!hasMemory(agent)) return undefined;
      const call = { kind: "TOOL_CALL", toolName: event.tool_name, toolCallId: event.tool_use_id, content: asText(event.tool_input), occurredAt: at - (event.duration_ms ?? 0) };
      const failed = event.hook_event_name === "PostToolUseFailure";
      const output = failed ? { error: event.error } : event.tool_response;
      const result = { kind: "TOOL_RESULT", toolName: event.tool_name, toolCallId: event.tool_use_id, content: asText(output), occurredAt: at, failed };
      return { ...base, agentName: agent, messages: [call, result] };
    }
    default:
      return undefined;
  }
}

// SessionStart stays local and fast: it only tells the person when memory cannot be saved.
function sessionWarnings(event) {
  if (!hasMemory(agentName(event.agent_type))) return [];
  const settings = persistSettings();
  const warnings = [];
  if (!settings.key) warnings.push("Agent memory is not being saved: no Prism API key. Save the soofi-safavi key to ~/.config/prism/soofi-safavi.key or export PRISM_API_KEY.");
  const pending = existsSync(settings.queueDir) ? readdirSync(settings.queueDir).filter((name) => name.endsWith(".json")).length : 0;
  if (pending > 0) warnings.push(`Agent memory: ${pending} message(s) are waiting to be sent to Persist.`);
  return warnings;
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input || "{}");
  if (event.hook_event_name === "SessionStart") {
    const warnings = sessionWarnings(event);
    if (warnings.length > 0) process.stdout.write(JSON.stringify({ systemMessage: warnings.join(" ") }));
    return;
  }
  const context = toMemory(event);
  if (!context) return;
  const { warnings } = await record(context);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => process.stderr.write(`agent memory: ${error?.message ?? error}\n`));
}
