#!/usr/bin/env node
// One Console Edit Mode turn on an installed app's repository: the branch, the pre-push gate, the
// single push and the draft pull request. The contract is ../reference/edit-mode.md.
//
//   node edit-turn.mjs begin --repository <owner/repo> --app-id <appId> --session-id <sessionId> \
//                            --base-sha <installed app's commit> [--dir <clone>]
//   node edit-turn.mjs bump-kit --kit-version <version> [--dir <clone>]
//                                                # the one allowed package.json and lockfile change
//   node edit-turn.mjs check  [--dir <clone>]    # the gate on HEAD, without pushing
//   node edit-turn.mjs push   [--dir <clone>] [--title <text>] [--body <text>] [--base <branch>]
//   node edit-turn.mjs result [--dir <clone>]    # the turn's result without pushing
//   node edit-turn.mjs pre-push <remote> <url>   # the git hook `begin` installs; not run by hand
//
// `begin`, `bump-kit`, `push` and `result` print one JSON object on stdout; everything else goes to stderr.
// Exit 0 on success, 1 when the gate or a step refuses. Needs only Node.js and git, and pnpm for
// `bump-kit`; it reads the GitHub token for the pull request from git's own credential helper and
// never prints it.
//
// Node standard library only.
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SELF = fileURLToPath(import.meta.url);
const REGULAR_FILE = "100644";
const MODE_NAMES = { 120000: "a symbolic link", 160000: "a submodule", 100755: "an executable file" };
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FULL_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const ABSENT = /^0+$/;
const KIT = "@prism/console-app-kit";
// The first kit version published to each environment's own package registry: an app pinning an
// earlier one cannot install there, so its turn may move the pin to the registry's kit.
const FIRST_REGISTRY_KIT = "1.44.0";
const EXACT_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

class Refusal extends Error {}
const refuse = (message) => {
  throw new Refusal(message);
};

