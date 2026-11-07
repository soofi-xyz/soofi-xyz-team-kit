import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { toMemory } from "../claude-code.mjs";
import { buildGraph, record } from "../memory.mjs";
import { knownSecretValues, redact } from "../redact.mjs";

const VERSION = { pluginName: "soofi-xyz-team-kit", pluginVersion: "1.2.3", promptSha256: "a".repeat(64) };

const vertices = (graph, label) => graph["@value"].vertices.filter((v) => v["@value"].label === label);
const edges = (graph, label) => graph["@value"].edges.filter((e) => e["@value"].label === label);
const prop = (vertex, key) => vertex["@value"].properties[key]?.[0]["@value"].value;

test("redacts each kind of secret and leaves ordinary prose alone", () => {
  // Fixtures are assembled at run time so the repository's clean-room secret scan never sees them.
  const pemHeader = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const pemFooter = ["-----END", "PRIVATE KEY-----"].join(" ");
  const fake = {
    pem: `${pemHeader}\n${"M".repeat(32)}\n${pemFooter}`,
    aws: ["AKIA", "IOSFODNN7", "EXAMPLE"].join(""),
    gh: `ghp_${"x".repeat(36)}`,
    jwt: ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", "dozjgNryP4J3jVmNHl0w5N"].join("."),
  };
  const dbUrl = (password) => ["postgres://admin", password].join(":") + "@db.example.com/app";
  const text = [
    `key file ${fake.pem}`,
    `aws ${fake.aws}`,
    `gh ${fake.gh}`,
    `auth Authorization: Bearer abcdefghijklmnop1234`,
    `jwt ${fake.jwt}`,
    `curl -d '{"profile":"oauth2_refresh_token","values":{"client_secret":"s3cr3t-value","refresh_token":"1//0abc"}}'`,
    `db ${dbUrl("hunter2pass")}`,
    `"client_secret": "zzzzzzzz-1111"`,
    "The token budget and password policy are documented in the README.",
  ].join("\n");
  const { text: out, count } = redact(text);
  for (const value of [...Object.values(fake), "abcdefghijklmnop1234", "s3cr3t-value", "hunter2pass", "zzzzzzzz-1111"]) {
    assert.ok(!out.includes(value), `leaked ${value.slice(0, 12)}`);
  }
  assert.ok(out.includes('"values":[REDACTED:credential_values]'));
  assert.ok(out.includes(dbUrl("[REDACTED:url_password]").replace("/app", "")));
  assert.ok(out.includes("The token budget and password policy are documented in the README."));
  assert.ok(count >= 9);
});

test("redacts the Prism key and secret-named environment values, longest first", () => {
  const secrets = knownSecretValues({ PRISM_API_KEY: "prism-key-0123456789", HOME: "/home/someone-long", MY_TOKEN: "prism-key-0123456789-extended" });
  assert.deepEqual(secrets, ["prism-key-0123456789-extended", "prism-key-0123456789"]);
  const { text, count } = redact("a prism-key-0123456789-extended b prism-key-0123456789 c /home/someone-long", secrets);
  assert.equal(text, "a [REDACTED:env_secret] b [REDACTED:env_secret] c /home/someone-long");
  assert.equal(count, 2);
});

test("builds the same graph for the same message, so a retry cannot duplicate", () => {
  const context = {
    client: "CLAUDE_CODE",
    sessionId: "s-1",
    agentName: "wingull",
    version: VERSION,
    person: { email: "ana@example.com", source: "GIT_CONFIG" },
    messages: [{ kind: "USER_PROMPT", content: "configure partner X", occurredAt: 1_700_000_000_000 }],
  };
  assert.deepEqual(buildGraph(context), buildGraph(context));
  const other = buildGraph({ ...context, messages: [{ ...context.messages[0], content: "configure partner Y" }] });
  assert.notEqual(prop(vertices(other, "agent_message")[0], "message_identifier"), prop(vertices(buildGraph(context), "agent_message")[0], "message_identifier"));
});

