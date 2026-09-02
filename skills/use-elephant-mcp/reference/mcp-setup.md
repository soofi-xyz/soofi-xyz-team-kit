# Elephant MCP — Cursor setup

## Default: bundled with this plugin

This kit ships **`mcp.json`** at the plugin root. When you install or update the soofi-xyz
plugin and **reload Cursor**, the MCP server **`elephant`** is registered automatically — no
manual JSON editing required.

**Install source (interim):** Bundled `mcp.json` installs **elephant-mcp `main`** from the public
GitHub repo via `npx` because **npm `@elephant-xyz/mcp@latest` is still 1.6.0** (lacks
`queryProperties`, `queryPlaces`, multi-county open data, and current geo tools). When a newer
version is published to npm, the kit may switch to a tagged release for faster cold starts.

**Teammate checklist:**

1. Node.js **22.18+** (`node -v`)
2. Plugin installed (see kit `README.md`) and Cursor reloaded after updates
3. **Settings → MCP** — confirm **`elephant`** is listed and enabled (first start may take 1–3
   minutes while `npx` clones GitHub and runs the package build)
4. Optional: add `OPENAI_API_KEY` to the `elephant` server env **only if** you have a key and
   need `getVerifiedScriptExamples`. Do **not** set an empty key — elephant-mcp crashes on
   startup if `OPENAI_API_KEY` is present but blank. Without it, open-data and geo tools work;
   embeddings fall back to AWS Bedrock when AWS credentials are available.

**MCP server name:** always `elephant`. `donphan` and this skill call tools on that server via
`CallMcpTool` (`server`: `elephant`, `toolName`: e.g. `getOracleDatasetInfo`).

### Verify connectivity

Call `getOracleDatasetInfo` with an empty input. A healthy Lee County response includes
`county: "lee"`, `propertyCount` around **511695**, a non-null `ipnsName`, and export timestamps.
For every other county, pass `county` explicitly (kebab-case slugs) — omitting it silently
answers for Lee:

| County | `county` arg | Expected `propertyCount` (approx.) |
|--------|--------------|-------------------------------------|
| Lee | _(omit or `"lee"`) | ~511695 |
| Palm Beach | `"palm-beach"` | ~653945 |
| Miami-Dade | `"miami-dade"` | ~933087 |
| Orange | `"orange"` | verify live via MCP |

SQL counts/filters via `queryProperties` work for every county in the bundled
`PROPERTY_QUERY_TABLE_MAP`; call `listPublishedCounties` for the authoritative list. If
`propertyCount` is ~4644 and `ipnsName` is null, see troubleshooting below.

### Regenerating the county maps

Do not hand-edit the county maps in `mcp.json`. They are derived from Oracle's published-county
catalog (`oracle-node/catalog/published-counties.json`) — regenerate them with
`node scripts/print-mcp-env-maps.mjs` in an `oracle-node` checkout and paste the
`PROPERTY_QUERY_TABLE_MAP`, `PERMIT_QUERY_TABLE_MAP`, and `DATASET_COVERAGE_MAP` values in.
Counties published outside the catalog (currently `santa-clara`) must be preserved by hand when
you regenerate.

Overture places discovery is catalog-driven rather than an environment map. Call
`listPublishedCounties` and inspect nullable `placesTableUrl`, then call
`getPlaceQuerySchema`/`queryPlaces`. Lee currently publishes **40,191** rows. A null
`placesTableUrl` means the county has no published places query table.

## Manual fallback

If the bundled server did not appear after reload, add under **Cursor Settings → MCP →
Servers** (same as root `mcp.json`):

