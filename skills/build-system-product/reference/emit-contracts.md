# Emit contracts for product agents

Zygarde emits **reviewable stubs**. Product agents turn stubs into real configs
in their target repositories. Paths below are relative to the System package
root when a target repo exists; for kit-only work, keep emits under the skill
worked example or session notes.

## Lexicon → Conkeldurr (`build-lexicon-product`)

Emit:

```text
emits/lexicon/
  README.md                 # which languages/mappings the System needs
  catalog.stub.json         # logical language ids + mapping ids (no secrets)
```

Minimum stub fields: `languages[]` (`id`, `purpose`), `mappings[]`
(`from`, `to`, `id`, `status: proposed`). Prefer pointing at existing Elephant
Lexicon `publish/pipelines` paths when known. Do not invent published digests.

## Connect → Lapras (`build-connect-product`)

Emit:

```text
emits/connect/
  source.stub.json          # adapter id, source language, entity scope
  tables.stub.json          # logical tables + record keys (no credentials)
```

Reference `skills/build-connect-product/reference/contracts.md` for real shapes.
Use `s3-file` for fixture-backed pilots; `postgres-jdbc` only when network and
secrets are authorized. Never put Secrets Manager ARNs from another tenant in
the stub without session evidence.

## Transform → Kecleon (`build-transform-product`)

Emit:

```text
emits/transform/
  request.stub.json         # contractVersion 2, from, to, input/output prefixes
  mapping.ref.md            # points at Lexicon mapping id / path
```

Requests name only `from` / `to` languages and S3 locations. Formats and SQL
live in Lexicon mappings — do not embed Spark SQL in the System manifest.

## Deploy → Conkeldurr

Emit:

```text
emits/deploy/
  environment.stub.json     # region/stage placeholders, activationEnabled false
  cost-ceiling.md           # default ceiling note; resolve real value from env
```

Do not hardcode developer AWS profile names.

## System runtime → Zygarde (target repo only)

Emit / own:

```text
systems/<id>/system.manifest.json
systems/<id>/openapi.yaml
systems/<id>/fixtures/
```

Handlers load curated artifacts; they do not call Connect/Transform engines
inline unless the composition explicitly schedules those products out-of-band.

## Handoff checklist

| Emit | Owner agent | Done when |
| --- | --- | --- |
| Lexicon stubs | Conkeldurr | Catalog/mapping PR or local catalog path exists |
| Connect stubs | Lapras | Source registration + acceptance fixtures |
| Transform stubs | Kecleon | Mapping enabled + local transform acceptance |
| Deploy stubs | Conkeldurr | Synth with activation off |
| Manifest | Zygarde | Schema-valid + successCriteria listed |
