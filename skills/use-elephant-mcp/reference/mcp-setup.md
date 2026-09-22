# Elephant MCP 2.0 setup

## Bundled Cursor server

The plugin root `mcp.json` registers server `elephant`. Reload Cursor after updating the
plugin, then confirm the server is enabled.

Requirements:

- Node.js 22.18+
- network access to Atlas gateways for local synchronization
- write access to the configured local SQLite file
- optional embedding credentials only for verified-script search

The bundled environment contains only:

```text
ATLAS_IPNS
ATLAS_GATEWAYS
DATABASE_URL
```

Default Atlas IPNS:

```text
k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04
```

Default gateway order:

```text
https://ipfs.filebase.io
https://ipfs.io
https://dweb.link
https://w3s.link
```

The local `DATABASE_URL` is a home-directory `file:` URL. The bundled bash launcher
expands the portable home placeholder before starting MCP.

## Manual local configuration

```jsonc
{
  "mcpServers": {
    "elephant": {
      "command": "npx",
      "args": [
        "-y",
        "--package=github:elephant-xyz/elephant-mcp#main",
        "mcp"
      ],
      "env": {
        "ATLAS_IPNS": "k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04",
        "ATLAS_GATEWAYS": "https://ipfs.filebase.io,https://ipfs.io,https://dweb.link,https://w3s.link",
        "DATABASE_URL": "file:/absolute/home/path/.elephant-mcp/atlas.sqlite"
      }
    }
  }
}
```

Use an absolute home path in a manual config because MCP client JSON does not expand shell
variables. Do not add county maps or dataset pointers.

## Synchronization

Local stdio starts one sync and blocks Atlas-backed tools until an accepted snapshot is
ready. To force and inspect a sync:

```bash
npx -y --package=github:elephant-xyz/elephant-mcp#main mcp sync
```

Record the accepted Atlas index CID and per-group counts.

For hosted HTTP, run sync as a separate job with a direct writer credential. Run the HTTP
server with a read-only Postgres/Neon credential. Request handlers must not resolve IPNS or
download Atlas content.

## Connectivity smoke test

1. Call `listPublishedCounties`.
2. Choose an existing county and data group from the result.
3. Call `getOracleDatasetInfo` with both values.
4. Confirm the response contains `indexCid`, `archiveCid`, `tablesCid`, and `schemaCid`.
5. Call `getPropertyQuerySchema` for the same scope.

## Troubleshooting

- **Server missing:** reload Cursor and confirm the plugin is enabled.
- **Node too old:** fix the GUI process PATH or use the bundled launcher.
- **Atlas not ready:** run explicit sync and inspect gateway/CID errors.
- **County/group not published:** choose a scope from `listPublishedCounties` or complete
  the Atlas county PR and global IPNS verification.
- **SQLite path error:** use an absolute `file:` URL and ensure the parent directory is
  writable.
- **Hosted requests attempt network sync:** separate the sync writer job from the
  read-only HTTP process.
- **Verified-script search fails:** configure one supported embedding provider; Atlas data
  tools do not require it.

Never fix a v2 sync problem by restoring legacy public maps or direct Query DB reads.