const run = (command, args, { cwd, input, check = true } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) refuse(`${command} could not run: ${result.error.message}`);
  if (check && result.status !== 0) {
    refuse(`${command} ${args.join(" ")} failed (exit ${result.status}): ${result.stderr.trim()}`);
  }
  return result;
};
const git = (cwd, ...args) => run("git", args, { cwd }).stdout.trim();
const gitSucceeds = (cwd, ...args) => run("git", args, { cwd, check: false }).status === 0;
/** Runs a command whose output is for the person reading the turn: all of it goes to stderr. */
const runVisible = (command, args, { cwd, input } = {}) =>
  spawnSync(command, args, {
    cwd,
    input,
    stdio: [input === undefined ? "ignore" : "pipe", 2, 2],
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

// ---- The turn's state: written by `begin` inside the clone's git directory, never in the tree.

const editDir = (dir) => path.join(git(dir, "rev-parse", "--absolute-git-dir"), "console-edit");
const statePath = (dir) => path.join(editDir(dir), "state.json");
const saveState = (dir, state) => writeFileSync(statePath(dir), `${JSON.stringify(state, null, 2)}\n`);
const loadTurn = (from) => {
  const start = path.resolve(from ?? ".");
  if (!gitSucceeds(start, "rev-parse", "--show-toplevel")) refuse(`${start} is not a git clone: run begin first`);
  const dir = git(start, "rev-parse", "--show-toplevel");
  const state = existsSync(statePath(dir)) ? parseJson(readFileSync(statePath(dir), "utf8")) : undefined;
  if (!state) refuse(`${dir} has no Edit Mode turn: run begin first`);
  return { dir, state };
};

// ---- begin

/** A file's text at a commit, or undefined when the commit has no such file. */
const showFile = (dir, rev, file) => {
  const result = run("git", ["show", `${rev}:${file}`], { cwd: dir, check: false });
  return result.status === 0 ? result.stdout : undefined;
};
/** A file's blob id at a commit, or null when the commit has no such file. */
const blobAt = (dir, rev, file) => {
  const result = run("git", ["rev-parse", "--verify", "--quiet", `${rev}:${file}`], { cwd: dir, check: false });
  return result.status === 0 ? result.stdout.trim() : null;
};

/** The app's folder in the repository, read from the installed commit, never from the worktree. */
const findAppRoot = (dir, baseSha, appId) => {
  const show = (file) => parseJson(showFile(dir, baseSha, file) ?? "");
  const roots = [];
  for (const entry of show("bundle.json")?.configurations ?? []) {
    if (entry?.product !== "console" || entry?.kind !== "app" || typeof entry.source !== "string") continue;
    const root = path.posix.normalize(entry.source).replace(/\/+$/, "");
    if (root === "." || root.startsWith("../") || root === ".." || path.posix.isAbsolute(root)) continue;
    roots.push(root);
  }
  roots.push("");
  const found = roots.find((root) => show(path.posix.join(root, "console-app.json"))?.appId === appId);
  if (found === undefined) {
    refuse(`commit ${baseSha} holds no Console app "${appId}": no console-app.json with that appId at the repository root or at a console app source in bundle.json`);
  }
  return found;
};

const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Makes every push from this clone pass the gate. The clone gets its own hooks folder; the hooks
 * the sandbox already had (the default-branch refusal, the co-author trailer) keep running: other
 * hooks are linked, and the gate runs the earlier pre-push hook after it passes.
 */
const installHook = (dir) => {
  run("git", ["config", "--local", "--unset-all", "core.hooksPath"], { cwd: dir, check: false });
  const priorHooksDir = path.resolve(dir, git(dir, "rev-parse", "--git-path", "hooks"));
  const hooksDir = path.join(editDir(dir), "hooks");
  rmSync(hooksDir, { recursive: true, force: true });
  mkdirSync(hooksDir, { recursive: true });
  if (existsSync(priorHooksDir)) {
    for (const name of readdirSync(priorHooksDir)) {
      if (name === "pre-push" || name.endsWith(".sample")) continue;
      symlinkSync(path.join(priorHooksDir, name), path.join(hooksDir, name));
    }
  }
  const hook = path.join(hooksDir, "pre-push");
  writeFileSync(
    hook,
    [
      "#!/bin/sh",
      "# Console Edit Mode: every push from this clone passes the edit-turn gate.",
      `exec ${shellQuote(process.execPath)} ${shellQuote(SELF)} pre-push "$@"`,
      "",
    ].join("\n"),
  );
  chmodSync(hook, 0o755);
  git(dir, "config", "--local", "core.hooksPath", hooksDir);
  return priorHooksDir;
};

const begin = (options) => {
  for (const name of ["repository", "app-id", "session-id", "base-sha"]) {
    if (!options[name]) refuse(`begin needs --${name}`);
  }
  const { repository, "app-id": appId, "session-id": sessionId, "base-sha": baseSha } = options;
  if (!REPOSITORY.test(repository)) refuse(`--repository must be owner/repo, not ${repository}`);
  if (!NAME.test(appId)) refuse(`--app-id may hold only letters, digits, ".", "_" and "-": ${appId}`);
  if (!NAME.test(sessionId)) refuse(`--session-id may hold only letters, digits, ".", "_" and "-": ${sessionId}`);
  if (!FULL_SHA.test(baseSha)) refuse(`--base-sha must be the installed app's full lowercase commit SHA, not ${baseSha}`);
  const branch = `edit/${appId}/${sessionId}`;
  if (!gitSucceeds(process.cwd(), "check-ref-format", "--branch", branch)) refuse(`${branch} is not a valid branch name`);

  const dir = path.resolve(options.dir ?? repository.split("/")[1]);
  if (!existsSync(path.join(dir, ".git"))) {
    run("git", ["clone", "--quiet", `https://github.com/${repository}.git`, dir]);
  }
  const origin = git(dir, "config", "--get", "remote.origin.url")
    .replace(/^(https:\/\/([^@/]+@)?github\.com\/|git@github\.com:)/, "")
    .replace(/\/$/, "")
    .replace(/\.git$/, "");
  if (origin.toLowerCase() !== repository.toLowerCase()) refuse(`${dir} is a clone of ${origin}, not ${repository}`);

  git(dir, "fetch", "--quiet", "--prune", "origin");
  const hasCommit = (sha) => gitSucceeds(dir, "cat-file", "-e", `${sha}^{commit}`);
  if (!hasCommit(baseSha)) run("git", ["fetch", "--quiet", "origin", baseSha], { cwd: dir, check: false });
  if (!hasCommit(baseSha)) refuse(`${repository} has no commit ${baseSha}`);

  const remote = run("git", ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}^{commit}`], { cwd: dir, check: false });
  const startSha = remote.status === 0 ? remote.stdout.trim() : null;
  if (startSha && !gitSucceeds(dir, "merge-base", "--is-ancestor", baseSha, startSha)) {
    refuse(`origin/${branch} (${startSha}) does not descend from the installed app's commit ${baseSha}`);
  }
  const appRoot = findAppRoot(dir, baseSha, appId);

  // The turn starts from the pushed branch, or from the installed commit when there is none yet.
  // Whatever an earlier turn left in the clone, committed or not, is dropped.
  git(dir, "checkout", "--quiet", "--force", "-B", branch, startSha ?? baseSha);
  git(dir, "reset", "--quiet", "--hard", startSha ? `origin/${branch}` : baseSha);
  git(dir, "clean", "--quiet", "-fd");

  mkdirSync(editDir(dir), { recursive: true });
  const priorHooksDir = installHook(dir);
  saveState(dir, { repository, appId, sessionId, branch, baseSha, startSha, appRoot, priorHooksDir, pushedSha: null });
  console.log(JSON.stringify({ branch, startSha, baseSha, appRoot: appRoot || ".", dir }));
};

// ---- The kit bump: the one change to package.json and the lockfile a turn may make

const appFile = (state, name) => (state.appRoot ? `${state.appRoot}/${name}` : name);
const versionParts = (version) => EXACT_VERSION.exec(version)?.slice(1).map(Number);
const compareVersions = (a, b) => {
  const [x, y] = [versionParts(a), versionParts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const canonical = (value) =>
  JSON.stringify(value, (_, v) => (isObject(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));

// What Build's kit gate refuses (prismteam-ai/build src/configuration/console-app.ts), plus `.npmrc`:
// files that would let pnpm install from somewhere else, or with another tool.
const REFUSED_FILES = new Set([
  ".npmrc",
  ".pnpmfile.cjs",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);
const REFUSED_LOCKFILE_SECTIONS = ["overrides", "patchedDependencies", "pnpmfileChecksum", "packageExtensionsChecksum"];
const LOCKFILE_VERSION = "9.0";

/**
 * `{ from, to }` when package.json changes only by moving the kit's exact pin from a version before
 * the registry's first kit to a same-major version the registry has; otherwise `{ problem }`.
 */
const kitBump = (beforeText, afterText) => {
  const [before, after] = [parseJson(beforeText ?? ""), parseJson(afterText ?? "")];
  if (!isObject(before) || !isObject(after)) return { problem: "package.json is not a JSON object" };
  const from = before.dependencies?.[KIT];
  const to = after.dependencies?.[KIT];
  if (typeof from !== "string" || !EXACT_VERSION.test(from) || compareVersions(from, FIRST_REGISTRY_KIT) >= 0) {
    return { problem: `the installed commit pins ${KIT} ${from ?? "nowhere in dependencies"}; only an exact pin before ${FIRST_REGISTRY_KIT} may be bumped` };
  }
  if (typeof to !== "string" || !EXACT_VERSION.test(to)) return { problem: `the new ${KIT} pin must be an exact version, not ${to}` };
  if (compareVersions(to, FIRST_REGISTRY_KIT) < 0) return { problem: `the new ${KIT} pin ${to} must be ${FIRST_REGISTRY_KIT} or later` };
  if (versionParts(to)[0] !== versionParts(from)[0]) {
    return { problem: `${KIT} ${from} to ${to} changes the major version; a kit bump stays in the same major` };
  }
  const rest = (manifest) => {
    const copy = structuredClone(manifest);
    delete copy.dependencies[KIT];
    return canonical(copy);
  };
  if (rest(before) !== rest(after)) return { problem: `package.json changes more than the ${KIT} pin` };
  return { from, to };
};

/**
 * Reads the YAML subset pnpm writes for a lockfile: block mappings, `- ` lists of scalars, flow
 * `{…}` and `[…]`, and plain or quoted scalars, all kept as strings. Anything else throws, so the
 * gate refuses a lockfile it cannot read instead of guessing.
 */
const parseLockfile = (text) => {
  const lines = [];
  for (const [index, raw] of text.split("\n").entries()) {
    if (/^\s*(#.*)?$/.test(raw)) continue;
    const indent = raw.match(/^ */)[0].length;
    if (raw[indent] === "\t") throw new Error(`line ${index + 1}: a tab`);
    lines.push({ number: index + 1, indent, text: raw.slice(indent).replace(/\s+$/, "") });
  }
  const scalar = (source, at, stops) => {
    const quote = source[at];
    if (quote === "'" || quote === '"') {
      let out = "";
      for (let i = at + 1; i < source.length; i += 1) {
        if (source[i] === quote) {
          if (quote === "'" && source[i + 1] === "'") {
            out += "'";
            i += 1;
            continue;
          }
          return [out, i + 1];
        }
        if (quote === '"' && source[i] === "\\") throw new Error(`an escape in "${source}"`);
        out += source[i];
      }
      throw new Error(`an unterminated string in ${source}`);
    }
    let end = at;
    while (end < source.length && !stops.test(source.slice(end))) end += 1;
    return [source.slice(at, end).trim(), end];
  };
  const flow = (source, at) => {
    const skip = (i) => {
      while (source[i] === " ") i += 1;
      return i;
    };
    at = skip(at);
    const open = source[at];
    if (open !== "{" && open !== "[") return scalar(source, at, /^(?:,|\}|\]|$)/);
    const close = open === "{" ? "}" : "]";
    const value = open === "{" ? {} : [];
    let i = skip(at + 1);
    if (source[i] === close) return [value, i + 1];
    for (;;) {
      if (open === "{") {
        const [key, afterKey] = scalar(source, i, /^(?::\s|:$|,|\})/);
        i = skip(afterKey);
        if (source[i] !== ":") throw new Error(`a flow mapping without ":" in ${source}`);
        const [item, afterItem] = flow(source, i + 1);
        if (Object.hasOwn(value, key)) throw new Error(`a repeated key ${key}`);
        value[key] = item;
        i = skip(afterItem);
      } else {
        const [item, afterItem] = flow(source, i);
        value.push(item);
        i = skip(afterItem);
      }
      if (source[i] === close) return [value, i + 1];
      if (source[i] !== ",") throw new Error(`unexpected "${source[i] ?? "end"}" in ${source}`);
      i = skip(i + 1);
    }
  };
  const value = (source, number) => {
    const [item, end] = flow(source, 0);
    if (end !== source.length) throw new Error(`line ${number}: trailing text after a value`);
    return item;
  };
  const block = (start, indent) => {
    if (lines[start].text.startsWith("- ")) {
      const list = [];
      let i = start;
      while (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
        list.push(value(lines[i].text.slice(2), lines[i].number));
        i += 1;
      }
      return [list, i];
    }
    const map = {};
    let i = start;
    while (i < lines.length && lines[i].indent === indent) {
      const { text: line, number } = lines[i];
      const [key, afterKey] = scalar(line, 0, /^(?::\s|:$)/);
      if (line[afterKey] !== ":" || key === "") throw new Error(`line ${number}: not a "key: value" line`);
      if (Object.hasOwn(map, key)) throw new Error(`line ${number}: a repeated key ${key}`);
      const rest = line.slice(afterKey + 1).trim();
      i += 1;
      if (rest) {
        map[key] = value(rest, number);
      } else if (i < lines.length && lines[i].indent > indent) {
        [map[key], i] = block(i, lines[i].indent);
      } else if (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith("- ")) {
        [map[key], i] = block(i, indent);
      } else {
        map[key] = null;
      }
    }
    if (i < lines.length && lines[i].indent > indent) throw new Error(`line ${lines[i].number}: unexpected indentation`);
    return [map, i];
  };
  if (!lines.length) throw new Error("it is empty");
  const [document, end] = block(0, lines[0].indent);
  if (end !== lines.length) throw new Error(`line ${lines[end].number}: unexpected indentation`);
  return document;
};

/** A lockfile dependency version that is not a registry version: `link:`, `file:`, a URL or a path. */
const isLocalOrRemote = (version) =>
  /^(link|file|git|git\+[a-z]+|https?|github|gitlab|bitbucket|npm):/.test(version) || version.includes("://") || version.startsWith(".") || version.startsWith("/");

/**
 * Why a bumped `pnpm-lock.yaml` is not one Build's kit gate would install: the same checks, from
 * prismteam-ai/build src/configuration/console-app.ts, plus a lockfileVersion that stays as the
 * installed commit has it.
 */
const lockfileProblems = (file, text, baseText, version) => {
  const read = (source) => {
    try {
      const parsed = parseLockfile(source ?? "");
      return isObject(parsed) ? { lock: parsed } : { error: "it is not a mapping" };
    } catch (error) {
      return { error: error.message };
    }
  };
  const { lock, error } = read(text);
  if (!lock) return [`${file} is not a pnpm lockfile this gate can read (${error})`];
  const problems = [];
  const base = read(baseText).lock;
  if (String(lock.lockfileVersion) !== LOCKFILE_VERSION || String(base?.lockfileVersion) !== LOCKFILE_VERSION) {
    problems.push(`${file} must keep lockfileVersion '${LOCKFILE_VERSION}', as the installed commit has it, not '${lock.lockfileVersion}'`);
  }
  for (const section of REFUSED_LOCKFILE_SECTIONS) {
    if (lock[section] !== undefined) problems.push(`${file} has ${section}, which could change what the app kit resolves to`);
  }
  const importers = isObject(lock.importers) ? lock.importers : {};
  const extra = Object.keys(importers).filter((name) => name !== ".");
  if (extra.length) problems.push(`${file} has other importers (${extra.join(", ")}); an app is one package`);
  const root = isObject(importers["."]) ? importers["."] : {};
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const [name, entry] of Object.entries(isObject(root[field]) ? root[field] : {})) {
      const resolved = isObject(entry) ? String(entry.version) : "";
      if (isLocalOrRemote(resolved)) problems.push(`${file}: ${name} resolves to ${resolved}, not to a registry version`);
    }
  }
  const kit = isObject(root.dependencies) ? root.dependencies[KIT] : undefined;
  if (!isObject(kit) || kit.specifier !== version || String(kit.version) !== version) {
    problems.push(`${file} must pin ${KIT} to ${version} (specifier and version), as package.json does`);
  }
  const packages = isObject(lock.packages) ? lock.packages : {};
  for (const [key, entry] of Object.entries(packages)) {
    const resolution = isObject(entry) ? entry.resolution : undefined;
    const keys = isObject(resolution) ? Object.keys(resolution) : [];
    if (keys.length !== 1 || keys[0] !== "integrity" || !String(resolution.integrity).startsWith("sha512-")) {
      const from = keys.filter((name) => name !== "integrity").join(", ") || "no integrity";
      problems.push(`${file}: ${key} resolves from ${from}, not from the registry with a sha512 integrity`);
    }
  }
  for (const [key, entry] of Object.entries(isObject(lock.snapshots) ? lock.snapshots : {})) {
    for (const field of ["dependencies", "optionalDependencies"]) {
      for (const [name, edge] of Object.entries(isObject(entry) && isObject(entry[field]) ? entry[field] : {})) {
        if (isLocalOrRemote(String(edge))) problems.push(`${file}: ${key} depends on ${name} at ${String(edge)}, not a registry version`);
      }
    }
  }
  if (!isObject(packages[`${KIT}@${version}`])) problems.push(`${file} has no ${KIT}@${version} package from the registry`);
  return problems;
};

/**
 * Files Build refuses that pnpm would read for this app: anywhere in the app's folder, or in a
 * folder above it, in the tree at `rev`.
 */
const refusedTrackedFiles = (dir, state, rev) =>
  run("git", ["ls-tree", "-r", "-z", "--name-only", rev], { cwd: dir })
    .stdout.split("\0")
    .filter(Boolean)
    .filter((file) => {
      if (!REFUSED_FILES.has(path.posix.basename(file))) return false;
      const folder = path.posix.dirname(file);
      const app = state.appRoot || ".";
      return app === "." || folder === "." || `${app}/`.startsWith(`${folder}/`) || `${folder}/`.startsWith(`${app}/`);
    });

/** Untracked files Build refuses anywhere in the clone, outside node_modules and .git. */
const refusedUntrackedFiles = (dir) => {
  const tracked = new Set(run("git", ["ls-files", "-z"], { cwd: dir }).stdout.split("\0").filter(Boolean));
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(dir, relative), { withFileTypes: true })) {
      const file = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && entry.name !== ".git") walk(file);
      } else if (REFUSED_FILES.has(entry.name) && !tracked.has(file)) {
        found.push(file);
      }
    }
  };
  walk("");
  return found.sort();
};