test("finds the person without saving a cloud agent's bot account", async () => {
  const { personEmail } = await import("../memory.mjs");
  const { execFileSync } = await import("node:child_process");
  // A Cursor Cloud VM: git is the bot account and Cursor passes no user email.
  const repo = mkdtempSync(join(tmpdir(), "person-"));
  execFileSync("git", ["init", "-q", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "cursoragent@cursor.com"]);
  assert.equal(personEmail(undefined, repo, {}), undefined);
  assert.deepEqual(personEmail(undefined, repo, { AGENT_MEMORY_EMAIL: " Saman@Example.com " }), { email: "saman@example.com", source: "CLIENT_ACCOUNT" });
  assert.deepEqual(personEmail(undefined, repo, { CURSOR_USER_EMAIL: "ana@example.com" }), { email: "ana@example.com", source: "CLIENT_ACCOUNT" });
  // The signed-in account wins over the setting; a person's own git email is still used.
  assert.equal(personEmail("ana@example.com", repo, { AGENT_MEMORY_EMAIL: "bo@example.com" }).email, "ana@example.com");
  execFileSync("git", ["-C", repo, "config", "user.email", "bo@example.com"]);
  assert.deepEqual(personEmail(undefined, repo, {}), { email: "bo@example.com", source: "GIT_CONFIG" });
});

test("keeps thread, agent and email vertices stable and records the person", () => {
  const graph = buildGraph({
    client: "CLAUDE_CODE",
    sessionId: "s-1",
    agentName: "wingull",
    version: VERSION,
    person: { email: "ana@example.com", source: "CLIENT_ACCOUNT" },
    messages: [{ kind: "AGENT_REPLY", content: "done", occurredAt: 0 }],
  });
  const [thread] = vertices(graph, "agent_thread");
  assert.deepEqual(Object.keys(thread["@value"].properties).sort(), ["client", "session_id", "thread_identifier"]);
  assert.equal(prop(thread, "thread_identifier"), "agent-memory:thread/claude-code/s-1/wingull");
  const [email] = vertices(graph, "email");
  assert.deepEqual(Object.keys(email["@value"].properties), ["email_address"]);
  const [started] = edges(graph, "email_started_agent_thread");
  assert.equal(started["@value"].outV["@value"], email["@value"].id["@value"]);
  assert.equal(started["@value"].inV["@value"], thread["@value"].id["@value"]);
  assert.equal(started["@value"].properties.identity_source["@value"].value, "CLIENT_ACCOUNT");
  assert.equal(prop(vertices(graph, "agent_prompt_version")[0], "prompt_version_identifier"), `soofi-xyz-team-kit:agent/wingull@1.2.3#${"a".repeat(64)}`);
  const [message] = vertices(graph, "agent_message");
  assert.equal(prop(message, "direction"), "OUTPUT");
  assert.equal(prop(message, "occurred_at"), "1970-01-01T00:00:00.000Z");
  assert.deepEqual(prop(message, "redaction_count"), { "@type": "g:Int32", "@value": 0 });
  assert.equal(prop(message, "content_truncated"), false);
});

test("links a tool result to its call, result to call, and marks directions", () => {
  const graph = buildGraph({
    client: "CLAUDE_CODE",
    sessionId: "s-1",
    agentName: "wingull",
    version: VERSION,
    messages: [
      { kind: "TOOL_CALL", toolName: "Bash", toolCallId: "tu-1", content: '{"command":"ls"}', occurredAt: 1 },
      { kind: "TOOL_RESULT", toolName: "Bash", toolCallId: "tu-1", content: "a\nb", occurredAt: 2 },
    ],
  });
  const [call, result] = vertices(graph, "agent_message");
  assert.equal(prop(call, "direction"), "OUTPUT");
  assert.equal(prop(result, "direction"), "INPUT");
  const [answers] = edges(graph, "agent_message_answers_agent_message");
  assert.equal(answers["@value"].outV["@value"], result["@value"].id["@value"]);
  assert.equal(answers["@value"].inV["@value"], call["@value"].id["@value"]);
  assert.equal(vertices(graph, "email").length, 0);
});

