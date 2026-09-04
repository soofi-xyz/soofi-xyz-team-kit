# Elephant source repos, MCP discovery, and keeping Cursor on the kit

Shareable notes after the self-contained ingestion work on
[PR #140](https://github.com/soofi-xyz/soofi-xyz-team-kit/pull/140).
This is the follow-up plan for upstream Elephant git repos. It is not a delete list.

## Did the kit work remove the need for `oracle-node`?

**For kit ingestion and for MCP that actually uses this plugin’s `mcp.json`: mostly yes.
For deleting GitHub `elephant-xyz/oracle-node`: no.**

| Claim (from before this PR) | After PR #140 |
|---|---|
| Kit default ingestion clones `oracle-node` | **False.** Runtime is `skills/use-oracle/runtime/`. |
| Plugin `mcp.json` does not override the catalog URL | **False on this branch.** It sets `PUBLISHED_COUNTY_CATALOG_URL` to the kit GitHub raw file. |
| Map-generation scripts only exist in an `oracle-node` checkout | **False.** `npm run catalog:sync-mcp-json --prefix skills/use-oracle/runtime` |
| elephant-mcp’s **default** catalog URL is still `oracle-node` on GitHub | **Still true.** Hardcoded in elephant-mcp. |
| Deleting `oracle-node` would break default / un-overridden MCP | **Still true.** |
| Property SQL / coverage URLs are IPFS, not GitHub | **Still true.** Deleting the git repo does not take those datasets down. |
| AWS `elephant-oracle-node` is the git repo | **False.** Deleting GitHub does not tear down AWS, and also does not keep the raw catalog URL alive. |

Until this PR is **merged**, the kit catalog URL on `main` **404s**. The file already exists on
the feature branch:

`https://raw.githubusercontent.com/soofi-xyz/soofi-xyz-team-kit/feature/add-elephant-runtime-wrappers/skills/use-oracle/runtime/catalog/published-counties.json`

(12 counties, including Seminole FIPS `12117`. Santa Clara is maps-only, not in the catalog.)

Checked 2026-09-04:

- `https://raw.githubusercontent.com/elephant-xyz/oracle-node/main/catalog/published-counties.json` → **200**, **11** counties, no Seminole, `generatedAt` `2026-09-02T21:30:38.532Z`
- kit `main` catalog path → **404**
- kit feature-branch catalog path → **200**, **12** counties, Seminole present

## Live Cursor MCP in this workspace (2026-09-04)

A new Cursor **terminal** does not reconnect MCP. MCP is a long-lived server Cursor starts from
config. Reload the window (or restart Cursor) after changing `mcp.json` or the local plugin copy.

What this session actually talks to:

| Server | Status | What `listPublishedCounties` did |
|---|---|---|
| User MCP `elephant` (`~/.cursor/mcp.json`) | Ready | **11 counties**, no Seminole. Catalog revision `38232a1c…` matches the live `oracle-node` GitHub file. Pinellas `getOracleDatasetInfo` still works (`propertyCount` 311566) because that path is IPFS. |
| Plugin MCP (`soofi-xyz-team-kit`, `-local`, `-hoopa`) | **Error** (tool discovery failed) | Not used. Stale plugin copies also lacked `PUBLISHED_COUNTY_CATALOG_URL`. |

### Why the plugin server was red, and the fix

Two independent causes, both now addressed:

1. **Wrong Node.** The bundled launcher prepended the newest nvm bin and then prepended
   `/opt/homebrew/bin:/usr/local/bin` *in front of it*, so a stale `/usr/local/bin/node`
   (v22.12.0) beat an nvm 24.16 install and `@elephant-xyz/mcp` (`node >=22.18`) failed to boot.
   The launcher now applies the fallbacks first, then prepends the newest nvm bin that is
   **≥22.18**, and exits with an explicit "node … is too old" message otherwise. A GUI-launched
   Cursor uses the login PATH, not your interactive nvm shell — so `node -v` in a terminal
   proves nothing about what MCP gets.
2. **Half-installed `npx` cache.** `~/.npm/_npx/<hash>` had been left mid-install (killing a
   cold start does this), giving `ERR_MODULE_NOT_FOUND: uint8arrays` / `ENOTEMPTY`. Remove that
   directory and let the next cold start finish; the GitHub clone + build took ~7 minutes here.

After both fixes, spawning the plugin's `elephant` server with a login-shell PATH resolved
`v24.16.0`, initialized `@elephant-xyz/mcp@1.11.0`, exposed 20 tools, and
`listPublishedCounties` returned **12 counties with Seminole present and Santa Clara absent**
(against the feature-branch catalog URL, since `main` still 404s pre-merge).

The user server is **not** the kit plugin. It runs a local checkout:

```text
node /Users/nelsonborallineto/Development/prismteam-ai/elephant-mcp/dist/index.js
```

with property/permit maps and **no** `PUBLISHED_COUNTY_CATALOG_URL`, so elephant-mcp falls back
to the hardcoded oracle-node GitHub default. That is why a “live tool” call still looks like
the old 11-county world even though the kit branch has 12.

To see the kit catalog from MCP **before merge**, point `PUBLISHED_COUNTY_CATALOG_URL` at a
filesystem path (not `file://`) of

`soofi-xyz-team-kit/skills/use-oracle/runtime/catalog/published-counties.json`

or at the feature-branch raw GitHub URL above. After merge, the kit `mcp.json` URL on `main`
is the intended override.

## Future of the source repositories

Do not delete anything in this round. **Archive after cutover**, delete only when nothing still
fetches the old GitHub raw URL.

### 1. `elephant-xyz/oracle-node` — gate, then archive

Still the public catalog URL, still AWS/SQS ingestion source, still what default MCP fetches.

After #140 merges:

1. Freeze dual-writes: new counties go to the **kit** catalog first.
2. README on `oracle-node`: kit catalog is canonical; this file is legacy.
3. Retarget elephant-mcp’s default URL (next item).
4. Update every hosted MCP env that does not set the override.
5. **Archive** the git repo when AWS ops either keep a private mirror or are fully on the kit /
   pipeline path.

Deleting GitHub does not kill AWS Lambda/SQS. It **does** kill
`raw.githubusercontent.com/elephant-xyz/oracle-node/main/catalog/published-counties.json`.

### 2. `elephant-xyz/elephant-mcp` — keep; change one default

This is the product. Next PR there: default `PUBLISHED_COUNTY_CATALOG_URL` → kit `main`
(or later an IPNS catalog). Until then, only clients that set the env (this plugin’s `mcp.json`)
are safe if `oracle-node` goes away.

### 3. `elephant-xyz/Counties-trasform-scripts` — keep as transform upstream

The kit vendored **Pinellas and Duval** only. New county adapters still come from here (or get
copied into `skills/use-oracle/runtime/counties/` the same way). Archive when the counties we
run are all bundled.

### 4. `elephant-xyz/elephant-query-db` — keep

The kit only snapshotted schema under `skills/use-elephant-query-db/reference/query-db-schema/`.
Neon/loaders/schema evolution stay in that repo. Plan a periodic schema sync, not a delete.

### 5. `elephant-xyz/skills` — non-canonical for this team

The kit bundled 19 stage/monitoring skills and must not run `npx skills add elephant-xyz/skills`.
For Soofi, `skills/` in this repo is source of truth. Elephant can keep a public skill repo for
other consumers.

### 6. AWS `elephant-oracle-node` / elephant-pipeline — separate from GitHub

Local Restate + Postgres is the kit default. The AWS stack is still a real runtime. “We don’t
clone the git repo to ingest Pinellas” is not “Lambda is gone.”

### Suggested sequence

1. Merge #140 so the kit catalog URL on `main` exists.
2. Refresh the local Cursor plugin (below), reload, confirm `listPublishedCounties` returns **12**
   counties and Seminole, Santa Clara absent from that list.
3. PR on elephant-mcp: retarget the default GitHub URL.
4. Update hosted MCP / Vercel env the same way.
5. Freeze the `oracle-node` catalog (readme + no dual writes).
6. Replace `ipfs-only-hash` / vulnerable IPLD **before** the first `--approve` Filebase publish.
7. Archive `oracle-node` (archive ≠ delete). Keep transforms, query-db, and mcp.

## Keeping Cursor skills and MCP on the team kit

There are **three** different Elephant surfaces in Cursor. Mixing them is why live MCP can
disagree with the kit checkout.

### A. User-level MCP (`~/.cursor/mcp.json`)

Always on. Independent of the plugin. If this `elephant` server has no
`PUBLISHED_COUNTY_CATALOG_URL`, discovery is oracle-node. Maps here can also be an older subset
(this machine’s user config still has a local Duval parquet addition and is missing Broward /
Seminole / Santa Clara in the maps).

Disable or align this server if you want the **plugin** to be the only Elephant MCP.

### B. Published / cloned plugin at `~/.cursor/plugins/local/soofi-xyz-team-kit`

README install path: clone (or `git pull`) that directory, then **Developer: Reload Window**.

```bash
git -C ~/.cursor/plugins/local/soofi-xyz-team-kit pull
```

That tracks **`main` of the published plugin**, not your feature-branch checkout, until #140
merges.

### C. Dev copy of *this* checkout (skills + `mcp.json` you are editing)

```bash
cd /path/to/soofi-xyz-team-kit
scripts/local-cursor-plugin.sh install
```

Copies the repo to `~/.cursor/plugins/local/soofi-xyz-team-kit-local` (renamed so it does not
clash with the published plugin). Then:

1. **Developer: Reload Window** (or fully restart Cursor if the plugin is not detected).
2. **Settings → Plugins** — confirm `soofi-xyz-team-kit-local` is enabled.
3. Disable the other `soofi-xyz-team-kit*` installs if agent/skill names duplicate.
4. **Settings → MCP** — plugin `elephant` should come up green (needs Node **22.18+**; first
   `npx` GitHub install can take 1–3 minutes).
5. Smoke: `/arceus Reply with exactly: ok`, then `listPublishedCounties`.

After every meaningful change to agents, skills, rules, manifests, or `mcp.json`, run `install`
again. The copy is not a symlink; Cursor will keep serving yesterday’s skills until you recopy
and reload.

Before a PR you can remove the test copy:

```bash
scripts/local-cursor-plugin.sh remove
```

Copilot and Codex are separate: `scripts/sync-copilot-agents.sh` /
`scripts/sync-codex-agents.sh`, then their own plugin install paths in `README.md`.

### How to tell which catalog you are on

| `listPublishedCounties` | Meaning |
|---|---|
| 11 counties, no Seminole, revision `38232a1c…` (oracle-node `generatedAt` 2026-09-02) | Default elephant-mcp / user MCP without kit override |
| 12 counties, Seminole present, Santa Clara absent | Kit catalog |
| Plugin `elephant` red | npx/Node/path failure — not a catalog issue; fix MCP logs first |
