# Bounded jq Queries

Run from this `reference/` directory or set `REFERENCE_DIR` to its absolute path.

## Inspect modeling profiles

```bash
jq -c 'limit(3; .models[]) | {id, paradigm, counts, semantics}' \
  "$REFERENCE_DIR/manifest.json"
```

## Search the catalog

```bash
jq -c --arg query "communication" '
  ($query | ascii_downcase) as $query |
  limit(12;
    .entries[]
    | select(
        ([.type, (.properties // []), (.relationships // []), .from, .to]
         | tostring | ascii_downcase | contains($query))
      )
    | {model, kind, type, from, to, properties, relationships}
  )
' "$REFERENCE_DIR/catalog.json"
```

## Find exact type matches across paradigms

```bash
jq -c --arg type "payment" '
  limit(10;
    .entries[]
    | select(.type == $type)
    | {model, kind, type}
  )
' "$REFERENCE_DIR/catalog.json"
```

Use the property-graph match when no paradigm was requested and one exists. Do not combine definitions from multiple matches.

## Return one exact property-graph definition

```bash
jq -c --arg type "payment" '
  . as $model |
  first($model.vertices[] | select(.type == $type)) as $entity |
  {
    entity: $entity,
    relationships: [
      limit(50;
        $model.edges[]
        | select(.from == $type or .to == $type)
      )
    ]
  }
' "$REFERENCE_DIR/model-b.json"
```

This is the complete-but-bounded lookup recipe for one property-graph type. It returns all observed entity properties, required fields, enums, indexes, and up to 50 one-hop relationships.

## Return one exact class definition

```bash
jq -c --arg type "payment" '
  limit(1;
    .classes[]
    | select(.type == $type)
    | {
        class: .,
        relationship_count: ((.relationships // {}) | length)
      }
  )
' "$REFERENCE_DIR/model-a.json"
```

Use the same query against `model-c.json` when the selected paradigm is the class/relationship catalog.

## Find one class

```bash
jq -c --arg type "person" \
  'limit(1;
    .classes[]
    | select(.type == $type)
    | {type, required, properties: (.properties | keys), relationships}
  )' \
  "$REFERENCE_DIR/model-a.json"
```

The same bounded class query works against `model-c.json`.

## Find one vertex

```bash
jq -c --arg type "person" \
  'limit(1;
    .vertices[]
    | select(.type == $type)
    | {type, required, properties: (.properties | keys), indexes: ((.indexes // {}) | keys)}
  )' \
  "$REFERENCE_DIR/model-b.json"
```

## Inspect one-hop graph relationships

```bash
jq -c --arg type "person" \
  'limit(20;
    .edges[]
    | select(.from == $type or .to == $type)
    | {type, from, to, properties: ((.properties // {}) | keys)}
  )' \
  "$REFERENCE_DIR/model-b.json"
```

## Inspect one property

```bash
jq -c --arg type "person" --arg property "first_name" \
  'limit(1;
    .classes[]
    | select(.type == $type and .properties[$property] != null)
    | {type, property: .properties[$property], required: (.required // [] | index($property) != null)}
  )' \
  "$REFERENCE_DIR/model-c.json"
```

## Prohibited reads

Do not run:

```bash
cat model-a.json
jq '.' model-b.json
jq '.classes' model-c.json
```

Do not place an entire file, full class list, or unbounded relationship list into model context.