test("truncates long content after redaction and reports the original length", () => {
  const content = `api_key=${"k".repeat(40)} ${"x".repeat(150_000)}`;
  const [message] = vertices(
    buildGraph({ client: "CODEX", sessionId: "s", agentName: "wingull", version: VERSION, messages: [{ kind: "TOOL_RESULT", content, occurredAt: 0 }] }),
    "agent_message",
  );
  assert.equal(prop(message, "content").length, 100_000);
  assert.ok(prop(message, "content").startsWith("api_key=[REDACTED:secret_assignment] "));
  assert.equal(prop(message, "content_truncated"), true);
  assert.equal(prop(message, "content_length")["@value"], "api_key=[REDACTED:secret_assignment] ".length + 150_000);
});

function harness(statuses) {
  const queueDir = join(mkdtempSync(join(tmpdir(), "agent-memory-")), "queue");
  const sent = [];
  const sendFn = async (payload) => {
    const status = statuses.shift() ?? "sent";
    if (status === "sent") sent.push(payload);
    return { status, detail: status };
  };
  const env = { PRISM_API_KEY: "test-key-0123456789", AGENT_MEMORY_QUEUE_DIR: queueDir, AGENT_MEMORY_PERSIST_URL: "http://persist.invalid" };
  return { queueDir, sent, sendFn, env };
}

const queuedFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : []);

const message = (content) => ({ client: "CLAUDE_CODE", sessionId: "s-9", agentName: "wingull", cwd: tmpdir(), messages: [{ kind: "USER_PROMPT", content, occurredAt: 5 }] });
const contents = (payloads) => payloads.map((p) => prop(vertices(p, "agent_message")[0], "content"));

test("queues while Persist is down, then delivers in order exactly once", async () => {
  const h = harness(["retry", "retry", "sent", "sent", "sent"]);
  const first = await record(message("one"), { env: h.env, sendFn: h.sendFn });
  assert.equal(first.recorded, false);
  assert.match(first.warnings.join(), /queued for retry/);
  // Persist still down: the queued message is tried first and the new one queues behind it.
  await record(message("two"), { env: h.env, sendFn: h.sendFn });
  assert.equal(queuedFiles(h.queueDir).length, 2);
  // Persist back: both queued messages go first, then the new one.
  const third = await record(message("three"), { env: h.env, sendFn: h.sendFn });
  assert.equal(third.recorded, true);
  assert.deepEqual(contents(h.sent), ["one", "two", "three"]);
  assert.deepEqual(queuedFiles(h.queueDir), []);
});

test("does not queue a payload Persist rejects, and never saves the key", async () => {
  const h = harness(["rejected"]);
  const result = await record(message("my key is test-key-0123456789"), { env: h.env, sendFn: h.sendFn });
  assert.match(result.warnings.join(), /rejected/);
  assert.deepEqual(queuedFiles(h.queueDir), []);
  const h2 = harness([]);
  await record(message("my key is test-key-0123456789"), { env: h2.env, sendFn: h2.sendFn });
  assert.deepEqual(contents(h2.sent), ["my key is [REDACTED:env_secret]"]);
});

test("records nothing for an agent without memory", async () => {
  const h = harness([]);
  const result = await record({ ...message("hi"), agentName: "lapras" }, { env: h.env, sendFn: h.sendFn });
  assert.equal(result.recorded, false);
  assert.equal(h.sent.length, 0);
});

