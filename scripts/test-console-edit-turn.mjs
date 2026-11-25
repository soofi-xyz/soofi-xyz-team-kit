#!/usr/bin/env node
// End-to-end test of skills/configure-console-product/scripts/edit-turn.mjs, the Console Edit Mode
// turn Vivillon runs: real git against a temporary remote, a stand-in for GitHub's pull request
// API and a stand-in `console-app check`. Nothing leaves the machine.
//
//   node --test scripts/test-console-edit-turn.mjs
//
// Each test builds its own world: a bare "GitHub" remote that logs every ref it receives, a home
// directory set up as an Enact sandbox sets one up (credential helper, a pre-push hook refusing the
// default branch, a commit-msg hook adding the co-author) and a clone Vivillon works in.
//
// Node standard library only.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../skills/configure-console-product/scripts/edit-turn.mjs");
const REPOSITORY = "prismteam-ai/console-app-fixture";
const APP_ID = "demo";
const SESSION_ID = "sess-01";
const BRANCH = `edit/${APP_ID}/${SESSION_ID}`;
// Not a credential: a fixture value the stand-in API expects, built so no secret scan matches it.
const TOKEN = ["fixture", "token", "for", "tests"].join("-");

const write = (file, text, mode) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  if (mode) chmodSync(file, mode);
};

/** The app as the installed commit holds it: `apps/demo/` in a bundle repository, or the root. */
const seedFiles = (appRoot) => {
  const at = (file) => path.posix.join(appRoot, file);
  const files = {
    ".gitignore": "node_modules/\ndist/\n",
    "README.md": "# fixture\n",
    ".github/workflows/ci.yml": "name: CI\non: [pull_request]\njobs: {}\n",
    [at("console-app.json")]: `${JSON.stringify({ schemaVersion: "1.0", appId: APP_ID, title: "Demo" }, null, 2)}\n`,
    [at("package.json")]: `${JSON.stringify({ name: APP_ID, private: true, scripts: { check: "console-app check" }, dependencies: { "@prism/console-app-kit": "1.34.0" } }, null, 2)}\n`,
    [at("pnpm-lock.yaml")]: "lockfileVersion: '9.0'\n",
    [at("tsconfig.json")]: '{ "extends": "@prism/console-app-kit/tsconfig.app.json" }\n',
    [at("src/app.tsx")]: 'export default function App() {\n  return "Demo";\n}\n',
  };
  if (appRoot) {
    files["bundle.json"] = `${JSON.stringify({ schemaVersion: "1", bundle: "fixture", configurations: [{ id: APP_ID, product: "console", kind: "app", source: appRoot }] }, null, 2)}\n`;
  }
  return files;
};

// Stands in for `console-app check`: fails on a direct network call, as the kit's rule does, and
// writes the build record only when it passes. It logs every run so a test can tell whether the
// gate reached it.
const CONSOLE_APP = `#!/bin/sh
echo "$@" >> "$CHECK_LOG"
[ "$1" = check ] || { echo "console-app: unknown command $1" >&2; exit 2; }
rm -rf dist
if grep -rn 'fetch(' src >&2; then
  echo "network-call: an app reads data only through Console's API" >&2
  exit 1
fi
mkdir -p dist && echo '{"check":{"passed":true}}' > dist/build-record.json
`;

const ENACT_PRE_PUSH = `#!/bin/sh
# As Enact's sandbox hook: agents never push to the default branch.
while read -r local_ref local_sha remote_ref remote_sha; do
  if [ "$remote_ref" = refs/heads/main ]; then
    echo "Enact agents never push to the default branch" >&2
    exit 1
  fi
done
exit 0
`;