```jsonc
{
  "mcpServers": {
    "elephant": {
      "command": "bash",
      "args": [
        "-c",
        "nvm_bin=$(ls -d \"$HOME/.nvm/versions/node\"/*/bin 2>/dev/null | sort -V | tail -1); [ -n \"$nvm_bin\" ] && PATH=\"$nvm_bin:$PATH\"; PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"; export PATH; command -v npx >/dev/null || { echo 'elephant MCP: npx not found (need Node 22.18+ on PATH)' >&2; exit 127; }; exec npx -y --package=github:elephant-xyz/elephant-mcp#main mcp"
      ],
      "env": {
        "PROPERTY_QUERY_TABLE_MAP": "{\"chester\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dho0b79m6k93jdthnpjf6j9d6abn2jl7rjro0e31icjpg83vy0f\",\"hillsborough\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5diqz0l68gfi22qk0w8aqhsm7pcgje535uz8vhu8p37ynm2po0fh\",\"lee\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5djd4ohcf3qm87dhlt0e270xw8ejhkyia62edr76uj0u05hrf7m5\",\"miami-dade\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dgqktver4htb060qxfnaytjhybcxlfkp22vtgygbx2lb4t1h1xs\",\"montgomery\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dknn192e4mzltecz3cul4byog3x9oydaxsiecf1huk3woqrkpnj\",\"orange\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dhgte20ho86rzg5b7h0ght3a2js5wz0t55i96aaf1d12wpl8efn\",\"palm-beach\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dlu7hx158su5palzzxdbl6zcm8ojh7645bxisxs0cf0s158h6h3\",\"pinellas\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dhmo3zv6xvidksgvsqkfer3nw1s4v7bcbafpl66btpyab3zv9ir\",\"polk\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dj7acu8xg9ugfk670m8b185q4h7pz2gp8cv3mos15ftb4yz6w7o\",\"rock-island\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5djbtswq6lb4p7xbf3nu8bzdzokdtcdld1r2vx6asn7lgfuk54wt\",\"santa-clara\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dgnc94h8ce98ds0cb5yoidmcebpwnvccug4upasgbzpyz3ffgs5\"}",
        "PERMIT_QUERY_TABLE_MAP": "{\"montgomery\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dhmzrqgeg0dgdqwoey1of8qxi00fph5ea3z9niqujvmzcz009d8\",\"rock-island\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5di42nblo5nuk94aj7af393d9y5vhqxp5dtxikzso0wt14v3p0wa\",\"santa-clara\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dm5dkii3wz7hj8vqurb1b773uy0qj9nlvsvgaqqyccuurz8kmic\"}",
        "DATASET_COVERAGE_MAP": "{\"chester\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5djzghr538v7zskwn586juujd2nxzsox3fqr66konxwzlb08sebg\",\"hillsborough\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5di5jghjwbpumnr2vt1crmaycqmtx673kw8pqp8dymecuig5x8jb/\",\"lee\":\"https://k51qzi5uqu5dimw0elyh4agbtqe7v2fzp0jcd7b1bcu8kxs0hml7yu1no0z0vd.ipns.dweb.link/\",\"miami-dade\":\"https://k51qzi5uqu5djj45hvhz6z2dnsdg6pkgucds99t0f78d5gmwu19bfv8o9tygno.ipns.dweb.link/\",\"montgomery\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5djrxnqch9zhkm7n4m0ieep6zgbdo6tkvy5xqwn7uy94jfucndjm\",\"orange\":\"https://k51qzi5uqu5dj8n2f8nowh8kts53rvpr62zfj0mz9izc11rfzv56q7m4161lg7.ipns.dweb.link/\",\"palm-beach\":\"https://k51qzi5uqu5djwga4mcd8nx1gbwy4o9rks3gkoe1u5py5wi9tieea7h44nh4g2.ipns.dweb.link/\",\"pinellas\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5djrzm8n599i98ey7rpmwpbphgk8tvo5d6zjkfeqcmbrg7lh03xl/\",\"polk\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5diaoycedqekfs0osktwx8py1h8s7h0gspga18rksi3kumrs52nq/\",\"rock-island\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5disduz18ogkvf3f2zgdsizl20o034fu8spgh2khri8uxmeo3khv/\"}",
        "ORACLE_OPEN_DATA_IPNS_MAP": "{\"lee\":\"k51qzi5uqu5dlzgslzedrnk4whtd7ip69l0pmd3zxelz8hwjorbeyy0pyyeu4m\",\"palm-beach\":\"k51qzi5uqu5dgjnt84x8vnj2c9uwxomkpykwdvmf6xg43wwcxsifo6w1sp1wwh\",\"miami-dade\":\"k51qzi5uqu5dk9i59xxm579a5bziprxpygv8wyi01n2ivd5kj9h5u90g1tzn1d\",\"orange\":\"k51qzi5uqu5dm1g8re6sb3kv9yfh1xtcuohwhrvuklp7ky6l5gj62yrf1potyz\"}",
        "ORACLE_OPEN_DATA_DEFAULT_COUNTY": "lee",
        "ORACLE_GEO_INDEX_IPNS": "k51qzi5uqu5djo3756w73x3swtt63g9y7igj7tvv1gs4skjk3haj3fuk7qosdi"
      }
    }
  }
}
```