test("maps Claude Code events of wingull only", () => {
  const base = { session_id: "s", cwd: "/w" };
  assert.equal(toMemory({ ...base, hook_event_name: "UserPromptSubmit", prompt: "hi" }), undefined);
  assert.equal(toMemory({ ...base, hook_event_name: "UserPromptSubmit", agent_type: "soofi-xyz-team-kit:lapras", prompt: "hi" }), undefined);
  const prompt = toMemory({ ...base, hook_event_name: "UserPromptSubmit", agent_type: "soofi-xyz-team-kit:wingull", prompt_id: "p-1", prompt: "hi" }, 10);
  assert.equal(prompt.turnId, "p-1");
  assert.equal(prompt.agentName, "wingull");
  assert.deepEqual(prompt.messages, [{ kind: "USER_PROMPT", content: "hi", occurredAt: 10 }]);

  const request = toMemory({ ...base, hook_event_name: "PreToolUse", agent_type: "arceus", tool_name: "Agent", tool_input: { subagent_type: "soofi-xyz-team-kit:wingull", prompt: "set up partner" } }, 10);
  assert.equal(request.agentName, "wingull");
  assert.equal(request.callerAgentName, "arceus");
  assert.equal(request.messages[0].kind, "AGENT_REQUEST");

  const tool = toMemory({ ...base, hook_event_name: "PostToolUse", agent_type: "wingull", tool_name: "Bash", tool_use_id: "tu", tool_input: { command: "ls" }, tool_response: { stdout: "a" }, duration_ms: 4 }, 10);
  assert.deepEqual(tool.messages.map((m) => [m.kind, m.content, m.occurredAt]), [["TOOL_CALL", '{"command":"ls"}', 6], ["TOOL_RESULT", '{"stdout":"a"}', 10]]);

  // A failed tool is saved as tool_failed true, a succeeded one as false; the call itself carries neither.
  const failure = toMemory({ ...base, hook_event_name: "PostToolUseFailure", agent_type: "wingull", tool_name: "Bash", tool_use_id: "tu-2", tool_input: { command: "x" }, error: "exit 1" }, 10);
  const failed = (event) => vertices(buildGraph({ client: "CLAUDE_CODE", version: VERSION, ...event }), "agent_message").map((m) => prop(m, "tool_failed"));
  assert.deepEqual(failed(failure), [undefined, true]);
  assert.deepEqual(failed(tool), [undefined, false]);

  const reply = toMemory({ ...base, hook_event_name: "SubagentStop", agent_type: "soofi-xyz-team-kit:wingull", last_assistant_message: "configured" });
  assert.equal(reply.messages[0].kind, "AGENT_REPLY");
});

