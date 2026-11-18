import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { test } from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = new URL("../../../scripts/agent-memory-release.mjs", import.meta.url).pathname;
const SOURCE = { SOURCE_REPOSITORY: "prismteam-ai/model", SOURCE_COMMIT: "0123456789abcdef0123456789abcdef01234567" };

// Runs the script with only the given environment (no inherited PRISM_* values or key file lookups).
async function release(args, env) {
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], {
      env: { PATH: process.env.PATH, HOME: "/nonexistent", PRISM_API_KEY: "test-key", AGENT_MEMORY_RELEASE_POLL_MS: "0", ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

for (const [name, env] of [
  ["the default soofi-safavi target", { ...SOURCE }],
  ["soofi-safavi named explicitly", { ...SOURCE, PRISM_DOMAIN: "soofi-safavi.account.prismteam.ai" }],
]) {
  test(`refuses configuration writes to ${name} before any request`, async () => {
    for (const command of ["submit", "approve", "publish", "install"]) {
      const result = await release([command], env);
      assert.equal(result.code, 1, command);
      assert.match(result.stderr, /Refusing to write configuration to soofi-safavi\.account\.prismteam\.ai/);
      assert.match(result.stderr, /configuration repository, Marketplace and Deploy/);
    }
  });
}

test("refuses a dev-stack write without source repository and commit", async () => {
  const result = await release(["install"], { PRISM_DOMAIN: "dev-me.account.prismteam.ai", SOURCE_COMMIT: "abc" });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /SOURCE_REPOSITORY \(owner\/name\) and SOURCE_COMMIT/);
});

test("no longer writes the Persist MCP saved queries", async () => {
  const result = await release(["queries"], {});
  assert.equal(result.code, 1);
  assert.match(result.stderr, /prismteam-ai\/prism-memory-configuration/);
});

test("sends the source headers on dev-stack writes only", async () => {
  const seen = [];
  const lexicon = { vertices: [{ type: "agent_thread" }], edges: [] };
  const server = createServer((request, response) => {
    seen.push({ method: request.method, url: request.url, headers: request.headers });
    request.resume();
    const reply = (body) => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.url.endsWith("/runtime/persist-lexicon")) return reply({ releaseId: "r1", documentDigest: "d1", document: lexicon });
    if (request.url === "/persist/lexicon") return reply({ data: { sha256: "s1" } });
    if (request.method === "PUT") return reply({ data: { changed: true, sha256: "s2" } });
    return reply({ data: { document: lexicon } });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await release(["install"], { ...SOURCE, PRISM_BASE_URL: `http://127.0.0.1:${server.address().port}`, MODEL_ACCOUNT_ID: "acct" });
    assert.equal(result.code, 0, result.stderr);
    const put = seen.find((item) => item.method === "PUT");
    assert.equal(put.url, "/persist/lexicon/extensions/agent-memory");
    assert.equal(put.headers["x-source-repository"], SOURCE.SOURCE_REPOSITORY);
    assert.equal(put.headers["x-source-commit"], SOURCE.SOURCE_COMMIT);
    for (const read of seen.filter((item) => item.method === "GET")) assert.equal(read.headers["x-source-repository"], undefined);
  } finally {
    server.close();
  }
});
