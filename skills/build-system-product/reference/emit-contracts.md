# Emit contracts for System

Zygarde writes deployable System configuration packages, not loose Product
stubs. Paths are relative to `configurations/<systemId>/`.

[`examples/sale-availability/`](examples/sale-availability/) is a complete,
checked package. Placeholders use `<angle-brackets>` wherever the owning agent
must supply a tenant value.

## System configuration package

```text
composition.manifest.json
product.definition.json
schemas/
  request.schema.json
  response.schema.json
flow-templates/
  <template_name>.json
product-flows/
  <flow_name>.json
waterfall.json                 # omit when invocation mode is single
invocation.contract.md
emits/
  lexicon/
  connect/
  transform/
  persist/
  deploy/
```

**Rules**

- `composition.manifest.json` uses `orchestration.mode: system-service`.
- `product.definition.json` names the Product and supplies schemas matching
  both `product-schema` refs.
- Every executable Product Flow sets `flow_template_name` and defaults to
  inactive.
- Every waterfall entry names an existing Product Flow and uses a unique
  positive `order`.
- Template peer calls use relative URLs and runtime-injected credentials.
- All config refs resolve inside the package or to a pinned public contract.
- Do not place account ids, secret ARNs, API keys, or developer AWS profiles
  in a package.

## Base service emits

For a new System repository, emit:

```text
bin/app.ts
lib/system-data-stack.ts
lib/system-workflow-stack.ts
lib/system-api-stack.ts
src/configuration/
src/domain/
src/handlers/
src/runtime/
src/workflow/
test/
```

The stacks must synthesize in data → workflow → API order. Configuration
loading must fail synth on malformed or unresolved packages.

## Lexicon → Conkeldurr/Mew

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
  collections.ref.md
```

Register it as a `persist-collection` configRef with a `persist` product and
workflow step whenever a flow template reads or writes Persist.

## Deploy → Conkeldurr

```text
emits/deploy/
  environment.stub.json      # activationEnabled false; cost ceiling; components[].refs → configRefs
```

## Handoff checklist

| Emit | Owner | Done when |
| --- | --- | --- |
| Base System | Zygarde | tests and all stacks synthesize |
| Product definition/template/flow | Zygarde | package validates and template compiles |
| Lexicon | Conkeldurr | Catalog/mapping path exists |
| Connect | Lapras | Partner configuration + activation accepted by the Connect API |
| Transform | Kecleon | Mapping enabled + acceptance |
| Persist | Conkeldurr | Collection contract agreed |
| Deploy | Conkeldurr | Synth with activation off |
| Manifest | Zygarde | both manifest validators pass; refs resolve; evidence is stated |