test("maps a Cursor /wingull session as the probe recorded it, and ignores other agents", async () => {
  const { toMemory: cursor } = await import("../cursor.mjs");
  const dir = mkdtempSync(join(tmpdir(), "cursor-routes-"));
  const parent = "c19f639e-6023-4c66-a405-0cc19c0cb71d";
  const child = "9b06fa73-6b5b-4e9d-81e1-a32a52015267";
  const task = "toolu_01S8DeEvLHNdMSGHftMXk8QT";
  const common = { user_email: "alex@example.com", workspace_roots: ["/w"] };
  const run = (event) => cursor({ ...common, ...event }, { dir, now: 1_000 });

  const turn = "6dd33196-d0f0-4cc9-9228-8a1bab37a315";
  const prompt = run({ hook_event_name: "beforeSubmitPrompt", conversation_id: parent, generation_id: turn, prompt: "/wingull List the files" });
  assert.equal(prompt.turnId, turn);
  assert.deepEqual([prompt.agentName, prompt.sessionId, prompt.messages[0].kind, prompt.clientEmail], ["wingull", parent, "USER_PROMPT", "alex@example.com"]);

  const request = run({ hook_event_name: "preToolUse", conversation_id: parent, generation_id: turn, tool_name: "Task", tool_use_id: task, tool_input: { subagent_type: "wingull", prompt: "count files" } });
  assert.deepEqual([request.messages[0].kind, request.messages[0].content, request.callerAgentName], ["AGENT_REQUEST", "count files", "cursor-agent"]);
  assert.equal(run({ hook_event_name: "subagentStart", conversation_id: parent, parent_conversation_id: parent, subagent_type: "wingull", tool_call_id: task }), undefined);

  // Wingull's own tool call: child conversation, no agent name, only parent_tool_call_id.
  const tool = run({ hook_event_name: "postToolUse", conversation_id: child, generation_id: "d33573fe-child-generation", parent_agent_id: parent, parent_tool_call_id: task, tool_name: "Shell", tool_use_id: "t-1", tool_input: { command: "ls" }, tool_output: "a\nb", duration: 40 });
  assert.equal(tool.sessionId, parent);
  assert.equal(tool.turnId, turn);
  assert.deepEqual(tool.messages.map((m) => [m.kind, m.content, m.occurredAt]), [["TOOL_CALL", '{"command":"ls"}', 960], ["TOOL_RESULT", "a\nb", 1_000]]);
  assert.equal(tool.messages[1].failed, false);
  const failure = run({ hook_event_name: "postToolUseFailure", conversation_id: child, parent_tool_call_id: task, tool_name: "Shell", tool_use_id: "t-2", tool_input: { command: "x" }, error_message: "exit 1" });
  assert.deepEqual([failure.messages[1].failed, failure.messages[1].content], [true, '{"error":"exit 1"}']);

  const reply = run({ hook_event_name: "postToolUse", conversation_id: parent, generation_id: turn, tool_name: "Task", tool_use_id: task, tool_input: { subagent_type: "wingull", prompt: "count files" }, tool_output: "There are 3 files." });
  assert.deepEqual([reply.messages[0].kind, reply.messages[0].content, reply.turnId], ["AGENT_REPLY", "There are 3 files.", turn]);

  run({ hook_event_name: "subagentStop", conversation_id: parent, subagent_type: "wingull", subagent_id: task, tool_call_id: task });
  assert.equal(run({ hook_event_name: "postToolUse", conversation_id: child, parent_tool_call_id: task, tool_name: "Shell", tool_input: {}, tool_output: "late" }), undefined);

  // The comparison chat: no slash command, no Task for an agent with memory.
  assert.equal(run({ hook_event_name: "beforeSubmitPrompt", conversation_id: "x", prompt: "List the files" }), undefined);
  assert.equal(run({ hook_event_name: "postToolUse", conversation_id: "x", tool_name: "Grep", tool_input: {}, tool_output: "f" }), undefined);
  assert.equal(run({ hook_event_name: "preToolUse", conversation_id: "x", tool_name: "Task", tool_use_id: "t-9", tool_input: { subagent_type: "lapras", prompt: "p" } }), undefined);
  assert.equal(run({ hook_event_name: "postToolUse", conversation_id: "y", parent_tool_call_id: "t-9", tool_name: "Shell", tool_input: {}, tool_output: "f" }), undefined);

  // Plugin and project hooks both fire for one event in this repository: only the first records it.
  const { claimEvent } = await import("../cursor.mjs");
  const events = mkdtempSync(join(tmpdir(), "cursor-events-"));
  const input = JSON.stringify({ hook_event_name: "postToolUse", tool_use_id: "t-1" });
  assert.deepEqual([claimEvent(input, { dir: events, now: 1_000 }), claimEvent(input, { dir: events, now: 1_000 })], [true, false]);
  assert.equal(claimEvent(JSON.stringify({ hook_event_name: "postToolUse", tool_use_id: "t-2" }), { dir: events, now: 1_000 }), true);
});

