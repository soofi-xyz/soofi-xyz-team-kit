# Connect Claude Code and Cursor to the Persist and Report MCP servers

Both servers are served on the environment's shared domain (`domain.fqdn` in
`/account/env-parameters`) and use the environment's shared `x-api-key`. Verify
the target deployment serves `/persist/mcp` and `/report/mcp` before handing out
this setup.

## Key

The person sets the key in their own terminal profile; never read it from AWS,
print it or ask for it in chat. It lives only in the client's header
configuration, never in prompts, tool arguments or transcripts.

```bash
export PRISM_API_KEY='<shared x-api-key>'
export PRISM_DOMAIN='<shared domain>'
```

## Claude Code

```bash
claude mcp add --transport http persist "https://$PRISM_DOMAIN/persist/mcp" \
  --header "x-api-key: \${PRISM_API_KEY}"
claude mcp add --transport http report "https://$PRISM_DOMAIN/report/mcp" \
  --header "x-api-key: \${PRISM_API_KEY}"
```

Keep the escaped `\${PRISM_API_KEY}` so the configuration stores the variable,
not the key. Check with `claude mcp list`, then `/mcp` in a session.

## Cursor

In `.cursor/mcp.json` (project) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "persist": {
      "url": "https://<shared domain>/persist/mcp",
      "headers": { "x-api-key": "${env:PRISM_API_KEY}" }
    },
    "report": {
      "url": "https://<shared domain>/report/mcp",
      "headers": { "x-api-key": "${env:PRISM_API_KEY}" }
    }
  }
}
```

## Verify

1. Both clients list the Persist and Report tools.
2. `describe_schema` returns the base model; `list_reports` returns the saved reports.
3. A rejected key yields a plain authentication error, and the key appears in no
   tool result or transcript.
