# Source provenance

The bundled Elephant ingestion skills and query-db schema snapshots in this plugin
originate from upstream repositories at pinned commits. Author metadata from the
source skills is preserved in each skill's YAML frontmatter (`metadata.author`).

What to do with those upstream git repos (keep / gate / archive — not a delete list)
is in [`docs/elephant-source-repos.md`](../../../docs/elephant-source-repos.md).

| Source repository | Pinned commit | Bundled location |
|---|---|---|
| [oracle-node](https://github.com/elephant-xyz/oracle-node) | `ff68b0b6812598d07e0f4aaa322ddbfe230f20b9` | `skills/{stage-skill}/`, `skills/monitoring-oracle-ingestion/` |
| [elephant-query-db](https://github.com/elephant-xyz/elephant-query-db) | `083414442c57061b5e07359a9ebda30d14d7bc14` | `skills/use-elephant-query-db/reference/query-db-schema/schema/` |
| [Counties-trasform-scripts](https://github.com/elephant-xyz/Counties-trasform-scripts) | `39300ce69bcd8920176cb3cf902b49725ad09e38` | referenced by runtime transform sync (Task 2+) |
| [elephant-mcp](https://github.com/elephant-xyz/elephant-mcp) | `a736c9fc510d32c50ec3419a609fc03421d8fc06` | bundled MCP server config |

## Import summary (Task 1)

- **18 stage skills** copied from `oracle-node/agent/skills/` (19 `SKILL.md` files including
  `monitoring-county-ingestion`).
- **1 AWS monitoring skill** copied from
  `oracle-node/.agents/skills/monitoring-oracle-ingestion/` (1 `SKILL.md` + 4 scripts).
- **2 Overture assets** copied with `overture-places-ingest`
  (`extract-county-places.sql`, `hosted-service-categories.txt`).

**25 source files** before normalization.

## Author metadata

Stage skills retain `metadata: {"author":"elephant-xyz"}` from the oracle-node source.
`monitoring-oracle-ingestion` retains its original frontmatter author fields.

## Runtime contract

Ingestion commands resolve beneath `skills/use-oracle/runtime/` (added in Task 2). Skills
reference that path for services, data directories, catalogs, and transforms. Do not install
skills from external registries or clone sibling repositories for skill lookup — use the
bundled `skills/<skill-name>/SKILL.md` tree in this plugin.
