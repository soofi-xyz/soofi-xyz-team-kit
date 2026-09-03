---
name: transform-v2-builder
description: "Help Elephant CLI users build, run, and debug transform v2 handler packages. Use when authoring or repairing county `handler.js` transform packages, using `elephant-cli transform --transform-version 2`, inspecting Browser Flow v2 captures, packaging `--transform-zip`, writing `writeJson`/`writeRelationship` calls, or validating transformed output."
metadata: {"author":"elephant-xyz"}
---
# Transform v2 Builder

## When To Use

Use this skill when helping a CLI user create, run, or debug an Elephant transform v2 handler package for a prepared county data ZIP.

Do not treat this as a CLI development workflow. Do not inspect or modify Elephant CLI source code unless the user explicitly asks to change the CLI itself. Focus on the user's transform package, prepared ZIP, command invocation, output ZIP, validation errors, and repair loop.

Transform v2 means:

- Input is a Browser Flow v2 prepared ZIP with `address.json`, `parcel.json`, `captures.json`, and `captures/*.html`.
- Transform package is a ZIP with root ESM `handler.js`.
- Handler reads captures and writes entity and relationship outputs through helper APIs.
- Elephant CLI injects entity metadata, writes relationship file shape, and creates the data-group root.

## First Steps

1. Confirm the user has a Browser Flow v2 prepared ZIP.
2. Inspect the ZIP structure and capture names without changing it.
3. Draft or repair root-level `handler.js`.
4. Package `handler.js` into a transform ZIP.
5. Run `elephant-cli transform --transform-version 2`.
6. Run `elephant-cli validate` on the transformed ZIP when available.
7. Iterate on handler errors and validation errors.

If repo-local docs are available, prefer user-facing docs such as `docs/TRANSFORM-V2.md` or README sections. Avoid source files unless troubleshooting a suspected CLI bug.

## Inspect Prepared Input

The prepared ZIP must look like:

```text
prepared-site.zip
├── address.json
├── parcel.json
├── captures.json
└── captures/
    ├── property-detail.html
    └── tax-detail.html
```

Before writing a handler:

- Read `captures.json` to find capture names.
- Read `address.json` and `parcel.json` to understand available seed data.
- Inspect only relevant capture snippets; large HTML can be searched rather than loaded fully.
- If `captures.json` is missing, the input is not a transform v2 input.

## Handler Contract

Create a ZIP containing root-level `handler.js`:

```js
export const config = {
  timeoutMs: 120000,
};

export async function handler({ input, readCapture, writeJson, writeRelationship }) {
  const html = await readCapture('property-detail');

  await writeJson('property', {
    parcel_identifier: input.parcel.parcel_identifier,
    page_has_property_heading: html.includes('Property Detail'),
  });

  await writeJson('address', input.address);

  await writeRelationship({
    type: 'property_has_address',
    name: 'relationship_property_address',
    from: 'property',
    to: 'address',
  });
}
```

Rules:

- Use `readCapture(name)` for every HTML capture; do not expect root-level `input.html`.
- Use `writeJson(name, value)` for entity outputs only.
- Use `writeRelationship({ type, name, from, to })` for relationship outputs.
- Use snake_case filename stems, no `.json` suffix and no subdirectories.
- `from` and `to` must reference stems previously written with `writeJson()`.
- Do not write directly to filesystem paths.
- Do not auto-copy seed records; explicitly call `writeJson('address', input.address)` or `writeJson('parcel', input.parcel)` when needed.
- Do not include data-group root files manually; the CLI creates them from `writeRelationship()` calls.

## Metadata Semantics

For `writeJson()` outputs:

- CLI always sets `request_identifier` from `parcel.json`.
- CLI fills missing `source_http_request` from `parcel.json.source_http_request`.
- Handler-provided `source_http_request` is preserved for capture-specific source URLs.

For `writeRelationship()` outputs:

