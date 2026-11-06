#!/usr/bin/env node
// GitHub Copilot CLI hook entry point, in two modes:
//
//   plugin <event>          from hooks/copilot.json, for every session. Inside a subagent started
//                           with the task tool, payloads name it in agentType
//                           ("soofi-xyz-team-kit:wingull"), with parentAgentId the main session.
//   agent <name> <event>    from the hooks in an agent's own file, which fire only while that agent
//                           is the selected one (copilot --agent). Main-session payloads name no
//                           agent, so these hooks say which agent it is. Events that carry agentType
//                           are left to plugin mode, so nothing is saved twice.
//
// Copilot passes the event only through the hook definition, so it is an argument. The main
// session's agentStop carries no reply text; the reply is read from the session's events.jsonl
// once Copilot has written it. Copilot waits for each hook, so sends run in a detached process.

import { spawn } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hasMemory, record } from "./memory.mjs";

const REPLY_WAIT_MS = 20_000;
const agentName = (value) => (typeof value === "string" && value.length > 0 ? value.split(":").pop() : undefined);
const asText = (value) => (typeof value === "string" ? value : JSON.stringify(value ?? null));

function toolMessages(event, payload, now) {
  const failed = event === "postToolUseFailure" || payload.toolResult?.resultType === "failure";
  const output = event === "postToolUseFailure" ? { error: payload.error } : (payload.toolResult?.textResultForLlm ?? payload.toolResult);
  return [
    { kind: "TOOL_CALL", toolName: payload.toolName, toolCallId: payload.toolCallId, content: asText(payload.toolArgs), occurredAt: now - 1 },
    { kind: "TOOL_RESULT", toolName: payload.toolName, toolCallId: payload.toolCallId, content: asText(output), occurredAt: now, failed },
  ];
}

// Returns the memory context for one hook call, { reply: true } when the reply must be read from the
// transcript, or undefined.
export function toMemory([mode, ...rest], payload) {
  const now = typeof payload.timestamp === "number" ? payload.timestamp : Date.now();
  if (mode === "plugin") {
    const [event] = rest;
    const agent = agentName(payload.agentType);
    if (!hasMemory(agent)) return undefined;
    const base = { client: "COPILOT_CLI", sessionId: payload.parentAgentId ?? payload.sessionId, cwd: payload.cwd, agentName: agent };
    if (event === "userPromptSubmitted") return { ...base, callerAgentName: "main", messages: [{ kind: "AGENT_REQUEST", content: payload.prompt, occurredAt: now }] };
    if (event === "postToolUse" || event === "postToolUseFailure") return { ...base, messages: toolMessages(event, payload, now) };
    if (event === "subagentStop" && payload.response) return { ...base, messages: [{ kind: "AGENT_REPLY", content: payload.response, occurredAt: now }] };
    return undefined;
  }
  if (mode === "agent") {
    const [agent, event] = rest;
    if (payload.agentType || !hasMemory(agent)) return undefined;
    const base = { client: "COPILOT_CLI", sessionId: payload.sessionId, cwd: payload.cwd, agentName: agent };
    if (event === "userPromptSubmitted") return { ...base, messages: [{ kind: "USER_PROMPT", content: payload.prompt, occurredAt: now }] };
    if (event === "postToolUse" || event === "postToolUseFailure") return { ...base, messages: toolMessages(event, payload, now) };
    if (event === "agentStop") return { ...base, reply: true, messages: [] };
  }
  return undefined;
}

// The last reply of the current turn: the final assistant.message with text after the last user.message.
export function lastReply(text) {
  const events = text.split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return {};
    }
  });
  const start = events.findLastIndex((event) => event.type === "user.message");
  const reply = events.slice(start + 1).findLast((event) => event.type === "assistant.message" && event.data?.content);
  return reply ? { content: reply.data.content, occurredAt: Date.parse(reply.timestamp) } : undefined;
}

async function readReply(path) {
  const deadline = Date.now() + REPLY_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const reply = lastReply(readFileSync(path, "utf8"));
      if (reply) return reply;
    } catch {
      // Not written yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

const transcriptPath = (payload) =>
  payload.transcriptPath ?? join(process.env.COPILOT_HOME || join(homedir(), ".copilot"), "session-state", payload.sessionId, "events.jsonl");

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const args = process.argv.slice(2);
  if (args[0] === "send") {
    // Detached: wait for the reply when needed, then save.
    const { context, transcript } = JSON.parse(input);
    if (context.reply) {
      const reply = await readReply(transcript);
      if (!reply) return;
      context.messages = [{ kind: "AGENT_REPLY", ...reply }];
    }
    delete context.reply;
    await record(context);
    return;
  }
  const payload = JSON.parse(input || "{}");
  const context = toMemory(args, payload);
  if (!context) return;
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "send"], { detached: true, stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(JSON.stringify({ context, transcript: transcriptPath(payload) }));
  child.unref();
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => process.stderr.write(`agent memory: ${error?.message ?? error}\n`));
}
