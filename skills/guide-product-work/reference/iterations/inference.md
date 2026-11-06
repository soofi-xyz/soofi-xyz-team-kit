# Inference capability map

Apply [stable stack identity](../../../build-product-deployer/reference/stack-identity.md)
to synthesis, review and installation: one stack, `Inference`, with no deployment stage,
installed through Marketplace and Deploy and updated in place.

Use Beheeyem to implement Inference and Elgyem to configure it on an existing deployment.
Follow the [shared workflow](../../SKILL.md). These 9 areas are a starting inventory, not a
fixed iteration count. Order dependencies and split independently useful features further.
Use at least four pieces for a full-product build; narrow work selects only relevant
pieces. Keep automated tests and user/AWS feedback inside each piece, not as a final
testing phase.

Inference reads a configured **source** (first case: Google Meet utterances in Persist) and
**destination** (first case: the Prism and SOC Asana backlogs, read through Connect flows),
asks a Bedrock model what should change in the destination, and writes typed
**assertions** to Persist. A separate groomer agent applies or rejects them. Every source,
destination, prompt and assertion type is configuration (contract `inference-1`); the
service holds none.

Prism Marketplace: family Prism, category Platform, product Inference
(`54ad9a54-ea96-4b30-a234-c7378bc1a6d0`), SERVICE component `inference`, base path
`inference` on the shared domain behind the shared `x-api-key`.

| Feature ID / usable capability | Dependency | Builder increment / configurer exercise | AWS inspection and acceptance |
| --- | --- | --- | --- |
| `configuration` — validate, save and version a configuration | Shared API domain and key | Deliver `PUT`/`GET /inference/configurations/{name}` (`?version=`) and `GET /inference/configurations` against `schemas/inference-configuration.schema.json`. Exercise the repository example, an unchanged save, a rollback to an earlier version, a changed document under a saved version (`409 VERSION_CONFLICT`) and a refused one (unknown field, writing Gremlin, bad variable, invalid type schema). | Read the DynamoDB state and version items; confirm a refused or conflicting save wrote nothing. |
| `model-profile` — a tagged application inference profile per model | None | Deliver one `AWS::Bedrock::ApplicationInferenceProfile` per supported `model.id`, copied from the US cross-region system profile and tagged `product=inference`. Exercise a configuration naming a supported and an unsupported model. | Read the profile ARN from the stack output and its tags; after a call, find its spend under the `product` cost allocation tag. |
| `readers` — read source and destination items | Configuration; Persist and Connect in the account | Deliver Persist Gremlin readers (`items`, optional `links`, window variables) and Connect readers (`flow` once per run, `lookup` once per item). Exercise a window with items, an empty window and a failing Connect job. | Follow the Persist query and the Connect job ids in the run's logs; confirm reads are bounded and nothing is written. |
| `inference-call` — one Bedrock call per source item with thinking and caching | Readers; model profile | Deliver the Converse call through the application profile, extended thinking within `budgetTokens`, cache points on the stable prefix, and parsing and schema validation of every proposed assertion. Exercise two items with the same configuration (cache read on the second) and a response with an invalid assertion. | Read the run's token counts (`cache_read_tokens` above zero on the second call) and the Bedrock invocation metrics for the profile. |
| `assertion-write` — store assertions per the Model `inference` extension | Inference call; the extension installed in Persist | Deliver one synchronous `POST /persist/ingest` per attempt: the `inference_run`, configuration and prompt-version vertices and edges, each new `assertion` with its `CREATED` edge and source edges using `vertexRefs`. Exercise a run with assertions and one with none. | Query the run and its assertions with read-only Gremlin; confirm no base vertex was re-sent and the counts match the run. |
| `runs` — start, follow and list runs; the run ledger | Assertion write | Deliver `POST /inference/runs` (one source item or a time window, `202`), `GET /inference/runs/{run_id}`, `GET /inference/runs`, deterministic run identifiers, attempts, and skipping items with a `SUCCEEDED` run. Exercise a window, the same window again (skipped), and a retried failure. | Read the run records and the run's execution logs; compare tokens and `cost_usd` with the Bedrock metrics. |
| `repeats` — recognize an open assertion found again | Runs | Deliver matching against open assertions for the same destination item and type: add a `REPEATED` run edge and new source edges instead of a second assertion. Exercise a source restating a decision already asserted. | Query the assertion's run edges; confirm one `CREATED` and one `REPEATED` edge and no new assertion. |
| `outcomes` — record a groomer decision | Assertion write | Deliver `POST /inference/assertions/{id}/outcome` writing `assertion_outcome` and its edges (`decided_by` an account or `agent:groomer`). Exercise an applied and a rejected outcome and a second outcome for the same assertion. | Query the assertion's `status` index and outcome; confirm the assertion vertex itself is unchanged. |
| `bundle-install` — install configurations from bundles | Configuration; Build and Deploy support for product `inference`, kind `configuration` | Keep `PUT` semantics for Deploy's GET → PUT → GET adapter (201/200 `CREATED`/`UPDATED`/`UNCHANGED`, `409` for changed content). Exercise a bundle install, an unchanged re-install and a new version with unchanged service code. | Read the Deploy run result and `GET /inference/configurations/{name}`; compare the installed version and digest with the bundle. |