- Do not include `request_identifier`.
- Do not include `source_http_request`.
- Let the CLI write IPLD links and include the relationship in the data-group root.

## Build And Debug Loop

Use this loop for user handler packages:

1. Inspect `captures.json` and capture names.
2. Write or patch `handler.js`.
3. Package it:

```bash
zip transform-v2.zip handler.js
```

4. Run transform:

```bash
elephant-cli transform \
  --transform-version 2 \
  --transform-zip transform-v2.zip \
  --input-zip prepared-site.zip \
  --output-zip transformed-data.zip
```

5. Validate output:

```bash
elephant-cli validate transformed-data.zip
```

6. Feed transform errors, validation CSV rows, and relevant capture snippets back into the next repair cycle.

When repairing a handler, change the smallest amount of handler code needed to address the observed transform or validation failure.

## High-Throughput Batch Execution: Warm Worker Pools

When running transforms across a full county (100k–500k+ parcels), executing `elephant-cli transform` in separate child processes per parcel is inefficient. Spawning fresh Node.js processes per parcel incurs heavy V8 startup and module compilation overhead.

**Warm Worker Pool Implementation Guide**:
- Create a persistent worker (`transform-worker.cjs`) that requires Cheerio and transform modules once on initialization.
- Maintain an in-memory worker pool (`child_process.fork()`) with concurrency equal to the number of available CPU cores.
- Communicate via IPC messages: send `{ parcelDir }` and await `{ success, error, stats }`.
- Read inputs directly from `prepared_site.zip` using in-memory zip handlers (`AdmZip`) rather than unzipping to disk.
- Result: Increases parcel transform speed from ~2-5 parcels/sec to **30-60+ parcels/sec** while drastically reducing memory churn and thermal throttling.

## Output Expectations

Transform v2 writes an output ZIP containing `data/`:

```text
transformed-data.zip
└── data/
    ├── property.json
    ├── address.json
    ├── relationship_property_address.json
    └── <data-group-schema-cid>.json
```

Check output by extracting or listing the ZIP:

```bash
unzip -l transformed-data.zip
```

If expected files are missing, inspect whether the handler called `writeJson()` or `writeRelationship()` for them.

### Unmapped source codes: skip-and-warn, never abort

When a source code (e.g. a DOR use code) has no lexicon mapping, the handler must
preserve the raw code in `source_payload`, emit a warning/flag on the field, and
CONTINUE the parcel — never throw/abort the parcel over one unmapped code. A throw
aborts the WHOLE parcel, and because one code often covers a whole property class,
aborting once silently dropped entire condo classes from a county. Inventory the
unmapped codes across a sample run and add the missing mappings before scaling.
(This is the rule `county-appraisal-onboarding` cross-references.)

- Address composition: never prepend `streetNumber` to a `propertyAddress` that already
  includes it — the old pipeline produced `"5034 5034 LOYOLA LN"`. Regression-check a
  sample of output for duplicated leading street numbers.

## Common Failures

- `captures.json is required for transform v2`: input ZIP is not Browser Flow v2 output.
- `captures.json is invalid JSON`: manifest exists but cannot be parsed.
- `Unknown capture`: handler requested a name not present in `captures.json`.
- `Invalid output name`: helper name is not a snake_case stem.
- `Unknown relationship source/target`: relationship references an entity not written with `writeJson()`.
- `Relationship type ... is not valid`: `type` is not a relationship key in the selected data-group schema.
- `--scripts-zip cannot be used with transform v2`: v1 and v2 package contracts were mixed.

## User-Safe Defaults

- Prefer `County` data group unless the user specifies another `--data-group`.
- Preserve handler-provided `source_http_request` when it describes a more specific capture URL.
- Keep handler code explicit and readable; avoid generic scraping frameworks unless the user needs them.
- If the issue appears to be a CLI bug rather than a handler/package problem, stop and explain the suspected CLI issue before changing any CLI source.
