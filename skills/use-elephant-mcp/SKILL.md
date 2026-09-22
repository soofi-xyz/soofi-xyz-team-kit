---
name: use-elephant-mcp
description: "Explore synchronized Atlas county data through Elephant MCP 2.0 normalized tools. Use for scoped county/data-group records, SQL filters and aggregates, geo questions, and lexicon schemas. Not for ingestion or direct Query DB access."
---

# Use Elephant MCP

Call only MCP tools on server `elephant`. The server reads a verified local SQLite or
hosted Postgres/Neon snapshot synchronized from the global Atlas IPNS. It does not query
remote Parquet in request handlers.

The ingestion Query DB is internal. Never query it, expose it, or treat it as the
MCP/publication source.

## Read first

1. [`reference/mcp-setup.md`](./reference/mcp-setup.md)
2. [`reference/tools-and-workflows.md`](./reference/tools-and-workflows.md)
3. [`reference/exploration-patterns.md`](./reference/exploration-patterns.md)
4. [`reference/normalized-property-shape.md`](./reference/normalized-property-shape.md)

## Mandatory gate

1. Confirm MCP server `elephant` is connected.
2. Call `listPublishedCounties`.
3. Resolve the requested county and available `dataGroup`.
4. Call `getOracleDatasetInfo` with explicit `county` and `dataGroup`.
5. Stop on a connection, sync, or unpublished-scope error. Use the setup reference; do
   not bypass MCP with direct IPFS, HTTP, shell, or database access.

Always pass `county` and `dataGroup`. For table or geo calls, always pass `table`.
There is no default-county workflow.

## Exploration playbook

### Discover normalized tables

Call `getPropertyQuerySchema` without `table` to list normalized class, relationship, and
property-root tables for one county/data group. Then call it again with the selected table
to learn exact columns.

### Query a table

Call `queryProperties` with:

- explicit `county`, `dataGroup`, and selected `table`;
- one read-only `SELECT` from logical relation `properties`;
- no CTE, JOIN, mutation, file access, or extension statement;
- a result limit no greater than 1000.

The selected Atlas table is exposed inside the query as `properties`. Use only columns
returned by schema discovery. Responses include source CIDs.

### List and reconstruct properties

- Use `listOracleProperties` to paginate property CIDs and group roots.
- Use `getOracleProperty` with `propertyCid` to reconstruct normalized class and
  relationship rows for one property.
- Do not pass a parcel identifier to `getOracleProperty`. Find the property CID through
  a normalized table query first.

### Geo and value questions

Use `findPropertiesInArea` or `sumPropertyValueInArea` with explicit scope, table, and
column overrides when the table does not use the defaults. First verify latitude,
longitude, parcel, and value columns with `getPropertyQuerySchema`.

### Schema semantics

Use:

1. `listClassesByDataGroup`
2. `listPropertiesByClassName`
3. `getPropertySchema`

Use `getVerifiedScriptExamples` only when embedding credentials are configured.

## Retained tool surface

Atlas SQL:

- `listPublishedCounties`
- `listOracleProperties`
- `getOracleProperty`
- `getOracleDatasetInfo`
- `getPropertyQuerySchema`
- `queryProperties`
- `findPropertiesInArea`
- `sumPropertyValueInArea`

Lexicon:

- `listClassesByDataGroup`
- `listPropertiesByClassName`
- `getPropertySchema`
- `getVerifiedScriptExamples`

Do not call removed specialized HOA, permit, places, dataset-plan, catalog, or legacy
open-data tools.

## Evidence and limits

- Report the exact county/data-group/table scope.
- Report tools in call order and significant parameters.
- Include Atlas index, archive, tables, and schema CIDs returned by the tools.
- State row limits, filters, and whether an answer is exhaustive.
- Treat absent groups, tables, columns, and rows distinctly.
- Do not infer county completeness from one data group or table.
- Do not infer legal identity from names, addresses, or enrichment alone.
- Hand ingestion or refresh requests to `use-oracle`.

## Expected output

Return the restated question, explicit scope, tools called, result, methodology, CIDs,
row/sample limits, missing data, and the exact sync or publication fix for any blocker.