/**
 * Why package.json and the lockfile at `sha` are not an allowed kit bump: an empty list when they
 * are exactly what `bump-kit` left in this turn, or what an earlier turn of the session pushed,
 * and the lockfile passes Build's kit gate; null when the kit pin did not move, so the change is
 * no kit bump at all.
 */
const kitBumpProblems = (dir, state, sha) => {
  const manifest = appFile(state, "package.json");
  const lockfile = appFile(state, "pnpm-lock.yaml");
  const [beforeText, afterText] = [showFile(dir, state.baseSha, manifest), showFile(dir, sha, manifest)];
  const pin = (text) => parseJson(text ?? "")?.dependencies?.[KIT];
  if (pin(afterText) === pin(beforeText)) return null;
  const bump = kitBump(beforeText, afterText);
  if (bump.problem) return [bump.problem];
  const blobs = { manifest: blobAt(dir, sha, manifest), lockfile: blobAt(dir, sha, lockfile) };
  const madeThisTurn = state.kitBump?.manifest === blobs.manifest && state.kitBump?.lockfile === blobs.lockfile;
  const pushedEarlier =
    Boolean(state.startSha) && blobAt(dir, state.startSha, manifest) === blobs.manifest && blobAt(dir, state.startSha, lockfile) === blobs.lockfile;
  if (!madeThisTurn && !pushedEarlier) return [`${manifest} and ${lockfile} are not as \`edit-turn.mjs bump-kit\` left them`];
  return [
    ...lockfileProblems(lockfile, showFile(dir, sha, lockfile), showFile(dir, state.baseSha, lockfile), bump.to),
    ...refusedTrackedFiles(dir, state, sha).map((file) => `${file} could change what pnpm installs`),
  ];
};