class World {
  constructor(t, { appRoot = "apps/demo" } = {}) {
    this.appRoot = appRoot;
    this.root = mkdtempSync(path.join(tmpdir(), "edit-turn-"));
    t.after(() => this.close());
    this.home = path.join(this.root, "home");
    this.bare = path.join(this.root, "remotes", `${REPOSITORY}.git`);
    this.pushLog = path.join(this.root, "pushes.log");
    this.checkLog = path.join(this.root, "checks.log");
    this.clone = path.join(this.root, "work", "clone");
    this.pulls = [];
    this.requests = [];

    const enact = path.join(this.home, ".enact");
    write(path.join(enact, "bin", "git-credential-enact"), `#!/bin/sh\n[ "$1" = get ] || exit 0\nprintf 'username=x-access-token\\npassword=%s\\n' '${TOKEN}'\n`, 0o755);
    write(path.join(enact, "hooks", "pre-push"), ENACT_PRE_PUSH, 0o755);
    write(path.join(enact, "hooks", "commit-msg"), '#!/bin/sh\nexec git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Co-authored-by: Person <person@example.com>" "$1"\n', 0o755);
    write(
      path.join(this.home, ".gitconfig"),
      [
        "[user]",
        "\tname = enact-app[bot]",
        "\temail = bot@example.com",
        '[credential "https://github.com"]',
        "\thelper =",
        `\thelper = "${path.join(enact, "bin", "git-credential-enact")}"`,
        "\tuseHttpPath = true",
        "[core]",
        `\thooksPath = "${path.join(enact, "hooks")}"`,
        // The temporary remote answers for github.com, so the script's own clone URL is used as is.
        `[url "file://${path.join(this.root, "remotes")}/"]`,
        "\tinsteadOf = https://github.com/",
        "[init]",
        "\tdefaultBranch = main",
        "",
      ].join("\n"),
    );

    mkdirSync(this.bare, { recursive: true });
    this.git(this.root, "init", "--quiet", "--bare", this.bare);
    // The remote's own hooks folder: the sandbox's global hooksPath is the client's, not GitHub's.
    write(path.join(this.bare, "hooks", "post-receive"), `#!/bin/sh\ncat >> '${this.pushLog}'\n`, 0o755);
    this.git(this.root, "--git-dir", this.bare, "config", "core.hooksPath", path.join(this.bare, "hooks"));

    const seed = path.join(this.root, "seed");
    mkdirSync(seed);
    this.git(seed, "init", "--quiet");
    for (const [file, text] of Object.entries(seedFiles(appRoot))) write(path.join(seed, file), text);
    this.git(seed, "add", "-A");
    this.git(seed, "commit", "--quiet", "--no-verify", "-m", "Installed app");
    this.baseSha = this.git(seed, "rev-parse", "HEAD");
    this.git(seed, "push", "--quiet", "--no-verify", this.bare, "HEAD:refs/heads/main");
    this.git(this.root, "--git-dir", this.bare, "symbolic-ref", "HEAD", "refs/heads/main");
    writeFileSync(this.pushLog, "");
    writeFileSync(this.checkLog, "");
  }

  get env() {
    return {
      PATH: process.env.PATH,
      HOME: this.home,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      CHECK_LOG: this.checkLog,
      GITHUB_API_URL: this.apiUrl ?? "http://127.0.0.1:9",
    };
  }

  /** Runs git and returns its trimmed stdout; throws when it fails. */
  git(cwd, ...args) {
    const result = this.tryGit(cwd, ...args);
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  }

  tryGit(cwd, ...args) {
    return spawnSync("git", args, { cwd, env: this.env, encoding: "utf8" });
  }

