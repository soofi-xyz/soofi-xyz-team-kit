# Elephant MCP — Cursor setup

## Default: bundled with this plugin

This kit ships **`mcp.json`** at the plugin root. When you install or update the soofi-xyz
plugin and **reload Cursor**, the MCP server **`elephant`** is registered automatically — no
manual JSON editing required.

**Install source (interim):** Bundled `mcp.json` installs **elephant-mcp v1.7.0** from the public
GitHub repo via `npx` because **`@elephant-xyz/mcp@1.7.0` is not on npm yet** (latest published
is 1.6.0, which lacks Oracle open-data and geo tools). When 1.7.0 is published to npm, the kit
may switch back to `@elephant-xyz/mcp@1.7.0`.

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
If `propertyCount` is ~4644 and `ipnsName` is null, see troubleshooting below.

## Manual fallback

If the bundled server did not appear after reload, add under **Cursor Settings → MCP →
Servers** (same as root `mcp.json`):

```jsonc
{
  "mcpServers": {
    "elephant": {
      "command": "npx",
      "args": [
        "-y",
        "--package=github:elephant-xyz/elephant-mcp#v1.7.0",
        "mcp"
      ],
      "env": {
        "ORACLE_OPEN_DATA_IPNS": "k51qzi5uqu5dlzgslzedrnk4whtd7ip69l0pmd3zxelz8hwjorbeyy0pyyeu4m",
        "ORACLE_GEO_INDEX_IPNS": "k51qzi5uqu5djo3756w73x3swtt63g9y7igj7tvv1gs4skjk3haj3fuk7qosdi"
      }
    }
  }
}
```

**Smoke test (terminal):** `npx -y --package=github:elephant-xyz/elephant-mcp#v1.7.0 mcp` should
start the stdio server (Ctrl+C to stop). Requires network access to GitHub and the npm registry
(for dependencies).

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
| `ORACLE_OPEN_DATA_IPNS` | Property open-data tools (`getOracleDatasetInfo`, `listOracleProperties`, etc.) | Set in bundled `mcp.json` — Lee `oracle-open-data-lee` (`k51qzi5uqu5dlz…`) |
| `ORACLE_OPEN_DATA_INDEX_CID` | Property tools (alternative) | Omit when using IPNS; fixed CID pins a snapshot |
| `ORACLE_OPEN_DATA_MANIFEST_CID` | Legacy flat manifest fallback | Only used when IPNS unset — default is ~4,664 pilot manifest |
| `ORACLE_GEO_INDEX_IPNS` | Geo tools | Set in bundled `mcp.json` (Lee County reference index) |
| `ORACLE_GEO_INDEX_CID` | Geo tools (alternative) | Fixed CID when IPNS unset |
| `LOG_LEVEL` | Diagnostics | `info` |

At least one embedding provider is required only for `getVerifiedScriptExamples`. Schema and
Oracle open-data tools work without embeddings.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `elephant` missing in MCP panel | Reload Cursor; confirm plugin path under `~/.cursor/plugins/local/` |
| `propertyCount` ~4,664, `ipnsName` null | Add `ORACLE_OPEN_DATA_IPNS` to server env and reload Cursor |
| `propertyCount` ~4,664, `ipnsName` set | IPNS still points at pilot manifest — full county open-data publish + IPNS re-point needed |
| Geo tools fail | Bundled `ORACLE_GEO_INDEX_IPNS` should be present; re-pull plugin |
| `getVerifiedScriptExamples` fails | Add a real `OPENAI_API_KEY` to server env, or configure AWS Bedrock credentials |
| First query is slow | `npx` clones GitHub and builds elephant-mcp on first start — can take 1–3 minutes |
| `elephant` red / install fails | Confirm Node **22.18+**; run smoke test above; check MCP error log for git/network or build errors |
| GitHub install blocked (proxy/firewall) | Use a local `elephant-mcp` checkout (`npm start` + `cwd`) or publish `@elephant-xyz/mcp@1.7.0` to npm |
| After npm publishes 1.7.0 | Kit may switch `args` to `["-y", "@elephant-xyz/mcp@1.7.0"]` for faster cold starts |

## Related agents in this kit

| Task | Use |
|------|-----|
| Explore via MCP (this skill) | `donphan` agent |
| SQL over Neon | `use-elephant-query-db` |
| Ingest / refresh county data | `oracle` + `use-oracle` |