const bumpKit = (options) => {
  const { dir, state } = loadTurn(options.dir);
  const version = options["kit-version"];
  if (!version || !EXACT_VERSION.test(version)) refuse(`--kit-version must be an exact version such as ${FIRST_REGISTRY_KIT}, not ${version ?? "(none)"}`);
  const manifest = appFile(state, "package.json");
  const lockfile = appFile(state, "pnpm-lock.yaml");
  for (const file of [manifest, lockfile]) {
    if (blobAt(dir, state.baseSha, file) === null) refuse(`the installed commit ${state.baseSha} has no ${file}`);
    if (blobAt(dir, "HEAD", file) !== blobAt(dir, state.baseSha, file)) refuse(`${file} already differs from the installed commit ${state.baseSha}`);
    if (git(dir, "status", "--porcelain", "--", file)) refuse(`${file} has uncommitted changes; restore it with git checkout HEAD -- ${file}`);
  }
  const before = showFile(dir, state.baseSha, manifest);
  const planned = parseJson(before ?? "");
  if (!isObject(planned) || !isObject(planned.dependencies) || !(KIT in planned.dependencies)) refuse(`${manifest} has no ${KIT} in dependencies`);
  planned.dependencies[KIT] = version;
  const plan = kitBump(before, JSON.stringify(planned));
  if (plan.problem) refuse(`no kit bump: ${plan.problem}`);
  const refusedFiles = [...refusedTrackedFiles(dir, state, "HEAD"), ...refusedUntrackedFiles(dir)];
  if (refusedFiles.length) refuse(`no kit bump: ${refusedFiles.join(", ")} could change what pnpm installs; remove them first`);

  // From here on, whatever pnpm changed in tracked files is put back unless the bump is accepted.
  const restore = () => {
    const changed = run("git", ["status", "--porcelain", "-z", "--untracked-files=no"], { cwd: dir })
      .stdout.split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3));
    if (changed.length) run("git", ["checkout", "HEAD", "--", ...changed], { cwd: dir });
    return changed;
  };
  const fail = (message) => {
    restore();
    refuse(`${message}; ${manifest} and ${lockfile} are back as they were`);
  };
  // The kit and the console-app command need no install scripts; Build installs apps the same way.
  const added = runVisible("pnpm", ["add", "-E", "--ignore-scripts", `${KIT}@${version}`], { cwd: path.join(dir, state.appRoot) });
  if (added.error || added.status !== 0) fail(`pnpm add -E --ignore-scripts ${KIT}@${version} failed${added.error ? `: ${added.error.message}` : ` (exit ${added.status})`}`);

  const changed = run("git", ["status", "--porcelain", "-z", "--untracked-files=no"], { cwd: dir })
    .stdout.split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3));
  const others = changed.filter((file) => file !== manifest && file !== lockfile);
  if (others.length) fail(`pnpm add changed ${others.join(", ")} as well`);
  const made = kitBump(before, readFileSync(path.join(dir, manifest), "utf8"));
  if (made.problem) fail(`pnpm add left ${manifest} unlike a kit bump: ${made.problem}`);
  const problems = lockfileProblems(lockfile, readFileSync(path.join(dir, lockfile), "utf8"), showFile(dir, state.baseSha, lockfile), version);
  if (problems.length) {
    report(problems);
    fail(`pnpm add left ${lockfile} unlike Build's kit gate accepts`);
  }
  state.kitBump = { version, manifest: git(dir, "hash-object", "--", manifest), lockfile: git(dir, "hash-object", "--", lockfile) };
  saveState(dir, state);
  console.log(JSON.stringify({ from: made.from, to: made.to, files: [manifest, lockfile] }));
};

