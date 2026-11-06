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
  const prompt = toMemory({ ...base, hook_event_name: "UserPromptSubmit", agent_type: "soofi-xyz-team-kit:wingull", prompt: "hi" }, 10);
  assert.equal(prompt.agentName, "wingull");
  assert.deepEqual(prompt.messages, [{ kind: "USER_PROMPT", content: "hi", occurredAt: 10 }]);

  const request = toMemory({ ...base, hook_event_name: "PreToolUse", agent_type: "arceus", tool_name: "Agent", tool_input: { subagent_type: "soofi-xyz-team-kit:wingull", prompt: "set up partner" } }, 10);
  assert.equal(request.agentName, "wingull");
  assert.equal(request.callerAgentName, "arceus");
  assert.equal(request.messages[0].kind, "AGENT_REQUEST");

  const tool = toMemory({ ...base, hook_event_name: "PostToolUse", agent_type: "wingull", tool_name: "Bash", tool_use_id: "tu", tool_input: { command: "ls" }, tool_response: { stdout: "a" }, duration_ms: 4 }, 10);
  assert.deepEqual(tool.messages.map((m) => [m.kind, m.content, m.occurredAt]), [["TOOL_CALL", '{"command":"ls"}', 6], ["TOOL_RESULT", '{"stdout":"a"}', 10]]);

  const reply = toMemory({ ...base, hook_event_name: "SubagentStop", agent_type: "soofi-xyz-team-kit:wingull", last_assistant_message: "configured" });
  assert.equal(reply.messages[0].kind, "AGENT_REPLY");
});
