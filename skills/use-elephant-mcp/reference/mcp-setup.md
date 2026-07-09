# Elephant MCP — Cursor setup

## Default: bundled with this plugin

This kit ships **`mcp.json`** at the plugin root. When you install or update the soofi-xyz
plugin and **reload Cursor**, the MCP server **`elephant`** is registered automatically — no
manual JSON editing required.

**Install source (interim):** Bundled `mcp.json` installs **elephant-mcp `main`** from the public
GitHub repo via `npx` because **npm `@elephant-xyz/mcp@latest` is still 1.6.0** (lacks
`queryProperties`, multi-county open data, and current geo tools). When a newer version is
published to npm, the kit may switch to a tagged release for faster cold starts.

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
For other bundled counties, pass `county` explicitly (kebab-case slugs):

| County | `county` arg | Expected `propertyCount` (approx.) |
|--------|--------------|-------------------------------------|
| Lee | _(omit or `"lee"`) | ~511695 |
| Palm Beach | `"palm-beach"` | ~653945 |
| Miami-Dade | `"miami-dade"` | ~933087 |
| Orange | `"orange"` | verify live via MCP |

SQL counts/filters via `queryProperties` work for all four counties in the bundled
`PROPERTY_QUERY_TABLE_MAP`. If `propertyCount` is ~4644 and `ipnsName` is null, see
troubleshooting below.

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
        "exec npx -y --package=github:elephant-xyz/elephant-mcp#main mcp"
      ],
      "env": {
        "PROPERTY_QUERY_TABLE_MAP": "{\"lee\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5djd4ohcf3qm87dhlt0e270xw8ejhkyia62edr76uj0u05hrf7m5\",\"palm-beach\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dlu7hx158su5palzzxdbl6zcm8ojh7645bxisxs0cf0s158h6h3\",\"miami-dade\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dgqktver4htb060qxfnaytjhybcxlfkp22vtgygbx2lb4t1h1xs\",\"orange\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dhgte20ho86rzg5b7h0ght3a2js5wz0t55i96aaf1d12wpl8efn\",\"santa-clara\":\"https://ipfs.filebase.io/ipns/k51qzi5uqu5dgnc94h8ce98ds0cb5yoidmcebpwnvccug4upasgbzpyz3ffgs5\"}",
        "ORACLE_OPEN_DATA_IPNS_MAP": "{\"lee\":\"k51qzi5uqu5dlzgslzedrnk4whtd7ip69l0pmd3zxelz8hwjorbeyy0pyyeu4m\",\"palm-beach\":\"k51qzi5uqu5dgjnt84x8vnj2c9uwxomkpykwdvmf6xg43wwcxsifo6w1sp1wwh\",\"miami-dade\":\"k51qzi5uqu5dk9i59xxm579a5bziprxpygv8wyi01n2ivd5kj9h5u90g1tzn1d\",\"orange\":\"k51qzi5uqu5dm1g8re6sb3kv9yfh1xtcuohwhrvuklp7ky6l5gj62yrf1potyz\"}",
        "ORACLE_OPEN_DATA_DEFAULT_COUNTY": "lee",
        "ORACLE_GEO_INDEX_IPNS": "k51qzi5uqu5djo3756w73x3swtt63g9y7igj7tvv1gs4skjk3haj3fuk7qosdi"
      }
    }
  }
}
```

**Smoke test (terminal):** `bash -c 'exec npx -y --package=github:elephant-xyz/elephant-mcp#main mcp'`
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
| `PROPERTY_QUERY_TABLE_MAP` | `queryProperties`, `getPropertyQuerySchema` (SQL over open Parquet) | Bundled — **lee**, **palm-beach**, **miami-dade**, **orange**, **santa-clara** |
| `ORACLE_OPEN_DATA_IPNS_MAP` | Multi-county open data (`getOracleDatasetInfo`, `listOracleProperties`, etc.) | Bundled — **lee**, **palm-beach**, **miami-dade**, **orange** (matches prod Vercel MCP) |
| `ORACLE_OPEN_DATA_DEFAULT_COUNTY` | County when a tool omits `county` | `lee` |
| `ORACLE_OPEN_DATA_IPNS` | Legacy single-county open data | Superseded by `ORACLE_OPEN_DATA_IPNS_MAP` in bundled config |
| `ORACLE_OPEN_DATA_INDEX_CID` | Property tools (alternative) | Omit when using IPNS map |
| `ORACLE_OPEN_DATA_MANIFEST_CID` | Legacy flat manifest fallback | Only used when IPNS unset — default is ~4,664 pilot manifest |
| `ORACLE_GEO_INDEX_IPNS` | Geo tools (Lee reference index) | Set in bundled `mcp.json` |
| `ORACLE_GEO_INDEX_CID` | Geo tools (alternative) | Fixed CID when IPNS unset |
| `LOG_LEVEL` | Diagnostics | `info` |

At least one embedding provider is required only for `getVerifiedScriptExamples`. Schema and
Oracle open-data tools work without embeddings.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `elephant` missing in MCP panel | Reload Cursor; confirm plugin path under `~/.cursor/plugins/local/` |
| County "not served" / `queryProperties` blocked | County missing from bundled maps — ingest via `oracle` + `use-oracle`, publish query table, add to `PROPERTY_QUERY_TABLE_MAP` / `ORACLE_OPEN_DATA_IPNS_MAP` |
| `propertyCount` ~4,664, `ipnsName` null | Add open-data IPNS (or county map entry) to server env and reload Cursor |
| `propertyCount` ~4,664, `ipnsName` set | IPNS still points at pilot manifest — full county open-data publish + IPNS re-point needed |
| Geo tools fail | Bundled `ORACLE_GEO_INDEX_IPNS` should be present; re-pull plugin |
| `getVerifiedScriptExamples` fails | Add a real `OPENAI_API_KEY` to server env, or configure AWS Bedrock credentials |
| First query is slow | `npx` clones GitHub and builds elephant-mcp on first start — can take 1–3 minutes |
| `elephant` red / install fails | Confirm Node **22.18+**; run smoke test above; check MCP error log for git/network or build errors |
| `npm error ENOTEMPTY` in `_npx` cache | Quit Cursor; `rm -rf ~/.npm/_npx`; run smoke test once; reopen Cursor |
| GitHub install blocked (proxy/firewall) | Use a local `elephant-mcp` checkout (`npm start` + `cwd`) or publish a newer `@elephant-xyz/mcp` to npm |
| After npm publishes >1.6.0 | Kit may switch `args` to `["-y", "@elephant-xyz/mcp@<version>"]` for faster cold starts |

## Related agents in this kit

| Task | Use |
|------|-----|
| Explore via MCP (this skill) | `donphan` agent |
| SQL over Neon | `use-elephant-query-db` |
| Ingest / refresh county data | `oracle` + `use-oracle` |
