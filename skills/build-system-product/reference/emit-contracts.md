# Emit contracts for product agents

Zygarde emits **reviewable stubs**. Agents turn stubs into real configs in
their target repositories or via Product APIs. Paths are relative to the
composition package root when one exists.

## Product orchestration → Conkeldurr + `build-product-service` (Machamp verify)

Emit:

```text
emits/product/
  product.definition.stub.json   # name, request_schema, response_schema, metadata
  flow-templates/
    <template_name>.stub.json    # DSL definition (+ persistence_integration / output_path)
  product-flows/
    <flow_name>.stub.json        # flow_template_name required; tags/active/metadata
  waterfall.stub.json            # optional { "waterfall": [{ "priority", "flow_name" }] }
  invocation.contract.md         # single_flow | waterfall; required fields; status gates
```

**Rules**

- Every executable flow stub sets `flow_template_name`.
- Template steps that call peers use relative URLs (Connect / Language /
  Persist / Product), not secrets.
- Prefer citing shapes from
  [implementation-evidence.md](implementation-evidence.md) and the Product
  PRD; do not paste tenant hostnames.

Integrate an existing Product deployment before provisioning a new one.

## Lexicon → Conkeldurr (`build-lexicon-product`)

```text
emits/lexicon/
  README.md
  catalog.stub.json
```

## Connect → Lapras (`build-connect-product`)

```text
emits/connect/
  source.stub.json
  tables.stub.json
```

Use `s3-file` for fixture pilots; never invent cross-tenant secret ARNs.

## Transform → Kecleon (`build-transform-product`)

```text
emits/transform/
  request.stub.json          # contractVersion 2; from/to; S3 locations only
  mapping.ref.md
```

## Persist → Conkeldurr (when invocations need collections/graph)

```text
emits/persist/
  collections.stub.md        # transaction/collection correlation expectations
```

## Deploy → Conkeldurr

```text
emits/deploy/
  environment.stub.json      # activationEnabled false
  cost-ceiling.md
```

## Thin System package → Zygarde (fallback only)

```text
systems/<id>/system.manifest.json
systems/<id>/openapi.yaml
systems/<id>/fixtures/
```

Allowed only when orchestration mode is `thin-package-deferred`.

## Handoff checklist

| Emit | Owner | Done when |
| --- | --- | --- |
| Product definition/template/flow | Conkeldurr (+ Machamp verify) | APIs accept config or PR merged |
| Lexicon | Conkeldurr | Catalog/mapping path exists |
| Connect | Lapras | Source registration + fixtures |
| Transform | Kecleon | Mapping enabled + acceptance |
| Persist | Conkeldurr | Collection contract agreed |
| Deploy | Conkeldurr | Synth with activation off |
| Manifest | Zygarde | Schema-valid + successCriteria listed |