## Status

This table is the kit's only record of what exists; the agents and skills link here.
Update it when a piece lands, and check it against the target revisions and environment
before relying on it.

| Piece | State (2026-11-06) |
| --- | --- |
| Service: stack, model profile, configuration API (`configuration`, `model-profile`) | Merged in `prismteam-ai/inference` (PR #1). Installed in soofi-safavi through a Deploy Puller subscription with `update_policy: AUTO`; `GET /inference/health` answers `200`. |
| Runs, run ledger, repeats, outcomes (`readers`, `inference-call`, `assertion-write`, `runs`, `repeats`, `outcomes`) | **Planned**, in progress in `prismteam-ai/inference`: `POST /inference/runs`, `GET /inference/runs[/{run_id}]`, `POST /inference/assertions/{id}/outcome`. Confirm the routes in the target revision before calling them. |
| Model `inference` extension | Merged (`prismteam-ai/model` PR #60) and published as release `rel-88f811c32edb3287`; installed in soofi-safavi's Persist by a one-off `persist_lexicon` run. The README on model `main` still says "draft, not submitted"; [prismteam-ai/model#63](https://github.com/prismteam-ai/model/pull/63) updates it. |
| Bundles: product `inference`, kind `configuration` (`bundle-install`) | Build checks it (`prismteam-ai/build` PR #56, deployed centrally); Deploy installs it with GET → PUT → GET (`prismteam-ai/deploy` PR #83, installed in soofi-safavi). There is no `inference` kind. |
| Bundle repositories | `prismteam-ai/inference-meet-to-asana` (Inference) and `prismteam-ai/inference-report` (a Report bundle, `product: report`, over Inference data), each with an open first PR; registered in Marketplace as InferenceMeetToAsana and InferenceReport. |
| Marketplace | Product Inference (`54ad9a54-ea96-4b30-a234-c7378bc1a6d0`), family Prism, category Platform, SERVICE component `inference`. |

Discover actual routes, statuses and resource names from the target revision; its
`README.md`, `docs/configuration-contract.md`, `docs/api.md` and `requirements/swagger.yml`
are authoritative over this map.

Exercise each piece through the HTTP API, including submission (`POST /inference/runs`,
`202`), status and results for runs. Direct AWS inspection supports evidence; it does not
replace API use. Give one invocation and at most three AWS inspection steps, collect the
person's redacted run id and observation, and wait for that feedback before implementing
or configuring the next piece. Keep local tests, synthesis, runs over test data and runs
over live meetings and backlogs distinct. A run calls the model and costs money; start
runs only within the requested scope.

Keep Persist storage and indexes with Conkeldurr/Uxie, Connect flows and partner
credentials with Lapras/Wingull, the `inference` extension with Dialga/Jirachi,
publication with Registeel and installation with Skarmory. Applying assertions to the
destination belongs to the groomer, not Inference.

Apply [the configuration-bundle contract](../../../build-product-deployer/reference/configuration-bundles.md)
when a configuration is installed from a bundle, and
[the shared API domain contract](../shared-api-domain.md) within the relevant pieces:
base path `inference`, the shared usage plan, no public routes.
