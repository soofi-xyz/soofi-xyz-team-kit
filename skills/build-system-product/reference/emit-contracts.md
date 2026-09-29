# Emit contracts for product agents

Zygarde emits **reviewable stubs**. Agents turn stubs into real configs in
their target repositories or via Product APIs. Paths are relative to the
composition package root when one exists.

[`examples/sale-availability/emits/`](examples/sale-availability/emits/) is a
complete, checked set of these stubs. Placeholders use `<angle-brackets>`
wherever the owning agent must supply a tenant value.

## Product orchestration → Conkeldurr + `build-product-service` (Machamp verify)

Emit:

```text
emits/product/
  product.definition.stub.json   # name, request_schema, response_schema, metadata
  flow-templates/
    <template_name>.stub.json    # DSL definition (+ persistence_integration / output_path)
  product-flows/
    <flow_name>.stub.json        # flow_template_name required; tags/active/metadata
  waterfall.stub.json            # optional { "waterfall": [{ "flow_name", "order", "stop_on_status" }] }
  invocation.contract.md         # invocation_mode single | waterfall; required fields; status gates
```

**Rules**

- Field names follow the target
  [Product PRD](../../build-product-service/reference/PRD.md) §3.2–3.6, not
  Staircase legacy (`single`, not `single_flow`; waterfall `order`, not
  `priority`).
- Every executable flow stub sets `flow_template_name` to an emitted
  template's `name`.
- `StaircaseService` field names in template stubs are drafts; Machamp
  confirms them against the Product template validator at compile.
- Template steps that call peers use relative URLs (Connect / Language /
  Persist / Product), not secrets.
- Prefer citing shapes from
  [implementation-evidence.md](implementation-evidence.md) and the Product
  PRD; do not paste tenant hostnames.

Integrate an existing Product deployment before provisioning a new one.

## Lexicon → Conkeldurr (`build-lexicon-product`)

```text
emits/lexicon/
  catalog.stub.json          # status "proposed"; languages + spark-sql mappings, no digests yet
```

Language and mapping fields follow Transform's `LanguageRegistration` and
`Mapping`; Lexicon adds `s3Uri`/`sha256` when it publishes the catalog.
Lexicon is already deployed, so this stub is a catalog addition for the
existing deployment, never a request to provision Lexicon.

## Connect → Lapras (`build-connect-product`)

```text
emits/connect/
  partner.stub.json          # PartnerConfiguration for an existing flow
  activation.stub.json       # Activation pinned to flow_name + flow_version; enabled false
```

Reuse a catalog flow (for example `partner-file-intake`) before asking for a
new one. Connect only talks to external systems; secrets stay as Secrets
Manager placeholders on connections, never in the manifest.

## Transform → Kecleon (`build-transform-product`)

```text
emits/transform/
  request.stub.json          # Transform Request: contractVersion 2; from/to; S3 locations only
```

`from` → `to` must match a mapping in the Lexicon stub.

## Persist → Conkeldurr (when invocations need collections/graph)

```text
emits/persist/
  collections.stub.md        # transaction/collection correlation expectations
```

Register it as a `persist-collection` configRef with a `persist` product and
workflow step whenever a flow template reads or writes Persist.

## Deploy → Conkeldurr

```text
emits/deploy/
  environment.stub.json      # activationEnabled false; cost ceiling; components[].refs → configRefs
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
| Connect | Lapras | Partner configuration + activation accepted by the Connect API |
| Transform | Kecleon | Mapping enabled + acceptance |
| Persist | Conkeldurr | Collection contract agreed |
| Deploy | Conkeldurr | Synth with activation off |
| Manifest | Zygarde | `scripts/check-system-manifest.py` passes |