// ---- The gate

const editablePaths = (state) => {
  const prefix = state.appRoot ? `${state.appRoot}/` : "";
  return { settings: `${prefix}console-app.json`, source: `${prefix}src/` };
};
const isEditable = (state, file) => {
  const { settings, source } = editablePaths(state);
  return file === settings || file.startsWith(source);
};

/** What must hold for the check to have read exactly the commit: nothing uncommitted it could read. */
const worktreeProblems = (dir, state) => {
  const problems = [];
  const status = run("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: dir }).stdout;
  const entries = status.split("\0").filter(Boolean);
  for (let index = 0; index < entries.length; index += 1) {
    const code = entries[index].slice(0, 2);
    const file = entries[index].slice(3);
    if (code[0] === "R" || code[0] === "C") index += 1; // the next entry is the path it came from
    if (code === "??" && !isEditable(state, file)) continue; // build output and the like
    problems.push(`${file}: ${code === "??" ? "not committed (untracked)" : "has uncommitted changes"}; commit or discard it`);
  }
  return problems;
};

/** Every change between the installed commit and `sha` that an Edit Mode session may not make. */
const pathProblems = (dir, state, sha) => {
  if (!gitSucceeds(dir, "merge-base", "--is-ancestor", state.baseSha, sha)) {
    return [`${sha} does not descend from the installed app's commit ${state.baseSha}`];
  }
  const { settings, source } = editablePaths(state);
  const fields = run("git", ["diff-tree", "-r", "-z", "--no-renames", state.baseSha, sha], { cwd: dir }).stdout.split("\0");
  const problems = [];
  const bumpFiles = new Set([appFile(state, "package.json"), appFile(state, "pnpm-lock.yaml")]);
  const bumped = [];
  let bumpReasons;
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const [, newMode, , , status] = fields[index].slice(1).split(" ");
    const file = fields[index + 1];
    // package.json and the lockfile are outside the editable paths too, except for the kit bump
    // `bump-kit` makes; its reasons are reported once, below, for both files.
    if (bumpFiles.has(file) && status !== "D" && (bumpReasons ??= kitBumpProblems(dir, state, sha)) !== null) {
      bumped.push(file);
    } else if (!isEditable(state, file)) {
      problems.push(`${file}: outside the editable paths (${settings} and ${source}**); restore it to the installed commit`);
    } else if (status !== "D" && REFUSED_FILES.has(path.posix.basename(file))) {
      problems.push(`${file}: could change what pnpm installs; remove it`);
    }
    if (status !== "D" && newMode !== REGULAR_FILE) {
      problems.push(`${file}: is ${MODE_NAMES[newMode] ?? `git mode ${newMode}`}; only regular files (git mode ${REGULAR_FILE}) are allowed`);
    }
  }
  for (const reason of bumped.length ? bumpReasons : []) {
    problems.push(`${bumped.join(" and ")}: outside the editable paths, and not an allowed kit bump: ${reason}; restore ${bumped.length > 1 ? "them" : "it"} to the installed commit`);
  }
  return problems;
};