  /** Starts the stand-in for GitHub's pull request API. */
  async startGitHub() {
    this.server = createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        const url = new URL(request.url, "http://localhost");
        const body = text ? JSON.parse(text) : undefined;
        this.requests.push({ method: request.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
        const answer = (status, value) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(value));
        };
        if (request.headers.authorization !== `Bearer ${TOKEN}`) return answer(401, { message: "Bad credentials" });
        if (url.pathname === `/repos/${REPOSITORY}` && request.method === "GET") return answer(200, { full_name: REPOSITORY, default_branch: "main" });
        if (url.pathname !== `/repos/${REPOSITORY}/pulls`) return answer(404, { message: "Not Found" });
        const owner = REPOSITORY.split("/")[0];
        if (request.method === "GET") {
          return answer(200, this.pulls.filter((pull) => `${owner}:${pull.head.ref}` === url.searchParams.get("head")));
        }
        if (this.failNextPost) {
          this.failNextPost = false;
          return answer(502, { message: "Server Error" });
        }
        // As GitHub: the head must be a pushed branch, and one open pull request per head.
        if (!this.remoteSha(body.head)) return answer(422, { message: "Validation Failed", errors: [{ message: "head is invalid" }] });
        if (this.pulls.some((pull) => pull.head.ref === body.head)) {
          return answer(422, { message: "Validation Failed", errors: [{ message: `A pull request already exists for ${owner}:${body.head}.` }] });
        }
        const number = this.pulls.length + 1;
        const pull = { number, html_url: `https://github.com/${REPOSITORY}/pull/${number}`, head: { ref: body.head }, base: { ref: body.base }, draft: body.draft, title: body.title };
        this.pulls.push(pull);
        return answer(201, pull);
      });
    });
    await new Promise((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.apiUrl = `http://127.0.0.1:${this.server.address().port}`;
  }

  close() {
    this.server?.close();
    rmSync(this.root, { recursive: true, force: true });
  }

  /** Runs edit-turn.mjs. Asynchronous, because the script calls the stand-in API in this process. */
  turn(args, { cwd = this.clone } = {}) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: existsSync(cwd) ? cwd : this.root, env: this.env });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (status) => {
        assert.ok(!stdout.includes(TOKEN) && !stderr.includes(TOKEN), "the token is never printed");
        let json;
        try {
          json = JSON.parse(stdout);
        } catch {
          json = undefined;
        }
        resolve({ status, stdout, stderr, json });
      });
    });
  }

  /** `begin`, then the app's dependencies as an install would leave them (the stand-in check). */
  async begin({ clone = this.clone, baseSha = this.baseSha, install = true } = {}) {
    this.clone = clone;
    mkdirSync(path.dirname(clone), { recursive: true });
    const result = await this.turn(["begin", "--repository", REPOSITORY, "--app-id", APP_ID, "--session-id", SESSION_ID, "--base-sha", baseSha, "--dir", clone]);
    if (result.status === 0 && install) write(path.join(clone, this.appRoot, "node_modules", ".bin", "console-app"), CONSOLE_APP, 0o755);
    return result;
  }

  app(file) {
    return path.join(this.clone, this.appRoot, file);
  }

  /** Commits everything in the clone, through the sandbox's commit-msg hook as an agent would. */
  commit(message = "Edit") {
    this.git(this.clone, "add", "-A");
    this.git(this.clone, "commit", "--quiet", "-m", message);
    return this.git(this.clone, "rev-parse", "HEAD");
  }

  remoteSha(branch = BRANCH) {
    const result = this.tryGit(this.root, "--git-dir", this.bare, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`);
    return result.status === 0 ? result.stdout.trim() : null;
  }

  /** Every ref update the remote accepted since the installed commit: `<old> <new> <ref>` lines. */
  pushes() {
    return readFileSync(this.pushLog, "utf8").split("\n").filter(Boolean);
  }

  checks() {
    return readFileSync(this.checkLog, "utf8").split("\n").filter(Boolean);
  }

  posts() {
    return this.requests.filter((request) => request.method === "POST");
  }
}

const world = async (t, options) => {
  const w = new World(t, options);
  await w.startGitHub();
  return w;
};

/** Asserts a refused turn: non-zero exit, the reason on stderr, and nothing pushed or opened. */
const assertBlocked = (w, result, reason, { remote = null, pushes = 0 } = {}) => {
  assert.notEqual(result.status, 0, `expected a refusal, got exit 0: ${result.stdout}`);
  assert.match(result.stderr, reason);
  assert.equal(result.stdout, "", "a refused push prints no result");
  assert.equal(w.remoteSha(), remote, "the remote branch did not move");
  assert.equal(w.pushes().length, pushes, "the remote received no push");
  assert.equal(w.posts().length, 0, "no pull request was opened");
};

test("begin branches edit/<appId>/<sessionId> from the installed commit", async (t) => {
  const w = await world(t);
  const result = await w.begin();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.json, { branch: BRANCH, startSha: null, baseSha: w.baseSha, appRoot: "apps/demo", dir: w.clone });
  assert.equal(w.git(w.clone, "rev-parse", "--abbrev-ref", "HEAD"), BRANCH);
  assert.equal(w.git(w.clone, "rev-parse", "HEAD"), w.baseSha);
  assert.equal(w.remoteSha(), null, "begin pushes nothing");
  assert.equal(w.pushes().length, 0);
});

test("begin branches from the installed commit even when main has moved on", async (t) => {
  const w = await world(t);
  const other = path.join(w.root, "other");
  w.git(w.root, "clone", "--quiet", `https://github.com/${REPOSITORY}.git`, other);
  write(path.join(other, "README.md"), "# newer\n");
  w.git(other, "commit", "--quiet", "-am", "Later change on main");
  w.git(other, "push", "--quiet", "--no-verify", "origin", "HEAD:refs/heads/main");
  const result = await w.begin();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(w.git(w.clone, "rev-parse", "HEAD"), w.baseSha);
  assert.notEqual(w.remoteSha("main"), w.baseSha);
});

