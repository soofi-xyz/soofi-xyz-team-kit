---
name: configure-inference-product
description: "Configure and test inferences on an existing Inference deployment: write an inference-1 configuration (Persist and Connect readers, model, prompt, typed assertion types with JSON Schemas), check its queries, save and test it through the API, put it in a configuration bundle, and have it published and installed by subscription. Use Elgyem; route service gaps to Beheeyem."
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Operate Inference configurations

Use `elgyem`. Load [guide-product-work](../guide-product-work/SKILL.md) and
[the Inference capability map](../guide-product-work/reference/iterations/inference.md).

Inference is deployed; this skill drives its HTTP API and never changes its code. The
authoritative product is [`prismteam-ai/inference`](https://github.com/prismteam-ai/inference):
write configurations from its `docs/configuration-contract.md`,
`schemas/inference-configuration.schema.json` and `examples/meet-to-asana.json`, and use the
routes in `docs/api.md`. They win over this skill when they differ.

## Status

Read [the Inference status table](../guide-product-work/reference/iterations/inference.md#status) before each step: it says what is installed and what is still
planned (runs and outcomes). Say which steps you could not exercise. Read the contract
from `prismteam-ai/inference` `main` with `git show origin/main:<path>`, without switching
the user's checkout.

## Prerequisites

1. Require `PRISM_API_KEY` (the environment's shared API key) in the user's terminal.
   Check presence with exactly this command and no other expansion of the variable:

   ```bash
   if [ -n "${PRISM_API_KEY:-}" ]; then echo "PRISM_API_KEY set (${#PRISM_API_KEY} chars)"; else echo "PRISM_API_KEY unset"; fi
   ```

   If it is unset, stop and ask the user to set it in their own terminal
   (`export PRISM_API_KEY=...`) from a teammate or the shared usage plan's key. Never read
   it from AWS, print it or ask for it in chat.
2. Get the shared domain from the user or their environment (`PRISM_DOMAIN`, for example
   `soofi-safavi.account.prismteam.ai`); never from SSM or stack outputs. Confirm the key
   with a read-only call that prints only the status code:

   ```bash
   INFERENCE_URL="https://$PRISM_DOMAIN/inference"
   curl -sS -o /dev/null -w '%{http_code}\n' -H "x-api-key: $PRISM_API_KEY" "$INFERENCE_URL/configurations"
   ```

   `200` is ready and `403` a rejected key. `404` means Deploy has not installed Inference
   in this environment: hand the subscription to `skarmory` and stop.
3. Use no AWS credentials. Every checkpoint is a product-API read-back; AWS inspection is
   optional evidence the user gathers with their own access.

## Write a configuration

1. Start from `examples/meet-to-asana.json`. Give it a `name` (`^[a-z][a-z0-9-]{1,62}$`),
   a semantic `version`, a `title` and a `description`.
2. **Source and destination.** Each reads items from `persist.items` (read-only Gremlin,
   one row per item with an `id`), optional `persist.links`, or Connect `flow` entries
   (run once per run; every landed row is an item; set `system` to `SOC` or `PRISM` when
   assertions about those items belong to one). Add a Connect `lookup` only for content
   an item's row lacks. Use only `{{window.from}}`/`{{window.to}}` in queries and flow
   params, and `{{item.<field>}}` in lookup input. `partner` is the Connect
   `configuration_id` (`asana-prism`, `asana-primary`).
3. Check each reader before saving:
   - Run every Gremlin query, with a real window substituted, through Persist's read-only
     `POST /persist/gremlin` and report its row count and one redacted row shape.
   - Confirm each Connect flow and partner exists by name (`GET` on the Connect API).
     A missing flow or partner configuration goes to `wingull`.
4. **Model and prompt.** Use a `model.id` the stack provides (`claude-opus-5-5`), a
   `thinking.budgetTokens` below `maxOutputTokens`, and a new `prompt.version` whenever
   `instructions` change; runs and assertions record it. Write instructions that say what
   a change is and is not, how to read the source and which destination items qualify;
   do not paste real meeting text into them.
5. **Assertion types.** Define 1–20 types, each a change a groomer can apply or reject on
   its own:
   - a key (`^[a-z][a-z0-9_]{0,62}$`) and a one-sentence `description` the model reads;
   - a default `scope`: `SMALL` edits one field of one item, `BROAD` reshapes the work;
   - a strict object `schema` (JSON Schema 2020-12): `additionalProperties: false`,
     `required` fields, the destination item id (such as `task`), the proposed text,
     `replaces` for edits, `evidence` as source item ids (`minItems: 1`) and an optional
     `confidence` in 0–1.
   A new type is a configuration change, never a Model change. Changing a type's schema is
   a new configuration version.
6. Put no credentials, tokens or personal data in the configuration.

## Test through the API

Direct saves and runs are for testing only; the bundle delivers the configuration.

1. Save, testing only, and read the outcome:

   ```bash
   curl -sS -X PUT -H "x-api-key: $PRISM_API_KEY" -H 'content-type: application/json' \
     --data-binary @configuration.json "$INFERENCE_URL/configurations/<name>" | jq .
   ```

   Expect `201 CREATED`, or `200 UPDATED`/`UNCHANGED`. Fix every `error.problems` entry of
   a `400 INVALID_CONFIGURATION`. `409 VERSION_CONFLICT` means that version is saved with
   other content: raise the version. Saving over a bundle-installed configuration changes
   what runs use until the next install; tell the user.
2. Read it back with `GET $INFERENCE_URL/configurations/<name>` (and `?version=x.y.z`) and
   compare with the file; `GET $INFERENCE_URL/configurations` lists every name.
3. **Runs (once built).** Start one run over one source item or a short window, only within
   the requested scope: each calls Opus 5.5 and costs money. `202` is acceptance; follow
   `GET /inference/runs/{run_id}` to `SUCCEEDED` or `FAILED` and report items read,
   assertions produced, tokens (including cache reads) and cost.
4. **Assertions (once the extension is installed).** Read them with read-only Gremlin
   through `POST /persist/gremlin`, using the open-assertion queries in the extension's
   README, and check each one's type, destination, scope and cited evidence against the
   source. Judge precision by hand on a small sample before widening the window.
5. Delete nothing by hand: Inference has no delete route, and versions are immutable.

## Deliver through a bundle

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md).
Ship configurations in a CONFIGURATION bundle repository created from
`prismteam-ai/configuration-bundle-template`:

- `inference/<name>.json`: the configuration document.
- `bundle.json`: an entry with `product: "inference"`, `kind: "configuration"`, the `id`
  and its `source`; parameters only for per-install values, each with a review-safe default;
  `secrets: {}`.
- `marketplace.product.json`: `bundle_type: CONFIGURATION` and a dependency on product
  `54ad9a54-ea96-4b30-a234-c7378bc1a6d0`, component `inference`, plus Connect when the
  configuration reads Connect flows.

Then deliver in the shared order:

1. **Bundle PR:** open it and work it until CI (`validate-configuration`) and reviews are
   clean; the user merges. Never push to `main` or merge. Use
   `prismteam-ai/inference-meet-to-asana` as the example.
2. **Publish:** `registeel` confirms the Marketplace release is `VALID`.
3. **Subscribe:** `skarmory` creates or updates the Deploy Puller subscription with
   `update_policy: AUTO` and reads the install back.
4. **Verify:** read the installed configuration back through `GET
   /inference/configurations/<name>` and compare version and content with the bundle.
5. **Report** test-only versions you saved directly that the bundle did not install;
   they stay in history but are not current once the bundle's version is.

## Hand off

A missing capability, a wrong validation, a failing run that is not the configuration's
fault, or an assertion written in the wrong shape goes to `beheeyem` with a redacted
reproducer (configuration, run id, error). Missing Connect flows go to `wingull`, Persist
query problems to `uxie`, extension changes to `jirachi`. Never edit Inference code to make
one configuration pass.

## Configuration provenance

Follow [configuration provenance: repo-linked Deploy installs](../guide-product-work/reference/configuration-provenance.md).
Do not write configuration directly to the Inference API in an environment; ship it
through its configuration repository, Build, Marketplace and Deploy. Expect
400 `PROVENANCE_REQUIRED` where the install sets `ConfigurationProvenance` to
`Enabled`. To test in dev, install through Deploy or set the dev stack to `Warn`.
