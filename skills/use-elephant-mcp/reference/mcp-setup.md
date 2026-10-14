# Elephant MCP setup

## Bundled Cursor server

The plugin root `mcp.json` registers server `elephant`. Reload Cursor after updating the
plugin, then confirm the server is enabled. Requires Node.js 22.18+.

## Cutover status

`mcp.json` still runs the current server with the legacy per-county environment maps, so
Donphan keeps working during the transition. The MCP 2.0 configuration lives in
[`docs/mcp-atlas.example.json`](../../../docs/mcp-atlas.example.json). Switch `mcp.json`
to it only when both conditions hold:

1. MCP 2.0 is released (`npx -y @elephant-xyz/mcp@2 mcp` starts), and
2. the global Atlas index lists at least one county.

Until then, a connected server that lacks `listAtlasCounties` is expected: report that
the cutover has not happened and stop. Do not improvise against the legacy tools from this
skill's contract.

## MCP 2.0 configuration

The example config launches `npx -y @elephant-xyz/mcp@2 mcp` with only:

```text
ATLAS_IPNS=k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04
ATLAS_GATEWAYS=https://ipfs.filebase.io,https://ipfs.io,https://dweb.link,https://w3s.link
```

The server stores its synchronized snapshot in a default file under the operator's home
directory; do not set a database URL for local use. Do not add county maps, catalog URLs,
or dataset pointers.

## Synchronization

Local stdio starts one sync on startup and blocks Atlas-backed tools until an accepted
snapshot is ready. To force and inspect a sync:

```bash
npx -y @elephant-xyz/mcp@2 sync
```

Record the accepted index CID and per-group row counts. Hosted deployments run the same
command as a scheduled job; request handlers never resolve the index or download archives.

## Connectivity smoke test

1. Call `listAtlasCounties`; confirm the index CID and at least one county.
2. Choose a listed `state`, `county`, and `dataGroup`.
3. Call `getAtlasDatasetInfo`; confirm `source` carries `archiveCid`, `tablesCid`,
   `schemaCid`, `indexCid`, and `syncedAt`.
4. Call `getAtlasSchema` without `table`, then with one returned table.
5. Run one `queryAtlas` `SELECT count(*) FROM property`.

## Troubleshooting

- **Server missing:** reload Cursor and confirm the plugin is enabled.
- **Node too old:** fix the GUI process PATH or use the bundled launcher.
- **`listAtlasCounties` absent:** cutover not done; see above.
- **Atlas not ready:** run an explicit sync and inspect gateway/CID errors.
- **Scope not published:** choose a scope from `listAtlasCounties` or complete the Atlas
  county PR and global index verification (`use-oracle`).
- **Hosted requests attempt network sync:** move sync to the scheduled job.
- **Verified-script search fails:** configure one supported embedding provider; Atlas
  tools do not require it.

Never fix a sync problem by pointing MCP at the ingestion query DB.