test("begin refuses malformed or unknown inputs", async (t) => {
  const w = await world(t);
  const begin = (overrides) => {
    const values = { repository: REPOSITORY, "app-id": APP_ID, "session-id": SESSION_ID, "base-sha": w.baseSha, dir: w.clone, ...overrides };
    return w.turn(["begin", ...Object.entries(values).flatMap(([name, value]) => [`--${name}`, value])], { cwd: w.root });
  };
  for (const [overrides, reason] of [
    [{ "app-id": "../main" }, /--app-id may hold only/],
    [{ "session-id": "a/b" }, /--session-id may hold only/],
    [{ "session-id": "a b" }, /--session-id may hold only/],
    [{ "base-sha": w.baseSha.slice(0, 12) }, /full lowercase commit SHA/],
    [{ "base-sha": "main" }, /full lowercase commit SHA/],
    [{ "base-sha": "0123456789abcdef0123456789abcdef01234567" }, /has no commit/],
    [{ repository: "https://github.com/a/b" }, /owner\/repo/],
    [{ "app-id": "another-app" }, /holds no Console app "another-app"/],
  ]) {
    const result = await begin(overrides);
    assert.notEqual(result.status, 0, JSON.stringify(overrides));
    assert.match(result.stderr, reason);
    assert.equal(result.stdout, "");
  }
  assert.equal(w.pushes().length, 0);
});

test("PASS: a clean src/** edit is pushed once with a lease and gets a draft pull request", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Welcome";\n}\n');
  write(w.app("src/pages/home.tsx"), 'export const title = "Home";\n');
  const head = w.commit("Rename the page");

  const result = await w.turn(["push"]);
  assert.equal(result.status, 0, result.stderr);
  const prUrl = `https://github.com/${REPOSITORY}/pull/1`;
  assert.deepEqual(result.json, { branch: BRANCH, sha: head, prUrl });
  assert.equal(w.remoteSha(), head, "the remote branch is the pushed commit");
  assert.deepEqual(w.pushes(), [`${"0".repeat(40)} ${head} refs/heads/${BRANCH}`], "exactly one push, creating the branch");
  assert.deepEqual(w.checks(), ["check"], "console-app check ran once, before the push");
  assert.equal(w.remoteSha("main"), w.baseSha, "the default branch did not move");

  assert.equal(w.posts().length, 1);
  const { body } = w.posts()[0];
  assert.equal(body.draft, true, "the pull request is a draft");
  assert.equal(body.head, BRANCH);
  assert.equal(body.base, "main");
  assert.match(w.git(w.clone, "log", "-1", "--format=%B"), /Co-authored-by: Person <person@example\.com>/, "the sandbox's commit-msg hook still runs");
});