test("groups a turn's messages under one turn vertex, and omits it without a turn id", () => {
  const context = { client: "CURSOR", sessionId: "c-1", agentName: "wingull", version: VERSION, messages: [
    { kind: "TOOL_CALL", toolName: "Shell", toolCallId: "t", content: "{}", occurredAt: 1 },
    { kind: "TOOL_RESULT", toolName: "Shell", toolCallId: "t", content: "x", occurredAt: 2 },
  ] };
  const graph = buildGraph({ ...context, turnId: "g-7" });
  const [turn] = vertices(graph, "agent_turn");
  assert.equal(prop(turn, "turn_identifier"), "agent-memory:thread/cursor/c-1/wingull/turn/g-7");
  assert.deepEqual(Object.keys(turn["@value"].properties).sort(), ["client_turn_id", "turn_identifier"]);
  const [thread] = vertices(graph, "agent_thread");
  assert.equal(edges(graph, "agent_thread_has_agent_turn")[0]["@value"].outV["@value"], thread["@value"].id["@value"]);
  const linked = edges(graph, "agent_turn_has_agent_message").map((e) => [e["@value"].outV["@value"], e["@value"].inV["@value"]]);
  assert.deepEqual(linked, vertices(graph, "agent_message").map((m) => [turn["@value"].id["@value"], m["@value"].id["@value"]]));
  assert.equal(edges(graph, "agent_thread_has_agent_message").length, 2);

  const noTurn = buildGraph(context);
  assert.equal(vertices(noTurn, "agent_turn").length, 0);
  assert.equal(edges(noTurn, "agent_turn_has_agent_message").length, 0);
  assert.equal(edges(noTurn, "agent_thread_has_agent_message").length, 2);
});

test("maps a Codex spawned wingull as the probe recorded it, and ignores the main session", async () => {
  const { toMemory: codex } = await import("../codex.mjs");
  const session = "01a1b0a6-6222-7112-bab8-b5adc1e9b7ac";
  const turn = "01a1b0a6-62d2-7870-8810-0a7fd98b8c35";
  const inside = { session_id: session, turn_id: turn, agent_id: "01a1b0a6-62cf-7780-9a49-349137bc26af", agent_type: "wingull", cwd: "/w" };
  // The main session's own events carry no agent_type.
  assert.equal(codex({ session_id: session, turn_id: "t-main", hook_event_name: "UserPromptSubmit", prompt: "USE_WINGULL list the files" }), undefined);
  assert.equal(codex({ session_id: session, hook_event_name: "PostToolUse", tool_name: "spawn_agent", tool_input: { agent_type: "wingull" }, tool_response: "{}" }), undefined);
  assert.equal(codex({ ...inside, agent_type: "lapras", hook_event_name: "UserPromptSubmit", prompt: "x" }), undefined);

  const request = codex({ ...inside, hook_event_name: "UserPromptSubmit", prompt: "SUBTASK: list the files" }, 10);
  assert.deepEqual([request.client, request.sessionId, request.turnId, request.agentName, request.messages[0].kind], ["CODEX", session, turn, "wingull", "AGENT_REQUEST"]);
  const tool = codex({ ...inside, hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "call_x8", tool_input: { command: "ls" }, tool_response: "a\nb" }, 10);
  assert.deepEqual(tool.messages.map((m) => [m.kind, m.content, m.occurredAt, m.failed]), [["TOOL_CALL", '{"command":"ls"}', 9, undefined], ["TOOL_RESULT", "a\nb", 10, undefined]]);
  // Codex reports no failure flag, so tool_failed is left out rather than saved as false.
  const [, result] = vertices(buildGraph({ ...tool, version: VERSION }), "agent_message");
  assert.equal(prop(result, "tool_failed"), undefined);
  const reply = codex({ ...inside, hook_event_name: "SubagentStop", last_assistant_message: "done: there are some files." });
  assert.deepEqual([reply.messages[0].kind, reply.messages[0].content, reply.turnId], ["AGENT_REPLY", "done: there are some files.", turn]);
});