const checkProblems = (dir, state) => {
  const appDir = path.join(dir, state.appRoot);
  const command = path.join(appDir, "node_modules", ".bin", "console-app");
  if (!existsSync(command)) {
    return [`console-app check did not run: ${path.relative(dir, command)} is missing; install the app's dependencies exactly as its lockfile pins them`];
  }
  const result = runVisible(command, ["check"], { cwd: appDir });
  if (result.error) return [`console-app check could not run: ${result.error.message}`];
  return result.status === 0 ? [] : [`console-app check failed (exit ${result.status}); its findings are above`];
};

/** The whole gate on a commit that is checked out. An empty list means the commit may be pushed. */
const gate = (dir, state, sha) => {
  const head = git(dir, "rev-parse", "HEAD");
  if (head !== sha) return [`${sha} is not the checked-out commit (${head}); the check reads the worktree, so push HEAD`];
  const problems = [...pathProblems(dir, state, sha), ...worktreeProblems(dir, state)];
  // The check runs only on a tree that is otherwise allowed: it builds what it reads.
  return problems.length ? problems : checkProblems(dir, state);
};

const report = (problems) => {
  for (const problem of problems) console.error(`edit-turn: refused: ${problem}`);
};

const check = (options) => {
  const { dir, state } = loadTurn(options.dir);
  const sha = git(dir, "rev-parse", "HEAD");
  const problems = gate(dir, state, sha);
  report(problems);
  console.log(JSON.stringify({ ok: problems.length === 0, sha, problems }));
  if (problems.length) process.exitCode = 1;
};