test("PASS: a later turn starts from origin/<branch>, leases on it and reuses the draft pull request", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "One";\n}\n');
  const first = w.commit("Turn one");
  assert.equal((await w.turn(["push"])).status, 0);

  // What an abandoned turn leaves behind in the same clone: an unpushed commit, an edit and a file.
  write(w.app("package.json"), "{}\n");
  w.commit("Never pushed");
  write(w.app("src/app.tsx"), "half an edit\n");
  write(w.app("src/stray.tsx"), "stray\n");

  for (const clone of [w.clone, path.join(w.root, "work", "fresh-microvm")]) {
    const started = w.remoteSha();
    const begun = await w.begin({ clone });
    assert.equal(begun.status, 0, begun.stderr);
    assert.equal(begun.json.startSha, started);
    assert.equal(w.git(clone, "rev-parse", "HEAD"), started, "the turn starts at origin/<branch>");
    assert.equal(w.git(clone, "status", "--porcelain", "--untracked-files=all"), "", "nothing is left from an earlier turn");
    assert.ok(!existsSync(w.app("src/stray.tsx")));

    write(w.app("console-app.json"), `${JSON.stringify({ schemaVersion: "1.0", appId: APP_ID, title: path.basename(clone) }, null, 2)}\n`);
    const head = w.commit(`Turn in ${path.basename(clone)}`);
    const result = await w.turn(["push"]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json, { branch: BRANCH, sha: head, prUrl: `https://github.com/${REPOSITORY}/pull/1` });
    assert.equal(w.pushes().at(-1), `${started} ${head} refs/heads/${BRANCH}`, "the push moved the branch from the turn's starting commit");
  }
  assert.notEqual(w.remoteSha(), first);
  assert.equal(w.pushes().length, 3, "one push per turn");
  assert.equal(w.posts().length, 1, "the pull request was opened once and found afterwards");
  assert.equal(w.pulls.length, 1);
});

test("PASS: an app at the repository root", async (t) => {
  const w = await world(t, { appRoot: "" });
  const begun = await w.begin();
  assert.equal(begun.json.appRoot, ".");
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Root";\n}\n');
  const head = w.commit();
  const result = await w.turn(["push"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(w.remoteSha(), head);

  await w.begin();
  write(w.app("README.md"), "# edited\n");
  w.commit();
  assertBlockedAfterPush(w, await w.turn(["push"]), /README\.md: outside the editable paths/, head);
});

/** As assertBlocked, for a turn after earlier ones pushed: the branch and the log stay as they were. */
const assertBlockedAfterPush = (w, result, reason, remote) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, reason);
  assert.equal(result.stdout, "");
  assert.equal(w.remoteSha(), remote, "the remote branch did not move");
  assert.equal(w.pushes().length, 1, "the remote received no further push");
};

