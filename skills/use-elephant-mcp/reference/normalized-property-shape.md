# Normalized Atlas result shape

MCP 2.0 reconstructs a property from normalized Atlas SQL. It does not return one legacy
consolidated JSON document.

## Dataset provenance

Atlas-backed responses include:

```jsonc
{
  "source": {
    "county": "duval",
    "dataGroup": "county",
    "indexCid": "...",
    "archiveCid": "...",
    "tablesCid": "...",
    "schemaCid": "..."
  }
}
```

Use these CIDs to identify the accepted publication revision.

## Property listing

`listOracleProperties` returns:

```jsonc
{
  "properties": [
    {
      "property_cid": "...",
      "root_schema_cid": "...",
      "root_cid": "..."
    }
  ],
  "total": 1,
  "limit": 50,
  "offset": 0,
  "source": {}
}
```

The same property CID can have multiple roots within the selected data group.

## Property reconstruction

`getOracleProperty` returns:

```jsonc
{
  "propertyCid": "...",
  "roots": [
    {
      "root_schema_cid": "...",
      "root_cid": "..."
    }
  ],
  "records": {
    "property": [],
    "parcel": [],
    "property_improvement": [],
    "company": [],
    "relationship_name": []
  },
  "source": {}
}
```

Keys under `records` are normalized Atlas tables present for that property. Do not assume
one fixed set. Discover tables and columns first.

## Query-table shape

`getPropertyQuerySchema` without `table` returns table names, kinds, primary-key columns,
and scoped row counts. With `table`, it returns columns plus:

- `property_cid`
- `parquet_data_group_cid` for normalized class/relationship tables

The synthetic `properties` table contains:

- `property_cid`
- `root_schema_cid`
- `root_cid`

`queryProperties` exposes whichever selected table you name through the logical SQL
relation `properties`.

## Identity and evidence

- Folio/request identifier is source identity; normalized parcel digits are not.
- `property_cid` joins normalized records to one property within reasoning.
- Company edges are authoritative only when published records carry accepted official
  corporate/licensing evidence.
- BBB, places, HOA, AVM, names, phones, and addresses are enrichment or candidates unless
  the published relationship explicitly establishes otherwise.
- Null or absent relationships remain unresolved; do not invent them.
