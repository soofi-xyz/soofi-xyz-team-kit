#!/usr/bin/env node
// Runs the Enact move tests (T3 golden tasks, T4 Slowking reference, T5 routing) through the
// Enact MCP endpoint, or validates the test files only (--dry-run, or no credentials).
// Node stdlib only. See enact/tests/README.md.
//
//   node scripts/run-enact-tests.mjs --dry-run
//   ENACT_URL=https://<shared domain> ENACT_API_KEY=... node scripts/run-enact-tests.mjs --tests T3,T5 --gates repositories,browser
//   node scripts/run-enact-tests.mjs --record-reference slowking-t4-x-engagement path/to/editor-run.md --editor "Claude Code"

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS = join(ROOT, 'enact', 'tests');
const KINDS = ['report', 'pr', 'config-readback'];
const GATES = ['repositories', 'browser', 'secret-injection', 'remote-mcp'];
const DIMENSIONS = {
  functional_outcome: 'functional outcome',
  runtime_demo_quality: 'runtime & demo quality',
  evidence_quality: 'evidence quality',
  access_boundary_compliance: 'access-boundary compliance',
  implementation_quality: 'implementation quality',
  kit_usage_conformance: 'kit-usage conformance',
  reproducibility: 'reproducibility',
  speed: 'speed',
};
const T4_TOLERANCE = 5;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { tests: ['T3', 'T4', 'T5'], gates: ['repositories', 'browser'], repeat: 2, concurrency: 3, poll: 10 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--tests') args.tests = next().split(',').map((s) => s.trim().toUpperCase());
    else if (a === '--gates') args.gates = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--agent') args.agents = next().split(',').map((s) => s.trim());
    else if (a === '--repeat') args.repeat = Number(next());
    else if (a === '--concurrency') args.concurrency = Number(next());
    else if (a === '--poll-seconds') args.poll = Number(next());
    else if (a === '--out') args.out = next();
    else if (a === '--record-reference') args.record = { id: next(), file: next() };
    else if (a === '--editor') args.editor = next();
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown argument ${a}`);
  }
  for (const g of args.gates) if (!GATES.includes(g)) throw new Error(`unknown gate ${g}; known: ${GATES.join(', ')}`);
  return args;
}

// ---------------------------------------------------------------- loading and validation

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function loadAgents() {
  const agents = {};
  for (const f of readdirSync(join(ROOT, 'agents')).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(join(ROOT, 'agents', f), 'utf8');
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    const name = fm?.[1].match(/^name:\s*(.+)$/m)?.[1].trim();
    let description = fm?.[1].match(/^description:\s*(.+)$/m)?.[1].trim() ?? '';
    description = description.replace(/^["']|["']$/g, '');
    if (name) agents[name] = { name, description };
  }
  return agents;
}

function loadAll() {
  const plan = readJson(join(TESTS, 'plan.json'));
  const agents = loadAgents();
  const stays = new Set(plan.stays_local);
  const waveOf = {};
  for (const [w, list] of Object.entries(plan.waves)) for (const a of list) waveOf[a] = w;
  for (const a of Object.values(agents)) {
    if (stays.has(a.name)) continue;
    a.group = waveOf[a.name] ?? (/^\w+ configurer\./.test(a.description) ? 'configurers'
      : /^\w+ builder\./.test(a.description) ? 'builders' : 'specialists');
  }
  const enact = Object.values(agents).filter((a) => !stays.has(a.name));
  const goldenDir = join(TESTS, 'golden');
  const golden = {};
  for (const f of readdirSync(goldenDir).filter((f) => f.endsWith('.json'))) {
    golden[f.replace(/\.json$/, '')] = { file: join(goldenDir, f), doc: readJson(join(goldenDir, f)) };
  }
  const routing = readJson(join(TESTS, 'routing', 'labeled-requests.json'));
  return { plan, agents, stays, enact, golden, routing };
}

function validate({ plan, agents, stays, enact, golden, routing }) {
  const errors = [];
  const err = (m) => errors.push(m);
  for (const a of plan.stays_local) if (!agents[a]) err(`plan.json: stays-local agent ${a} has no agents/${a}.md`);
  for (const [w, list] of Object.entries(plan.waves)) for (const a of list) {
    if (!agents[a]) err(`plan.json: wave ${w} agent ${a} has no agents/${a}.md`);
    if (stays.has(a)) err(`plan.json: wave ${w} agent ${a} is stays-local`);
  }
  const enactNames = new Set(enact.map((a) => a.name));
  for (const a of enact) if (!golden[a.name]) err(`golden: missing enact/tests/golden/${a.name}.json`);
  for (const name of Object.keys(golden)) if (!enactNames.has(name)) err(`golden/${name}.json: not an Enact-hosted agent`);

  const ids = new Set();
  let taskCount = 0;
  for (const [name, { doc }] of Object.entries(golden)) {
    const where = `golden/${name}.json`;
    const agent = agents[name];
    if (doc.agent !== name) err(`${where}: agent must be "${name}"`);
    const tasks = Array.isArray(doc.tasks) ? doc.tasks : [];
    if (tasks.length < 2 || tasks.length > 3) err(`${where}: needs 2-3 tasks, has ${tasks.length}`);
    for (const t of tasks) {
      taskCount++;
      const at = `${where} ${t.id ?? '<no id>'}`;
      if (typeof t.id !== 'string' || !t.id.startsWith(`${name}-`)) err(`${at}: id must start with "${name}-"`);
      if (ids.has(t.id)) err(`${at}: duplicate id`);
      ids.add(t.id);
      if (typeof t.message !== 'string' || !t.message.trim()) err(`${at}: message must be a non-blank string`);
      else if (Buffer.byteLength(t.message) > 64 * 1024) err(`${at}: message exceeds 64 KiB`);
      if (!Array.isArray(t.repositories) || t.repositories.some((r) => !REPO.test(r))) err(`${at}: repositories must be owner/repo strings`);
      const e = t.expect ?? {};
      if (!KINDS.includes(e.kind)) err(`${at}: expect.kind must be one of ${KINDS.join(', ')}`);
      for (const f of ['must_include', 'must_not', 'tools_in_trace']) {
        if (!Array.isArray(e[f]) || e[f].some((s) => typeof s !== 'string' || !s.trim())) err(`${at}: expect.${f} must be an array of strings`);
      }
      if (!e.must_include?.length) err(`${at}: expect.must_include is empty`);
      if (!e.tools_in_trace?.length) err(`${at}: expect.tools_in_trace is empty`);
      for (const s of [...(e.must_include ?? []), ...(e.must_not ?? [])]) {
        if (s.startsWith('re:')) try { new RegExp(s.slice(3), 'i'); } catch { err(`${at}: bad regex ${s}`); }
      }
      if (typeof e.forbids_repo_writes !== 'boolean') err(`${at}: expect.forbids_repo_writes must be boolean`);
      const l = t.limits ?? {};
      if (!(l.max_cost_usd > 0 && l.max_cost_usd <= 1000)) err(`${at}: limits.max_cost_usd must be in (0, 1000]`);
      if (!(l.max_minutes > 0 && l.max_minutes <= 120)) err(`${at}: limits.max_minutes must be in (0, 120]`);
      for (const g of t.requires ?? []) if (!GATES.includes(g)) err(`${at}: unknown gate ${g}`);
      // Story rules.
      const group = agent?.group;
      if (group === '1a' || group === '1b') {
        if (e.kind !== 'report' || e.forbids_repo_writes !== true) err(`${at}: wave ${group} is read-only: kind report, forbids_repo_writes true`);
      }
      if (group === 'configurers' && e.kind !== 'config-readback') err(`${at}: configurers use kind config-readback`);
      if (group === 'builders' && e.kind !== 'pr') err(`${at}: builders use kind pr`);
      if (e.kind === 'pr') {
        if (e.forbids_repo_writes !== false) err(`${at}: kind pr must allow repo writes`);
        if (!t.repositories?.length) err(`${at}: kind pr needs a repository`);
        if (!(t.requires ?? []).includes('repositories')) err(`${at}: kind pr requires the repositories gate`);
        if (!e.must_not.some((s) => /default branch/i.test(s))) err(`${at}: kind pr must forbid pushing to the default branch`);
      } else if (e.forbids_repo_writes !== true) err(`${at}: kind ${e.kind} must forbid repo writes`);
      if (e.kind === 'config-readback' && !(t.requires ?? []).includes('secret-injection')) err(`${at}: config-readback requires the secret-injection gate`);
      if (t.test === 'T4') {
        const r = t.reference_run;
        if (!r || typeof r !== 'object') err(`${at}: T4 task needs reference_run`);
        else {
          if (!['TO_RECORD', 'RECORDED'].includes(r.status)) err(`${at}: reference_run.status must be TO_RECORD or RECORDED`);
          for (const d of Object.keys(DIMENSIONS)) if (!(d in (r.scorecard ?? {}))) err(`${at}: reference_run.scorecard.${d} missing`);
          if (r.status === 'RECORDED') {
            for (const d of Object.keys(DIMENSIONS)) if (typeof r.scorecard[d] !== 'number') err(`${at}: recorded reference needs scorecard.${d}`);
            for (const [k, v] of Object.entries(r.inputs ?? {})) if (k !== 'credentials_note' && !v) err(`${at}: recorded reference needs inputs.${k}`);
          }
        }
      }
    }
  }
  if (!golden.slowking?.doc.tasks?.some((t) => t.test === 'T4')) err('golden/slowking.json: needs a T4 benchmark task');

  // Routing (T5).
  const reqs = routing.requests ?? [];
  if (reqs.length !== 50) err(`routing: needs exactly 50 requests, has ${reqs.length}`);
  const rids = new Set();
  let nearMiss = 0;
  for (const r of reqs) {
    const at = `routing ${r.id}`;
    if (rids.has(r.id)) err(`${at}: duplicate id`);
    rids.add(r.id);
    if (!r.request?.trim()) err(`${at}: blank request`);
    if (stays.has(r.expected)) err(`${at}: labeled with stays-local agent ${r.expected}`);
    else if (!enactNames.has(r.expected)) err(`${at}: ${r.expected} is not an Enact-hosted agent`);
    if (r.expected === routing.router) err(`${at}: the router cannot be a label`);
    if (agents[r.expected] && r.wave !== agents[r.expected].group) err(`${at}: wave ${r.wave} should be ${agents[r.expected].group}`);
    if (r.near_miss) {
      nearMiss++;
      if (!agents[r.confusable_with]) err(`${at}: confusable_with ${r.confusable_with} is not an agent`);
    }
  }
  if (nearMiss < 8) err(`routing: needs at least 8 near-miss requests, has ${nearMiss}`);
  const waves = {};
  for (const r of reqs) waves[r.wave] = (waves[r.wave] ?? 0) + 1;
  const groups = {};
  for (const a of enact) groups[a.group] = (groups[a.group] ?? 0) + 1;
  return { errors, summary: { enact_agents: enact.length, golden_files: Object.keys(golden).length, tasks: taskCount,
    agents_per_group: groups, routing_requests: reqs.length, routing_per_wave: waves, near_misses: nearMiss } };
}

// ---------------------------------------------------------------- Enact MCP client

function mcpClient(baseUrl, apiKey) {
  const url = `${baseUrl.replace(/\/+$/, '')}/enact/mcp`;
  let nextId = 1;
  async function rpc(method, params, notification = false) {
    const body = { jsonrpc: '2.0', method, ...(params ? { params } : {}), ...(notification ? {} : { id: nextId++ }) };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (notification) return null;
    const text = await res.text();
    if (!res.ok && !text) throw new Error(`${method}: HTTP ${res.status}`);
    let msg;
    if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
      msg = data.map((d) => JSON.parse(d)).find((m) => m.id === body.id);
    } else {
      try { msg = JSON.parse(text); } catch { throw new Error(`${method}: HTTP ${res.status}, not a JSON-RPC answer (is ENACT_URL the shared domain?)`); }
    }
    if (!msg) throw new Error(`${method}: no response (HTTP ${res.status})`);
    if (msg.error) throw new Error(`${method}: ${msg.error.code} ${msg.error.message}`);
    return msg.result;
  }
  async function call(name, args = {}) {
    const result = await rpc('tools/call', { name, arguments: args });
    const payload = result.structuredContent ?? JSON.parse(result.content?.find((c) => c.type === 'text')?.text ?? 'null');
    if (result.isError) {
      const e = new Error(`${name}: ${payload?.code ?? 'error'} ${payload?.message ?? ''}`.trim());
      e.payload = payload;
      throw e;
    }
    return payload;
  }
  return {
    async init() {
      await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'run-enact-tests', version: '1' } });
      await rpc('notifications/initialized', undefined, true);
    },
    call,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOnce(client, agent, message, { repositories = [], maxCost, maxMinutes, poll }) {
  const args = { name: agent, message };
  if (repositories.length) args.repositories = repositories;
  if (maxCost) args.limits = { max_cost_usd: maxCost };
  let started;
  const notes = [];
  try {
    started = await client.call('start_run', args);
  } catch (e) {
    // A task limit above the manifest's is refused (INVALID_RUN); run under the manifest's own.
    if (args.limits && e.payload?.code === 'INVALID_RUN') {
      delete args.limits;
      notes.push('task max_cost_usd above the manifest limit; ran under the manifest limit');
      started = await client.call('start_run', args);
    } else throw e;
  }
  const deadline = Date.now() + (maxMinutes + 10) * 60_000;
  let run = started;
  while (!['SUCCEEDED', 'FAILED'].includes(run.status)) {
    if (Date.now() > deadline) { notes.push('runner stopped polling at max_minutes + 10'); break; }
    await sleep(poll * 1000);
    run = await client.call('get_run', { run_id: started.run_id });
  }
  return {
    run_id: run.run_id, session_id: run.session_id, status: run.status, version: run.version,
    cost_usd: run.cost_usd ?? null, duration_ms: run.duration_ms ?? null, turns: run.turns ?? null,
    tool_calls: run.tool_calls ?? null, manifest_limits: run.limits ?? null, error: run.error ?? null,
    trace: run.trace ?? null, result: run.result ?? '', result_truncated: !!run.result_truncated, notes,
  };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, size) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

const median = (xs) => {
  const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

function checkExpect(expect, result) {
  const auto = [];
  const review = [];
  for (const s of expect.must_include) {
    if (s.startsWith('re:')) auto.push({ must_include: s, ok: new RegExp(s.slice(3), 'i').test(result) });
    else review.push({ must_include: s });
  }
  for (const s of expect.must_not) {
    if (s.startsWith('re:')) auto.push({ must_not: s, ok: !new RegExp(s.slice(3), 'i').test(result) });
    else review.push({ must_not: s });
  }
  if (expect.kind === 'pr' && !expect.must_include.some((s) => s.startsWith('re:'))) {
    auto.push({ must_include: 'a pull request URL', ok: /https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(result) });
  }
  return { auto, review, tools_in_trace: { expected: expect.tools_in_trace, status: 'check in the Persist trace' } };
}

const gateOpen = (task, gates) => (task.requires ?? []).every((g) => gates.includes(g));
const fill = (message, inputs) => message.replace(/\{\{(\w+)\}\}/g, (_, k) => inputs?.[k] ?? '');

// ---------------------------------------------------------------- T3, T4, T5

async function runT3(client, loaded, args, available) {
  const tasks = [];
  for (const [agent, { doc }] of Object.entries(loaded.golden)) {
    if (args.agents && !args.agents.includes(agent)) continue;
    for (const t of doc.tasks) if (t.test !== 'T4') tasks.push({ agent, t });
  }
  const results = await pool(tasks, args.concurrency, async ({ agent, t }) => {
    const base = { id: t.id, agent, kind: t.expect.kind, limits: t.limits };
    if (!available.has(agent)) return { ...base, status: 'SKIPPED', reason: 'agent not on Enact' };
    if (!gateOpen(t, args.gates)) return { ...base, status: 'SKIPPED', reason: `gate closed: ${(t.requires ?? []).filter((g) => !args.gates.includes(g)).join(', ')}` };
    const runs = [];
    for (let i = 0; i < args.repeat; i++) { // twice in a row: one after the other
      try {
        const r = await runOnce(client, agent, t.message, { repositories: t.repositories, maxCost: t.limits.max_cost_usd, maxMinutes: t.limits.max_minutes, poll: args.poll });
        r.checks = checkExpect(t.expect, r.result);
        r.within_limits = (r.cost_usd ?? Infinity) <= t.limits.max_cost_usd && (r.duration_ms ?? Infinity) <= t.limits.max_minutes * 60_000;
        r.pass = r.status === 'SUCCEEDED' && r.checks.auto.every((c) => c.ok) && r.within_limits;
        r.result = r.result.slice(0, 20_000);
        runs.push(r);
      } catch (e) { runs.push({ status: 'ERROR', error: String(e.message ?? e), pass: false }); }
    }
    const cost = median(runs.map((r) => r.cost_usd));
    const minutes = median(runs.map((r) => (r.duration_ms == null ? null : r.duration_ms / 60_000)));
    const manifestCost = median(runs.map((r) => r.manifest_limits?.max_cost_usd));
    return {
      ...base, runs,
      median_cost_usd: cost, median_minutes: minutes,
      against_limits: {
        task_cost: cost != null && cost <= t.limits.max_cost_usd,
        task_minutes: minutes != null && minutes <= t.limits.max_minutes,
        manifest_cost: manifestCost == null ? null : cost != null && cost <= manifestCost,
        manifest_max_cost_usd: manifestCost,
      },
      status: runs.length === args.repeat && runs.every((r) => r.pass) ? 'PASS' : 'FAIL',
      needs_review: runs.some((r) => r.checks?.review?.length),
    };
  });
  const ran = results.filter((r) => r.status !== 'SKIPPED');
  return { tasks: results, summary: { ran: ran.length, passed: ran.filter((r) => r.status === 'PASS').length,
    skipped: results.length - ran.length, pass: ran.length ? ran.every((r) => r.status === 'PASS') : null } };
}

function parseScorecard(markdown) {
  const card = {};
  for (const line of markdown.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.replace(/\*\*/g, '').trim());
    if (cells.length < 4) continue;
    const label = cells[0].toLowerCase();
    const key = Object.keys(DIMENSIONS).find((k) => DIMENSIONS[k] === label);
    const points = Number(cells[3].replace(/[^\d.-]/g, ''));
    if (key && cells[3] !== '' && Number.isFinite(points) && card[key] === undefined) card[key] = points;
  }
  const total = markdown.match(/\b(\d{1,3})\s*\/\s*100\b/);
  const verdict = markdown.match(/\b(Partial Pass|Pass|Fail|Inconclusive)\b/);
  return { scorecard: card, total: total ? Number(total[1]) : null, verdict: verdict?.[1] ?? null };
}

async function runT4(client, loaded, args, available) {
  const tasks = (loaded.golden.slowking?.doc.tasks ?? []).filter((t) => t.test === 'T4');
  const results = [];
  for (const t of tasks) {
    const ref = t.reference_run;
    const base = { id: t.id, agent: 'slowking', limits: t.limits };
    if (ref.status !== 'RECORDED') { results.push({ ...base, status: 'SKIPPED', reason: 'reference run not recorded' }); continue; }
    if (!available.has('slowking')) { results.push({ ...base, status: 'SKIPPED', reason: 'agent not on Enact' }); continue; }
    if (!gateOpen(t, args.gates)) { results.push({ ...base, status: 'SKIPPED', reason: 'gate closed' }); continue; }
    try {
      const r = await runOnce(client, 'slowking', fill(t.message, ref.inputs), { repositories: t.repositories, maxCost: t.limits.max_cost_usd, maxMinutes: t.limits.max_minutes, poll: args.poll });
      const parsed = parseScorecard(r.result);
      const dims = Object.keys(DIMENSIONS).map((d) => {
        const got = parsed.scorecard[d];
        const delta = got == null ? null : Math.abs(got - ref.scorecard[d]);
        return { dimension: d, reference: ref.scorecard[d], enact: got ?? null, delta, ok: delta != null && delta <= T4_TOLERANCE };
      });
      results.push({ ...base, run_id: r.run_id, run_status: r.status, cost_usd: r.cost_usd, duration_ms: r.duration_ms,
        reference_total: ref.total, enact_total: parsed.total, reference_verdict: ref.verdict, enact_verdict: parsed.verdict,
        dimensions: dims, status: r.status === 'SUCCEEDED' && dims.every((d) => d.ok) ? 'PASS' : 'FAIL' });
    } catch (e) { results.push({ ...base, status: 'ERROR', error: String(e.message ?? e) }); }
  }
  const ran = results.filter((r) => r.status !== 'SKIPPED');
  return { tasks: results, summary: { tolerance_points: T4_TOLERANCE, ran: ran.length, passed: ran.filter((r) => r.status === 'PASS').length,
    skipped: results.length - ran.length, pass: ran.length ? ran.every((r) => r.status === 'PASS') : null } };
}

function primaryAgent(result, names) {
  const re = new RegExp(`\\b(${names.join('|')})\\b`, 'i');
  const idx = result.search(/primary recommendation/i);
  const m = (idx >= 0 ? result.slice(idx) : result).match(re);
  return m ? m[1].toLowerCase() : null;
}

async function runT5(client, loaded, args, available) {
  const { routing, stays, agents } = loaded;
  const router = routing.router;
  const names = Object.keys(agents).filter((n) => n !== router).sort((a, b) => b.length - a.length);
  if (!available.has(router)) return { tasks: [], summary: { pass: false, reason: `${router} not on Enact` } };
  const rows = await pool(routing.requests, args.concurrency, async (req) => {
    try {
      const r = await runOnce(client, router, req.request, { maxMinutes: 10, poll: args.poll });
      const got = primaryAgent(r.result, names);
      return { id: req.id, wave: req.wave, expected: req.expected, routed: got, correct: got === req.expected,
        stays_local: got != null && stays.has(got), near_miss: !!req.near_miss, run_id: r.run_id, status: r.status,
        cost_usd: r.cost_usd, duration_ms: r.duration_ms };
    } catch (e) { return { id: req.id, wave: req.wave, expected: req.expected, routed: null, correct: false, stays_local: false, error: String(e.message ?? e) }; }
  });
  const correct = rows.filter((r) => r.correct).length;
  const toStays = rows.filter((r) => r.stays_local).length;
  const perWave = {};
  for (const r of rows) { const w = (perWave[r.wave] ??= { total: 0, correct: 0 }); w.total++; if (r.correct) w.correct++; }
  const bar = routing.pass_bar;
  return { tasks: rows, summary: { correct, total: rows.length, routed_to_stays_local: toStays, per_wave: perWave,
    near_miss_correct: rows.filter((r) => r.near_miss && r.correct).length,
    median_cost_usd: median(rows.map((r) => r.cost_usd)),
    pass: correct >= bar.min_correct && toStays <= bar.max_routed_to_stays_local } };
}

// ---------------------------------------------------------------- reference recording (T4)

function recordReference(loaded, { id, file }, editor) {
  const entry = loaded.golden.slowking;
  const task = entry?.doc.tasks.find((t) => t.id === id && t.test === 'T4');
  if (!task) throw new Error(`no T4 task ${id} in golden/slowking.json`);
  const md = readFileSync(resolve(file), 'utf8');
  const parsed = parseScorecard(md);
  const missing = Object.keys(DIMENSIONS).filter((d) => parsed.scorecard[d] === undefined);
  if (missing.length) throw new Error(`scorecard rows not found: ${missing.join(', ')}`);
  const ref = task.reference_run;
  Object.assign(ref, { status: 'RECORDED', editor: editor ?? ref.editor, recorded_at: new Date().toISOString(),
    transcript: file, verdict: parsed.verdict, total: parsed.total, scorecard: parsed.scorecard });
  const pending = Object.entries(ref.inputs).filter(([k, v]) => k !== 'credentials_note' && !v).map(([k]) => k);
  writeFileSync(entry.file, `${JSON.stringify(entry.doc, null, 2)}\n`);
  console.log(`recorded ${id}: ${parsed.verdict} ${parsed.total}/100`);
  if (pending.length) console.log(`fill reference_run.inputs before running T4: ${pending.join(', ')}`);
}

// ---------------------------------------------------------------- main

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    return 0;
  }
  const loaded = loadAll();
  if (args.record) { recordReference(loaded, args.record, args.editor); return 0; }
  const { errors, summary } = validate(loaded);
  console.log(`validated: ${JSON.stringify(summary)}`);
  if (errors.length) {
    for (const e of errors) console.error(`  - ${e}`);
    console.error(`${errors.length} problem(s) in enact/tests`);
    return 1;
  }
  const { ENACT_URL, ENACT_API_KEY } = process.env;
  if (args.dryRun || !ENACT_URL || !ENACT_API_KEY) {
    console.log(args.dryRun ? 'dry run: test files are valid' : 'dry run (ENACT_URL or ENACT_API_KEY unset): test files are valid');
    return 0;
  }
  const client = mcpClient(ENACT_URL, ENACT_API_KEY);
  await client.init();
  const listed = await client.call('list_agents');
  const available = new Set((listed.agents ?? []).map((a) => a.name));
  const startedAt = new Date().toISOString();
  const out = { started_at: startedAt, enact_host: new URL(ENACT_URL).host, gates: args.gates, repeat: args.repeat,
    agents_on_enact: [...available].sort(), validation: summary, tests: {} };
  if (args.tests.includes('T3')) out.tests.T3 = await runT3(client, loaded, args, available);
  if (args.tests.includes('T4')) out.tests.T4 = await runT4(client, loaded, args, available);
  if (args.tests.includes('T5')) out.tests.T5 = await runT5(client, loaded, args, available);
  out.finished_at = new Date().toISOString();
  const path = resolve(args.out ?? join('enact-test-results', `${startedAt.replace(/[:.]/g, '-')}.json`));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`);
  for (const [k, v] of Object.entries(out.tests)) console.log(`${k}: ${JSON.stringify(v.summary)}`);
  console.log(`results: ${path}`);
  return Object.values(out.tests).every((v) => v.summary.pass !== false) ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }, (e) => { console.error(e.message ?? e); process.exitCode = 1; });