test("BLOCK: a package.json edit, then fixed in the same turn", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Chart";\n}\n');
  const manifest = JSON.parse(readFileSync(w.app("package.json"), "utf8"));
  manifest.dependencies["left-pad"] = "1.3.0";
  write(w.app("package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  w.commit("Add a dependency");

  const blocked = await w.turn(["push"]);
  assertBlocked(w, blocked, /apps\/demo\/package\.json: outside the editable paths \(apps\/demo\/console-app\.json and apps\/demo\/src\/\*\*\)/);
  assert.match(blocked.stderr, /nothing was pushed/);
  assert.deepEqual(w.checks(), [], "the check does not run on a tree the allowlist refuses");

  // Fix in the turn: put the file back as the installed commit has it, in a new commit.
  w.git(w.clone, "checkout", w.baseSha, "--", "apps/demo/package.json");
  const head = w.commit("Drop the dependency");
  const result = await w.turn(["push"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.sha, head);
  assert.equal(w.remoteSha(), head);
  assert.equal(w.pushes().length, 1);
});

test("BLOCK: a symbolic link (git mode 120000) under src/", async (t) => {
  const w = await world(t);
  await w.begin();
  symlinkSync("../package.json", w.app("src/settings.ts"));
  w.commit("Link a file");
  assert.match(w.git(w.clone, "ls-tree", "HEAD", "apps/demo/src/settings.ts"), /^120000 /, "the fixture really is a symbolic link in git");
  const blocked = await w.turn(["push"]);
  assertBlocked(w, blocked, /apps\/demo\/src\/settings\.ts: is a symbolic link; only regular files \(git mode 100644\)/);
  assert.deepEqual(w.checks(), []);
});

test("BLOCK: a submodule (160000) and an executable file (100755) under src/", async (t) => {
  const w = await world(t);
  await w.begin();
  w.git(w.clone, "update-index", "--add", "--cacheinfo", `160000,${w.baseSha},apps/demo/src/vendor`);
  w.git(w.clone, "commit", "--quiet", "-m", "Add a submodule");
  assertBlocked(w, await w.turn(["push"]), /apps\/demo\/src\/vendor: is a submodule/);

  await w.begin();
  write(w.app("src/run.ts"), "export {};\n", 0o755);
  w.commit("Add an executable");
  assertBlocked(w, await w.turn(["push"]), /apps\/demo\/src\/run\.ts: is an executable file/);

  await w.begin();
  chmodSync(w.app("src/app.tsx"), 0o755);
  w.commit("Make a source file executable");
  assertBlocked(w, await w.turn(["push"]), /apps\/demo\/src\/app\.tsx: is an executable file/);
});

test("BLOCK: every path outside console-app.json and src/**", async (t) => {
  const w = await world(t);
  for (const [name, change, reason] of [
    ["build settings", () => write(w.app("tsconfig.json"), "{}\n"), /apps\/demo\/tsconfig\.json: outside the editable paths/],
    ["a new bundler file", () => write(w.app("vite.config.ts"), "export default {};\n"), /apps\/demo\/vite\.config\.ts: outside the editable paths/],
    ["a registry file", () => write(w.app(".npmrc"), "registry=https://example.com\n"), /apps\/demo\/\.npmrc: outside the editable paths/],
    ["the lockfile deleted", () => rmSync(w.app("pnpm-lock.yaml")), /apps\/demo\/pnpm-lock\.yaml: outside the editable paths/],
    ["the workflow", () => write(path.join(w.clone, ".github/workflows/ci.yml"), "name: CI\non: [push]\njobs: {}\n"), /\.github\/workflows\/ci\.yml: outside the editable paths/],
    ["the bundle", () => write(path.join(w.clone, "bundle.json"), "{}\n"), /bundle\.json: outside the editable paths/],
    ["src/ at the repository root", () => write(path.join(w.clone, "src/app.tsx"), "export {};\n"), /^edit-turn: refused: src\/app\.tsx: outside the editable paths/m],
    ["another app's src/", () => write(path.join(w.clone, "apps/other/src/app.tsx"), "export {};\n"), /apps\/other\/src\/app\.tsx: outside the editable paths/],
    ["a look-alike of src/", () => write(w.app("src-extra/app.tsx"), "export {};\n"), /apps\/demo\/src-extra\/app\.tsx: outside the editable paths/],
    ["a look-alike of the settings", () => write(w.app("console-app.json.bak"), "{}\n"), /apps\/demo\/console-app\.json\.bak: outside the editable paths/],
  ]) {
    await w.begin();
    change();
    write(w.app("src/app.tsx"), `export default function App() {\n  return ${JSON.stringify(name)};\n}\n`);
    w.commit(name);
    assertBlocked(w, await w.turn(["push"]), reason);
  }
  assert.deepEqual(w.checks(), []);
});

test("BLOCK: a failing console-app check, then fixed in the same turn", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  fetch("https://example.com");\n  return "Demo";\n}\n');
  w.commit("Call the network");

  const blocked = await w.turn(["push"]);
  assertBlocked(w, blocked, /console-app check failed \(exit 1\)/);
  assert.match(blocked.stderr, /network-call/, "the check's own findings reach the agent");
  assert.deepEqual(w.checks(), ["check"]);
  assert.ok(!existsSync(w.app("dist")), "a failing check leaves no build");

  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Demo, without the call";\n}\n');
  const head = w.commit("Remove the call");
  const result = await w.turn(["push"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(w.remoteSha(), head);
  assert.deepEqual(w.checks(), ["check", "check"]);
  assert.equal(w.pushes().length, 1);
});

test("BLOCK: console-app is not installed, so the check cannot run", async (t) => {
  const w = await world(t);
  await w.begin({ install: false });
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Unchecked";\n}\n');
  w.commit();
  assertBlocked(w, await w.turn(["push"]), /console-app check did not run: apps\/demo\/node_modules\/\.bin\/console-app is missing/);
});

test("BLOCK: uncommitted work, which the check would read but the push would not carry", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Committed";\n}\n');
  w.commit();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Not committed";\n}\n');
  assertBlocked(w, await w.turn(["push"]), /apps\/demo\/src\/app\.tsx: has uncommitted changes/);

  w.git(w.clone, "checkout", "--", ".");
  write(w.app("src/new.tsx"), "export {};\n");
  assertBlocked(w, await w.turn(["push"]), /apps\/demo\/src\/new\.tsx: not committed \(untracked\)/);
  assert.deepEqual(w.checks(), []);
});

test("BLOCK: a plain git push from the clone meets the same gate", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("package.json"), "{}\n");
  const bad = w.commit("Edit package.json");

  const refused = (args, reason) => {
    const result = w.tryGit(w.clone, "push", ...args);
    assert.notEqual(result.status, 0, `git push ${args.join(" ")} must fail`);
    assert.match(result.stderr, reason);
    assert.equal(w.pushes().length, 0, "the remote received no push");
  };
  refused(["origin", `HEAD:refs/heads/${BRANCH}`], /apps\/demo\/package\.json: outside the editable paths/);
  refused(["--force", "origin", `HEAD:refs/heads/${BRANCH}`], /apps\/demo\/package\.json: outside the editable paths/);
  refused(["origin", "HEAD:refs/heads/some-other-branch"], /a turn pushes only edit\/demo\/sess-01, not refs\/heads\/some-other-branch/);
  refused(["origin", `HEAD:refs/heads/${BRANCH}`, "HEAD:refs/heads/second"], /a turn pushes only edit\/demo\/sess-01, not 2 refs/);

  // A clean commit pushed by hand passes the gate; the default branch is still refused by the
  // sandbox's own hook, and a commit that is not checked out is refused because the check reads
  // the worktree.
  w.git(w.clone, "reset", "--quiet", "--hard", w.baseSha);
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "By hand";\n}\n');
  const good = w.commit("Clean edit");
  refused(["origin", "HEAD:refs/heads/main"], /a turn pushes only edit\/demo\/sess-01, not refs\/heads\/main/);
  refused(["origin", `${bad}:refs/heads/${BRANCH}`], /is not the checked-out commit/);
  assert.equal(w.remoteSha("main"), w.baseSha);
  // Uncommitted work is refused by the hook as well: the check would read it, the push would not carry it.
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Edited after the commit";\n}\n');
  refused(["origin", `HEAD:refs/heads/${BRANCH}`], /apps\/demo\/src\/app\.tsx: has uncommitted changes/);
  w.git(w.clone, "checkout", "--", ".");
  assert.deepEqual(w.checks(), [], "nothing so far reached the check");

  const result = w.tryGit(w.clone, "push", "origin", `HEAD:refs/heads/${BRANCH}`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(w.remoteSha(), good);
  assert.deepEqual(w.checks(), ["check"]);
});

