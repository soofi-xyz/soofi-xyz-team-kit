# Elephant repository boundaries

Use these ownership boundaries after the Atlas SQL migration.

## Team kit

This repository owns:

- Oracle agent and stage guidance;
- the self-contained ingestion/reconciliation runtime;
- internal Query DB operating guidance;
- Atlas publication instructions;
- bundled Elephant MCP 2.0 configuration.

The runtime does not require sibling source checkouts. Upstream commit citations in
`skills/use-oracle/reference/source-provenance.md` are provenance, not prerequisites.

## Atlas

`elephant-xyz/atlas` is the only public county/data-group registry.

Each county page records archive, schema, and normalized tables CIDs. The merge workflow
regenerates the global index and moves the one `elephant-atlas` IPNS name:

```text
k51qzi5uqu5dhzmj1jtn06idud425ozwdjjjn4eu7q01g2t814h7rw4du0nd04
```

Do not add a parallel catalog or county pointer.

## Elephant CLI

`elephant-xyz/elephant-cli` owns:

- lexicon validation;
- deterministic hashing and CAR packing;
- CAR validation;
- normalized table export;
- Atlas county-page generation;
- CAR/table upload and gateway readback.

Oracle invokes these commands; the team kit does not duplicate them.

## Elephant MCP

`elephant-xyz/elephant-mcp` 2.0 owns:

- global Atlas IPNS resolution;
- CID verification and snapshot synchronization (`npx -y @elephant-xyz/mcp@2 sync`);
- local stdio and hosted HTTP transports;
- the Atlas tools (`listAtlasCounties`, `getAtlasDatasetInfo`, `getAtlasSchema`,
  `queryAtlas`, `listAtlasProperties`, `getAtlasProperty`) and the lexicon tools.

Request handlers query the accepted snapshot. They do not fetch remote archives or the
ingestion Query DB.

## Query DB

The Query DB package remains an internal ingest/reconciliation dependency. It owns its
schema, migrations, loaders, folio reconciliation, permit/property links, official identity
edges, roof-age lineage, and enrichment working tables.

It is not a public consumer product, MCP source, registry, or publication path. Public
schema snapshots and direct-consumer guidance are intentionally not bundled.

## Historical upstreams

Older source repositories may remain useful for history or separately operated AWS jobs.
Do not treat them as runtime prerequisites and do not restore retired public publishers,
catalog generators, or public-consumer database guidance from them.