**Smoke test (terminal):** `bash -c 'nvm_bin=$(ls -d \"$HOME/.nvm/versions/node\"/*/bin 2>/dev/null | sort -V | tail -1); [ -n \"$nvm_bin\" ] && PATH=\"$nvm_bin:$PATH\"; PATH=\"/opt/homebrew/bin:/usr/local/bin:$PATH\"; export PATH; command -v npx >/dev/null || { echo 'elephant MCP: npx not found (need Node 22.18+ on PATH)' >&2; exit 127; }; exec npx -y --package=github:elephant-xyz/elephant-mcp#main mcp'`
should start the stdio server (Ctrl+C to stop). Requires network access to GitHub and the npm registry
(for dependencies). Pre-warming this once before opening Cursor avoids `ENOTEMPTY` errors from
concurrent `npx` cache writes on first MCP connect.

Or use the one-click install from the
[elephant-mcp README](https://github.com/elephant-xyz/elephant-mcp#cursor) — then rename or
duplicate config so the server id is **`elephant`** for consistency with `donphan`.

### Local `elephant-mcp` development

When hacking on a local checkout, point `command` to `npm start`, set `cwd` to the repo, and use
a separate MCP entry (e.g. `elephant-local`) — do not change the bundled `elephant` entry other
teammates rely on.

## Environment variables

| Variable | Required for | Default / notes |
|----------|----------------|-----------------|
| `OPENAI_API_KEY` | `getVerifiedScriptExamples` (OpenAI path) | **Not in bundled config** — add manually only when set; empty value crashes startup |
| `AWS_REGION` | Bedrock embeddings | `us-east-1` |
| AWS credential chain | Bedrock when no OpenAI key | IAM role, env vars, or `~/.aws/credentials` |
| `PROPERTY_QUERY_TABLE_MAP` | `queryProperties`, `getPropertyQuerySchema`, geo tools (SQL over open Parquet) | Bundled — every county in Oracle's published catalog, plus **santa-clara** |
| `PERMIT_QUERY_TABLE_MAP` | `queryPermits`, `getPermitQuerySchema`, `getPermitCoverage` (SQL over open permit Parquet) | Bundled — **montgomery**, **rock-island**, **santa-clara** (the counties with a published permit table; add others as they publish) |
| `DATASET_COVERAGE_MAP` | `getOracleDatasetInfo` coverage `datasets[]` | Bundled — every county with a published coverage snapshot |
| `PUBLISHED_COUNTY_CATALOG_URL` | `listPublishedCounties`, `getPlaceQuerySchema`, `queryPlaces` | Oracle's canonical catalog by default; places URLs are accepted only from non-null catalog `placesTableUrl` entries and validated as trusted HTTPS IPFS parquet URLs |
| `ORACLE_OPEN_DATA_IPNS_MAP` | Multi-county open data (`getOracleDatasetInfo`, `listOracleProperties`, etc.) | Bundled — **lee**, **palm-beach**, **miami-dade**, **orange** (matches prod Vercel MCP) |
| `ORACLE_OPEN_DATA_DEFAULT_COUNTY` | County when a tool omits `county` | `lee` |
| `ORACLE_OPEN_DATA_IPNS` | Legacy single-county open data | Superseded by `ORACLE_OPEN_DATA_IPNS_MAP` in bundled config |
| `ORACLE_OPEN_DATA_INDEX_CID` | Property tools (alternative) | Omit when using IPNS map |
| `ORACLE_OPEN_DATA_MANIFEST_CID` | Legacy flat manifest fallback | Only used when IPNS unset — default is ~4,664 pilot manifest |
| `ORACLE_GEO_INDEX_IPNS` | Geo fallback for counties outside `PROPERTY_QUERY_TABLE_MAP` (Lee reference index) | Set in bundled `mcp.json` |
| `ORACLE_GEO_INDEX_CID` | Geo fallback (alternative) | Fixed CID when IPNS unset |
| `LOG_LEVEL` | Diagnostics | `info` |

At least one embedding provider is required only for `getVerifiedScriptExamples`. Schema and
Oracle open-data tools work without embeddings.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `elephant` missing in MCP panel | Reload Cursor; confirm plugin path under `~/.cursor/plugins/local/` |
| County "not served" / `queryProperties` blocked | County missing from bundled maps — ingest via `oracle` + `use-oracle`, publish query table, add to `PROPERTY_QUERY_TABLE_MAP` / `ORACLE_OPEN_DATA_IPNS_MAP` |
| `getPlaceQuerySchema` / `queryPlaces` missing | Update the kit/MCP GitHub `main` install, reload Cursor, and confirm the `elephant` server restarted |
| Places unavailable / `placesTableUrl is null` | The canonical catalog has no places artifact for that county; do not bypass through Neon or direct IPFS |
| Places query times out | Retry once after the public IPNS gateway resolves; if repeated, report the 60-second MCP timeout and catalog URL without switching data paths |
| `propertyCount` ~4,664, `ipnsName` null | Add open-data IPNS (or county map entry) to server env and reload Cursor |
| `propertyCount` ~4,664, `ipnsName` set | IPNS still points at pilot manifest — full county open-data publish + IPNS re-point needed |
| Geo tools fail | Bundled `ORACLE_GEO_INDEX_IPNS` should be present; re-pull plugin |
| `getVerifiedScriptExamples` fails | Add a real `OPENAI_API_KEY` to server env, or configure AWS Bedrock credentials |
| First query is slow | `npx` clones GitHub and builds elephant-mcp on first start — can take 1–3 minutes |
| `elephant` red / install fails | Confirm Node **22.18+**; run smoke test above; check MCP error log for git/network or build errors |
| `bash: exec: npx: not found` / MCP `-32000` | Cursor's MCP spawn often has a minimal `PATH` (no nvm). Bundled `mcp.json` prepends nvm + Homebrew bins before `npx`. Reinstall/reload the plugin if you still see this on an older copy. |
| `npm error ENOTEMPTY` in `_npx` cache | Quit Cursor; `rm -rf ~/.npm/_npx`; run smoke test once; reopen Cursor |
| GitHub install blocked (proxy/firewall) | Use a local `elephant-mcp` checkout (`npm start` + `cwd`) or publish a newer `@elephant-xyz/mcp` to npm |
| After npm publishes >1.6.0 | Kit may switch `args` to `["-y", "@elephant-xyz/mcp@<version>"]` for faster cold starts |

## Related agents in this kit

| Task | Use |
|------|-----|
| Explore via MCP (this skill) | `donphan` agent |
| SQL over Neon | `use-elephant-query-db` |
| Ingest / refresh county data | `oracle` + `use-oracle` |