test("BLOCK: the sandbox's earlier pre-push hook still runs after the gate", async (t) => {
  const w = await world(t);
  // An Enact hook that refuses everything: the gate passes, the earlier hook still decides.
  write(path.join(w.home, ".enact", "hooks", "pre-push"), '#!/bin/sh\necho "refused by the sandbox hook" >&2\nexit 1\n', 0o755);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Clean";\n}\n');
  w.commit();
  const blocked = await w.turn(["push"]);
  assertBlocked(w, blocked, /refused by the sandbox hook/);
  assert.deepEqual(w.checks(), ["check"], "the gate ran first and passed");
});

test("BLOCK: the lease refuses when the branch moved after the turn began", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Turn one";\n}\n');
  const first = w.commit();
  assert.equal((await w.turn(["push"])).status, 0);

  await w.begin();
  // Someone else moves the branch while this turn works.
  const other = path.join(w.root, "other");
  w.git(w.root, "clone", "--quiet", "--branch", BRANCH, `https://github.com/${REPOSITORY}.git`, other);
  write(path.join(other, "apps/demo/src/app.tsx"), "export default function App() {\n  return 1;\n}\n");
  w.git(other, "commit", "--quiet", "--no-verify", "-am", "Concurrent edit");
  w.git(other, "push", "--quiet", "--no-verify", "origin", `HEAD:refs/heads/${BRANCH}`);
  const theirs = w.git(other, "rev-parse", "HEAD");
  assert.notEqual(theirs, first);

  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Turn two";\n}\n');
  w.commit();
  const blocked = await w.turn(["push"]);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /\[rejected\].*\(stale info\)/, "git's own lease on the starting commit refuses the push");
  assert.equal(blocked.stdout, "");
  assert.equal(w.remoteSha(), theirs, "the other push was not overwritten");
  assert.equal(w.pushes().length, 2, "this turn pushed nothing");

  // A plain forced push of the same commit is refused too: the hook holds the same lease.
  const forced = w.tryGit(w.clone, "push", "--force", "origin", `HEAD:refs/heads/${BRANCH}`);
  assert.notEqual(forced.status, 0);
  assert.match(forced.stderr, /not where this turn started/);
  assert.equal(w.remoteSha(), theirs);
});

