# Elephant repository boundaries

Use these ownership boundaries after the Atlas SQL migration.

## Team kit

This repository owns:

- Oracle agent and stage guidance;
- the self-contained ingestion/reconciliation runtime (Restate run tracking, artifact
  files, and per-run manifests);
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

The `v2` branch holds Elephant CLI 2, an experimental rewrite as one native binary with
`prepare` and `transform` built in. `main` and the npm package stay 1.x. Agents propose
Elephant CLI 2 before they run the CLI; `skills/migrate-elephant-cli-v2/SKILL.md` has the
install, the differences and the check to run before a cut-over.

## Elephant MCP

`elephant-xyz/elephant-mcp` 2.0 owns:

- global Atlas IPNS resolution;
- CID verification and snapshot synchronization (`npx -y @elephant-xyz/mcp@2 sync`);
- local stdio and hosted HTTP transports;
- the Atlas tools (`listAtlasCounties`, `getAtlasDatasetInfo`, `getAtlasSchema`,
  `queryAtlas`, `listAtlasProperties`, `getAtlasProperty`) and the lexicon tools.

Request handlers query the accepted snapshot. They do not fetch remote archives or
Oracle's ingestion artifacts.

## Run tracking

Oracle tracks runs in Restate and keeps all data in files: captures, transformed lexicon
output, permit artifacts, identity relationship files, roof-age lineage, enrichment
working files, and a per-run manifest written by reconciliation. The former internal SQL
Query DB (`elephant-query-db`) is retired; nothing loads it.

Run state and working files are not a public consumer product, MCP source, registry, or
publication path.

## Historical upstreams

Older source repositories may remain useful for history or separately operated AWS jobs.
Do not treat them as runtime prerequisites and do not restore retired public publishers,
catalog generators, or public-consumer database guidance from them.