// ---- pre-push (the hook)

const isExecutable = (file) => {
  try {
    accessSync(file, constants.X_OK);
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

const prePush = (hookArgs) => {
  const input = readFileSync(0, "utf8");
  // Git points hooks at the repository through these; the commands below find it from the clone.
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX"]) delete process.env[name];
  const { dir, state } = loadTurn(process.cwd());
  const updates = input.split("\n").filter(Boolean).map((line) => line.split(" "));
  if (updates.length > 1) refuse(`a turn pushes only ${state.branch}, not ${updates.length} refs`);
  for (const [, localSha, remoteRef, remoteSha] of updates) {
    if (remoteRef !== `refs/heads/${state.branch}`) refuse(`a turn pushes only ${state.branch}, not ${remoteRef}`);
    if (ABSENT.test(localSha)) refuse(`a turn never deletes ${state.branch}`);
    const remoteNow = ABSENT.test(remoteSha) ? null : remoteSha;
    if (remoteNow !== state.startSha) {
      refuse(`${state.branch} is at ${remoteNow ?? "no commit"} on the remote, not where this turn started (${state.startSha ?? "no commit"}): a turn pushes once, onto its starting commit`);
    }
    const problems = gate(dir, state, localSha);
    if (problems.length) {
      report(problems);
      refuse("nothing was pushed");
    }
  }
  const prior = path.join(state.priorHooksDir, "pre-push");
  if (isExecutable(prior)) {
    const result = runVisible(prior, hookArgs, { cwd: dir, input });
    if (result.status !== 0) process.exitCode = result.status ?? 1;
  }
};

// ---- The pull request

const github = async (dir, state, method, route, body) => {
  const filled = run("git", ["credential", "fill"], {
    cwd: dir,
    input: `protocol=https\nhost=github.com\npath=${state.repository}.git\n\n`,
    check: false,
  });
  const token = filled.stdout.split("\n").find((line) => line.startsWith("password="))?.slice("password=".length);
  if (!token) refuse(`git has no GitHub credential for ${state.repository}, so the pull request cannot be read or opened`);
  const base = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/, "");
  const response = await fetch(`${base}/repos/${state.repository}${route}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-github-api-version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
};

const findPullRequest = async (dir, state) => {
  const owner = state.repository.split("/")[0];
  const query = new URLSearchParams({ state: "open", head: `${owner}:${state.branch}`, per_page: "100" });
  const { status, body } = await github(dir, state, "GET", `/pulls?${query}`);
  if (status !== 200 || !Array.isArray(body)) refuse(`GitHub refused to list pull requests (${status}): ${body.message ?? ""}`);
  return body.find((pull) => pull.head?.ref === state.branch)?.html_url ?? null;
};

/** The repository's default branch, from GitHub: a clone does not always know it. */
const defaultBranch = async (dir, state) => {
  const { status, body } = await github(dir, state, "GET", "");
  if (status !== 200 || typeof body.default_branch !== "string") {
    refuse(`GitHub refused to name the repository's default branch (${status}): ${body.message ?? ""}`);
  }
  return body.default_branch;
};

const findOrCreateDraft = async (dir, state, options) => {
  const existing = await findPullRequest(dir, state);
  if (existing) return existing;
  const { status, body } = await github(dir, state, "POST", "/pulls", {
    title: options.title ?? `Edit ${state.appId} (session ${state.sessionId})`,
    head: state.branch,
    base: options.base ?? (await defaultBranch(dir, state)),
    body:
      options.body ??
      `Console Edit Mode session \`${state.sessionId}\` for the app \`${state.appId}\`, started from the installed commit ${state.baseSha}.\n\nThis stays a draft while the session is open. Mark it ready for review to run validation, then merge it to deliver the change.`,
    draft: true,
  });
  if (status === 201) return body.html_url;
  // Opened by someone else between the look-up and the request.
  const raced = status === 422 ? await findPullRequest(dir, state) : null;
  if (raced) return raced;
  const detail = [body.message, ...(body.errors ?? []).map((error) => error.message)].filter(Boolean).join("; ");
  refuse(`GitHub refused the draft pull request (${status}): ${detail}`);
};

// ---- push and result

const push = async (options) => {
  const { dir, state } = loadTurn(options.dir);
  const head = git(dir, "rev-parse", "HEAD");
  const { branch } = state;
  if (state.pushedSha && state.pushedSha !== head) {
    refuse(`this turn already pushed ${state.pushedSha}: a turn pushes once. Leave later commits for the next turn`);
  }
  if (!state.pushedSha) {
    // Refused here before git is asked to push, so a turn without a new commit is never reported
    // as a no-op while work lies uncommitted; the hook runs the whole gate again on the push.
    const problems = [...pathProblems(dir, state, head), ...worktreeProblems(dir, state)];
    if (problems.length) {
      report(problems);
      refuse("nothing was pushed");
    }
    if (head === (state.startSha ?? state.baseSha)) {
      console.log(JSON.stringify({ branch, sha: null, prUrl: state.startSha ? await findPullRequest(dir, state) : null }));
      return;
    }
    const pushed = runVisible(
      "git",
      ["push", `--force-with-lease=${branch}:${state.startSha ?? ""}`, "origin", `HEAD:refs/heads/${branch}`],
      { cwd: dir },
    );
    if (pushed.status !== 0) refuse("nothing was pushed: git push was refused, for the reason above");
    state.pushedSha = head;
    saveState(dir, state);
  }
  const prUrl = await findOrCreateDraft(dir, state, options);
  console.log(JSON.stringify({ branch, sha: head, prUrl }));
};

const result = async (options) => {
  const { dir, state } = loadTurn(options.dir);
  const onRemote = state.pushedSha ?? state.startSha;
  console.log(JSON.stringify({ branch: state.branch, sha: state.pushedSha, prUrl: onRemote ? await findPullRequest(dir, state) : null }));
};

// ---- Command line

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "pre-push") return prePush(rest);
  const { values } = parseArgs({
    args: rest,
    options: Object.fromEntries(
      ["repository", "app-id", "session-id", "base-sha", "kit-version", "dir", "title", "body", "base"].map((name) => [name, { type: "string" }]),
    ),
  });
  if (command === "begin") return begin(values);
  if (command === "bump-kit") return bumpKit(values);
  if (command === "check") return check(values);
  if (command === "push") return push(values);
  if (command === "result") return result(values);
  refuse(`unknown command ${command ?? "(none)"}: use begin, bump-kit, check, push or result`);
};

try {
  await main();
} catch (error) {
  if (!(error instanceof Refusal) && error?.code !== "ERR_PARSE_ARGS_UNKNOWN_OPTION") throw error;
  console.error(`edit-turn: ${error.message}`);
  process.exitCode = 1;
}