test("a turn pushes once: a second commit waits for the next turn, a repeated push changes nothing", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "First";\n}\n');
  const head = w.commit();
  const pushed = await w.turn(["push"]);
  assert.equal(pushed.status, 0, pushed.stderr);

  const again = await w.turn(["push"]);
  assert.equal(again.status, 0, again.stderr);
  assert.deepEqual(again.json, pushed.json, "repeating the push answers the same result");
  assert.deepEqual((await w.turn(["result"])).json, pushed.json);

  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Second";\n}\n');
  w.commit();
  const second = await w.turn(["push"]);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already pushed .*: a turn pushes once/);
  assert.equal(w.remoteSha(), head);
  assert.equal(w.pushes().length, 1);
  assert.equal(w.posts().length, 1);
});

test("a pull request that could not be opened is retried without a second push", async (t) => {
  const w = await world(t);
  await w.begin();
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Pushed";\n}\n');
  const head = w.commit();
  w.failNextPost = true;
  const failed = await w.turn(["push"]);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /GitHub refused the draft pull request \(502\)/);
  assert.equal(failed.stdout, "", "no result is printed for a turn that has no pull request");
  assert.equal(w.remoteSha(), head, "the gate passed and the commit is on the branch");
  assert.deepEqual((await w.turn(["result"])).json, { branch: BRANCH, sha: head, prUrl: null }, "result tells the truth: pushed, no pull request yet");

  const retried = await w.turn(["push"]);
  assert.equal(retried.status, 0, retried.stderr);
  assert.deepEqual(retried.json, { branch: BRANCH, sha: head, prUrl: `https://github.com/${REPOSITORY}/pull/1` });
  assert.equal(w.pushes().length, 1, "the retry did not push again");
  assert.deepEqual(w.checks(), ["check"]);
  assert.equal(w.pulls[0].draft, true);
});

test("a no-op or NEEDS-INFO turn answers sha null and pushes nothing", async (t) => {
  const w = await world(t);
  await w.begin();
  for (const command of ["push", "result"]) {
    const result = await w.turn([command]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json, { branch: BRANCH, sha: null, prUrl: null });
  }
  assert.equal(w.remoteSha(), null);
  assert.equal(w.pushes().length, 0);
  assert.equal(w.posts().length, 0, "no pull request without a pushed branch");

  // Once the session has a draft pull request, a later turn without a change still names it.
  write(w.app("src/app.tsx"), 'export default function App() {\n  return "Changed";\n}\n');
  w.commit();
  const pushed = await w.turn(["push"]);
  await w.begin();
  for (const command of ["push", "result"]) {
    const result = await w.turn([command]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.json, { branch: BRANCH, sha: null, prUrl: pushed.json.prUrl });
  }
  assert.equal(w.pushes().length, 1);
  assert.equal(w.posts().length, 1);
});

test("begin refuses a branch that does not descend from the installed commit", async (t) => {
  const w = await world(t);
  const other = path.join(w.root, "other");
  mkdirSync(other);
  w.git(other, "init", "--quiet");
  write(path.join(other, "README.md"), "unrelated\n");
  w.git(other, "add", "-A");
  w.git(other, "commit", "--quiet", "--no-verify", "-m", "Unrelated history");
  w.git(other, "push", "--quiet", "--no-verify", w.bare, `HEAD:refs/heads/${BRANCH}`);
  const result = await w.begin();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /does not descend from the installed app's commit/);
});