test("maps Copilot CLI wingull as main agent and as a task subagent, saving each event once", async () => {
  const { toMemory: copilot, lastReply } = await import("../copilot.mjs");
  const main = "8362096b-0ff5-481d-881b-843c8b19165e";
  const sub = { sessionId: "16a8424a-416c-4375-8bd5-6783d8a34b2e", agentId: "16a8424a-416c-4375-8bd5-6783d8a34b2e", agentType: "soofi-xyz-team-kit:wingull", parentAgentId: main, cwd: "/w", timestamp: 20 };
  const tool = { toolName: "bash", toolCallId: "call_x3", toolArgs: { command: "ls", description: "List files" }, toolResult: { resultType: "success", textResultForLlm: "a\nb" } };

  // copilot --agent soofi-xyz-team-kit:wingull: only the agent file's hooks know the agent.
  const prompt = copilot(["agent", "wingull", "userPromptSubmitted"], { sessionId: main, cwd: "/w", prompt: "List the files", timestamp: 5 });
  assert.deepEqual([prompt.client, prompt.sessionId, prompt.agentName, prompt.messages[0].kind, prompt.messages[0].occurredAt], ["COPILOT_CLI", main, "wingull", "USER_PROMPT", 5]);
  assert.equal(copilot(["plugin", "userPromptSubmitted"], { sessionId: main, prompt: "List the files" }), undefined);
  const call = copilot(["agent", "wingull", "postToolUse"], { sessionId: main, timestamp: 6, ...tool });
  assert.deepEqual(call.messages.map((m) => [m.kind, m.content, m.failed]), [["TOOL_CALL", '{"command":"ls","description":"List files"}', undefined], ["TOOL_RESULT", "a\nb", false]]);
  const failure = copilot(["agent", "wingull", "postToolUseFailure"], { sessionId: main, ...tool, toolResult: undefined, error: "exit 1" });
  assert.deepEqual([failure.messages[1].failed, failure.messages[1].content], [true, '{"error":"exit 1"}']);
  assert.equal(copilot(["agent", "wingull", "agentStop"], { sessionId: main }).reply, true);

  // The reply comes from the transcript: the last assistant text after the last user message.
  const line = (type, data, timestamp = "2026-11-06T11:33:34.288Z") => JSON.stringify({ type, data, timestamp });
  const transcript = [
    line("user.message", { content: "earlier" }),
    line("assistant.message", { content: "earlier reply" }),
    line("user.message", { content: "List the files" }),
    line("assistant.message", { content: "", toolRequests: [{ name: "bash" }] }),
    line("assistant.message", { content: "done: there are some files.", toolRequests: [] }),
  ].join("\n");
  assert.deepEqual(lastReply(transcript), { content: "done: there are some files.", occurredAt: Date.parse("2026-11-06T11:33:34.288Z") });
  assert.equal(lastReply([line("user.message", { content: "x" }), line("assistant.message", { content: "", toolRequests: [{}] })].join("\n")), undefined);

  // Called through the task tool: plugin hooks see agentType; the agent file's hooks step aside.
  const request = copilot(["plugin", "userPromptSubmitted"], { ...sub, prompt: "SUBTASK: list the files" });
  assert.deepEqual([request.sessionId, request.agentName, request.messages[0].kind], [main, "wingull", "AGENT_REQUEST"]);
  assert.equal(copilot(["plugin", "postToolUse"], { ...sub, ...tool }).sessionId, main);
  assert.equal(copilot(["agent", "wingull", "postToolUse"], { ...sub, ...tool }), undefined);
  assert.equal(copilot(["agent", "wingull", "agentStop"], { ...sub, response: "done" }), undefined);
  const reply = copilot(["plugin", "subagentStop"], { sessionId: main, agentType: sub.agentType, parentAgentId: main, response: "done: there are some files." });
  assert.deepEqual([reply.sessionId, reply.messages[0].kind, reply.messages[0].content], [main, "AGENT_REPLY", "done: there are some files."]);

  // Another agent called through task is not saved.
  assert.equal(copilot(["plugin", "postToolUse"], { ...sub, agentType: "soofi-xyz-team-kit:lapras", ...tool }), undefined);
});
