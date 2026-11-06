---
name: build-inference-product
description: "Build or maintain the Inference product: the inference-1 configuration API, generic Persist and Connect readers, Bedrock calls with extended thinking and prompt caching through its tagged application inference profile, assertion writes per the Model inference extension, the run ledger, outcomes, packaging and verification. Use Beheeyem; use Elgyem to configure inferences on an existing deployment."
disable-model-invocation: true
---

For infrastructure, bundle or installation work, load
[the stable stack identity contract](../build-product-deployer/reference/stack-identity.md).
Do not introduce deployment stages. Preserve the same stack across direct and
Marketplace/Deploy installation; verify support before running an update.

# Build Inference

Use `beheeyem`. Load [guide-product-work](../guide-product-work/SKILL.md),
[the Inference capability map](../guide-product-work/reference/iterations/inference.md)
and [engineering guidelines](../apply-engineering-guidelines/SKILL.md).
Use `elgyem` with [configure-inference-product](../configure-inference-product/SKILL.md)
for configurations on an existing deployment.

The implementation is [`prismteam-ai/inference`](https://github.com/prismteam-ai/inference).
Its `AGENTS.md`, `README.md`, `docs/configuration-contract.md`, `docs/api.md`,
`schemas/inference-configuration.schema.json` (the only copy of the schema) and
`requirements/swagger.yml` are authoritative over this skill. The stored format is the
Model `inference` extension, `configurations/inference/README.md` in
[`prismteam-ai/model`](https://github.com/prismteam-ai/model).

## Status

Read [the Inference status table](../guide-product-work/reference/iterations/inference.md#status) for what is merged, installed and planned; sections marked
*planned* below describe pieces that table lists as not built yet.

## Rules

- Keep Inference generic. Never add code, branches, tests or fixtures that name meetings,
  Asana or one configuration. Everything specific lives in a configuration's queries,
  Connect flows, prompt and assertion types. A new need is an `inference-1` contract
  change every configuration can use, documented in the contract and the schema.
- Keep versions immutable. A changed document under a saved version is `409
  VERSION_CONFLICT`; content is compared by the SHA-256 of canonical JSON (sorted keys).
- Keep assertions typed. A run writes only types its configuration version defines, with
  fields valid against that type's schema (`assertionValidator`).
- Keep readers read-only and bounded: Gremlin write steps (`addV`, `addE`, `property`,
  `drop`, `mergeV`, `mergeE`, `io`, `call`) are refused at save time, including inside
  child traversals and behind comments.
- Keep secrets, meeting text, destination text and model output out of logs, fixtures,
  examples and Git. Log ids, counts, tokens and cost only. Treat `reason`, `before_text`
  and `after_text` as INTERNAL.
- TypeScript strict, CDK the only IaC, one stack `Inference` with no stage suffix, every
  route behind the shared `x-api-key`. Do not `cdk deploy` from the repository; Inference
  reaches accounts through Marketplace and Deploy.

## Architecture

| Path | Role |
| --- | --- |
| `src/configuration/` | `inference-1` model, save-time validation, assertion validation |
| `src/api/` | Routes (`routes.ts` is the table; `KEY_ROUTES` drives the stack and the spec), HTTP helpers |
| `src/store/` | DynamoDB store: configuration state and immutable versions; run records planned |
| `src/handlers/` | Lambda entries: API, shared usage plan attachment |
| `src/run/` | Planned: readers, Bedrock call, assertion write |
| `cdk/`, `marketplace/` | Stack `Inference`, cdk-nag suppressions, Marketplace app |
| `scripts/api-spec.ts` | Generates `requirements/swagger.yml`; a test fails when it drifts |

The stack holds one application inference profile per supported `model.id` (now
`claude-opus-5-5`, copied from `us.anthropic.claude-opus-5-5`) tagged `product=inference`
and `model=<id>`, a retained DynamoDB table, the API Lambda and a REST API mapped to the
shared domain at `inference`, attached to the shared usage plan from
`/account/shared-usage-plan-id`. Adding a model is a `MODELS` entry plus a schema enum;
never call Bedrock with a bare model id or a system profile, or the spend loses its tag.

## Configuration contract

`inference-1` says what a run reads, which model and prompt it uses and which assertion
types it may write:

- `source` and `destination` share one reader shape: `persist.items` (Gremlin, one row per
  item with `id`), optional `persist.links`, and `connect` entries of `kind: "flow"` (a
  Connect job once per run; every landed row is an item; optional `system` `SOC`/`PRISM`)
  or `kind: "lookup"` (once per item, `input` from `{{item.<field>}}`). Queries and flow
  params may use only `{{window.from}}` and `{{window.to}}`.
- `model` (`id`, `maxOutputTokens` 1024–128000, optional `thinking.budgetTokens` below it),
  `prompt` (`version`, `instructions`).
- `assertionTypes`: 1–20 keys, each with `description`, default `scope` and a strict JSON
  Schema 2020-12 object schema.

`PUT /configurations/{name}` answers `201 CREATED`, `200 UPDATED` (new version or rollback),
`200 UNCHANGED` (byte-identical read-back), `400 INVALID_CONFIGURATION` with
`error.problems` (JSON pointers), `400 NAME_MISMATCH` or `409 VERSION_CONFLICT`. Deploy's
adapter relies on these; keep them.

## Bedrock call (planned)

- Use the Converse API on the profile ARN from `MODELS`. Grant `bedrock:InvokeModel` on
  the application profile and the foundation-model ARNs its system profile routes to, no
  wildcard model access.
- Extended thinking: pass `thinking: { type: "enabled", budget_tokens }` in
  `additionalModelRequestFields` when the configuration sets `thinking`. Keep
  `maxTokens` above the budget, leave temperature at its default and do not force a tool
  choice; both conflict with thinking. Never store or log thinking text.
- Prompt caching: order the request stable-first (service instructions, the
  configuration's prompt and assertion-type schemas, then the destination items, which
  are the same for every source item in a run) and put a `cachePoint` after that prefix;
  the source item comes last. Verify `cacheReadInputTokens` is above zero on the second
  item of a run, and record cache read and write tokens separately.
- Ask for assertions as one JSON document. Parse it, refuse unknown types and validate
  each item against its type's schema; an invalid response fails the attempt with an
  error class, never a partial write. Retry throttling with backoff inside the attempt.
- Compute `cost_usd` from the usage counts and a versioned price table in code; check it
  against the Bedrock pricing page when adding a model.

## Readers (planned)

Run Persist queries through Persist's read-only Gremlin API and Connect flows through
`POST /connect/partners/{partner}/flows/{flow}/jobs`, following the job to its result and
reading the landed JSONL; run lookups through `POST /connect/partners/{partner}/lookups/{lookup}`
per item. Substitute window and item variables as JSON string values, never by string
concatenation into Gremlin. Bound rows, bytes and concurrency, and fail the attempt on a
reader error instead of inferring from partial input.

## Persist writes (planned)

Follow the extension's identity and write protocol exactly:

1. When an attempt ends, write in one synchronous `POST /persist/ingest`: the
   `inference_run` vertex, its configuration and prompt-version edges (and those vertices
   when new), every new `assertion` with its `CREATED` `assertion_produced_by_inference_run`
   edge and its source edges. Reference base vertices (`meeting`, `utterance`) by stored
   Persist id with `vertexRefs`; never re-send or create them. `/persist/ingest-async`
   refuses `vertexRefs`.
2. Derive identifiers as the README says (`h(...)` is lowercase hex SHA-256 of newline-joined
   parts): `run_identifier` from configuration, prompt version, source item and destination
   scope; `assertion_identifier` from run, attempt and ordinal.
3. Set `system` from the destination item; set `destination_kind` and
   `destination_identifier` (`asana:S:task/{gid}`) as properties, since no destination edge
   exists yet. Serialize type fields into `payload` as JSON text. Require one of
   `before_text`/`after_text`. Never send the derived `status`.
4. A repeat of an open assertion adds a `REPEATED` run edge and new source edges with
   `vertexRefs`, not a second assertion. Read open assertions as
   `not(has('status', within('APPLIED','REJECTED')))`.
5. A failed attempt is a `FAILED` run vertex with `error`; the retry is `attempt + 1`.
6. An outcome is a new `assertion_outcome` with its `decides` edge (and `decided_by`
   account edge when a human decided, carrying the account's `system`). Never edit an
   assertion.

## Run ledger (planned)

`POST /inference/runs` accepts one source item or a time window and answers `202` with a
run id; `GET /inference/runs/{run_id}` and `GET /inference/runs` report status, items read,
assertions produced, tokens and cost. Keep run records in the table for the API and the
`inference_run` vertices in Persist as the durable record. Skip a source item that already
has a `SUCCEEDED` run with the same configuration, prompt version and destination scope.
Choose bounded execution (for example a Step Functions Map per source item with limited
concurrency) so one window cannot exceed Lambda limits or Bedrock quotas.

## Build each feature piece

1. Select and order the capability map's pieces; scope a fix to the pieces it touches.
2. Implement only that piece, test first. Run `npm run check` (format, lint, types,
   Vitest) and `npm run test:integration` against DynamoDB Local. Mock Bedrock, Persist and
   Connect in unit tests with recorded response shapes, including thinking blocks and cache
   usage fields.
3. Regenerate `requirements/swagger.yml` (`npx tsx scripts/api-spec.ts`) when routes change
   and synthesize with `npx cdk synth --quiet --strict` (cdk-nag clean).
4. Install through Marketplace and Deploy into the user's test account. Give one API
   invocation, the expected result and at most three AWS inspection steps from the
   capability map; wait for the user's redacted run id and observation.
5. Open the PR and work it until checks and reviews are clean; the user merges.

Return changes, API examples, automated results, deployed evidence, AWS observations,
cleanup and remaining gaps. Keep local tests, runs over test data and runs over live
meetings and backlogs distinct.

## Configuration bundles

Read [the shared configuration-bundle contract](../build-product-deployer/reference/configuration-bundles.md).
Bundles carry product `inference`, kind `configuration`. Deploy's adapter installs each
configuration with `GET`, `PUT /inference/configurations/{name}`, `GET` and compares the
read-back name, version and canonical document; keep the save semantics above. Route Build
check gaps to `tinkaton` and adapter gaps to `corviknight`.

## Shared API domain

For API infrastructure, packaging, review or installation, read and apply
[the shared API domain contract](../guide-product-work/reference/shared-api-domain.md).
Inference maps `inference` with `SharedApiMapping`, attaches its stage to the shared usage
plan and declares no public routes in `marketplace.shared-api.json`.
