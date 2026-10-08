# Make a field searchable (Persist vector search)

Use this runbook when someone asks Uxie to make a vertex or edge property
findable through the GraphQL `search` root field, by meaning (SEMANTIC), by
keyword (KEYWORD) or both (HYBRID). It configures an existing Persist
deployment. It never edits the Persist engine.

## Prerequisite: the capability must be merged and deployed

The capability ships in two pull requests:

- Persist: [Spring-Oaks-Capital-LLC/persist#276](https://github.com/Spring-Oaks-Capital-LLC/persist/pull/276) (`feat/vector-search-capability`)
- Lexicon: [Spring-Oaks-Capital-LLC/lexicon `feat/embeddings-schema`](https://github.com/Spring-Oaks-Capital-LLC/lexicon/pulls?q=head%3Afeat%2Fembeddings-schema)

Do not configure a searchable field in PROD until both are merged and deployed
to production. Before every run, prove that the target account has the
capability instead of assuming it:

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=us-east-2
aws sts get-caller-identity --query Account --output text   # DEV is 951132547414; confirm PROD with the user
aws ssm get-parameter --name /persist/opensearch/vector-backfill-workflow-arn --query Parameter.Value --output text
aws ssm get-parameter --name /persist/opensearch/vector-generation-control-function-name --query Parameter.Value --output text
```

If either parameter is missing, the capability is not deployed there. Stop and
report it; do not work around it.

## How the pieces fit

| Piece | Owner | Artifact | What it decides |
| --- | --- | --- | --- |
| Eligibility | Lexicon (`embeddings` block on the vertex/edge rule) | Lexicon PR | Which property is embedded, how it is read (`text` / `blob_text`), chunking strategy, hit target, version |
| Blob sources | Persist (`VECTOR_BLOB_SOURCES` in `lib/vector-search-stage.ts`) | One-line Persist PR | Which S3 `bucket/prefix/` the vector Lambdas may read for `blob_text` |
| Embedding profile | Persist (`lambda/config/embedding-profiles/`) | Engine change → Conkeldurr | Model (Cohere Embed v4 via `us.cohere.embed-v4:0`), 1024 dims, chunk sizes |
| Generation | Persist runtime (`PersistVectorBackfillWorkflow`) | Step Functions execution | Builds `persist_vector_chunks_g<N>` from current graph state; ends `READY` |
| Promotion | Persist runtime (`VectorGenerationControl` Lambda) | Lambda invocation | Moves the ACTIVE pointer after every gate passes; rollback; retire |
| Maintenance | Persist runtime (`VectorStreamPoller`) | Automatic, every minute | Keeps every non-retired generation current from Neptune Streams |
| Reads | Persist GraphQL (`POST /persist/graphql`, `search`) | Query | Serves only the ACTIVE generation |

An existing generation never picks up a newly declared embedding. Making a new
field searchable therefore always means: declare it, build a new generation
that contains it, and promote that generation.

## Feature pieces and checkpoints

Follow [guide-product-work](../../guide-product-work/SKILL.md). Treat each row
as one piece; the user runs or inspects its result before the next piece starts.

| # | Piece | Rule | User checkpoint |
| --- | --- | --- | --- |
| 1 | Decide the field, content type, chunking, hit target, name; PII decision | [search-field-decision](../rules/search-field-decision.md) | User approves the declaration table and the PII decision |
| 2 | Lexicon PR with the `embeddings` entry | [search-lexicon-declaration](../rules/search-lexicon-declaration.md) | Lexicon tests green; owner review; merged and deployed to DEV |
| 3 | `blob_text` only: Persist allowlist PR and bucket access | [search-blob-allowlist](../rules/search-blob-allowlist.md) | Persist PR deployed to DEV; one known object readable |
| 4 | Build a DEV generation (scoped first, then full) | [search-backfill](../rules/search-backfill.md) | Execution `SUCCEEDED`; counters reviewed |
| 5 | Promote in DEV (dry run, then activate) | [search-generation-control](../rules/search-generation-control.md) | Every gate `passed: true`; `activeAfter` is the new generation |
| 6 | Verify search and recall in DEV | [search-verify](../rules/search-verify.md) | User runs the query; Recall@5 on the known set reported |
| 7 | PROD: same pieces 2–6 after explicit approval | [search-operations](../rules/search-operations.md) | User approves each PROD write; full-population build only |

Read [search-operations](../rules/search-operations.md) before piece 4: shared
DEV, deletion behavior, alarms and data-handling rules apply to every piece.

## What Uxie does automatically vs what it asks

Uxie does without asking (read-only or local):

- Find the Lexicon rule that owns the property, its type, `format` and
  persistence, existing embeddings, derived indexes and property names.
- Propose `content`, `chunking.strategy`, `hit_target`, name and `version`, with
  the reason for each, and check every naming and source rule.
- Check whether the owner is under the GraphQL PII resolution map, and whether an
  edge field may hold personal data.
- Verify the deployment (SSM parameters, account, region), read `status`, and
  count eligible elements with a read-only query to size the build.
- Draft the Lexicon PR and, for `blob_text`, the Persist allowlist PR; run the
  local validation commands.
- Run `activate` with `dryRun: true` and explain every gate.
- Watch executions, read counters, logs and metrics, and report them.

Uxie asks the user before:

- Opening any PR (a Persist or Lexicon PR to `main` deploys to shared DEV).
- Editing an overlay owned by another team (for example the Veritus overlay).
- Starting a backfill, activating, rolling back or retiring a generation.
- Any PROD write, and any change to an existing embedding's `source_property`,
  `content`, `version` or `chunking.strategy` (outside DEV it deletes that
  embedding's chunks from the ACTIVE generation on the next poll).
- Accepting text that may contain personal data into search (PII decision).
- Granting access to a bucket in another account (needs the owner's policy).

## Request template

A new team member can paste this to `/uxie`:

```text
/uxie Make a field searchable in Persist.
- Field: <vertex or edge label>.<property>   (e.g. note.text, document_has_file.uri)
- What people will search for: <one sentence, e.g. "notes that describe a balance dispute">
- Search result should be: <the element itself | the out vertex of a self-edge>
- Content: <inline text | text stored in S3 at s3://<bucket>/<prefix>/>   (Uxie confirms)
- Typical length: <short (< 2,000 chars) | long documents/transcripts>
- Personal data in the text: <none | yes: what kind>   (Uxie asks for a PII decision if yes)
- Environment: DEV first. PROD only after I approve.
- Known examples for a recall check (ids only, no text): <5–10 element ids and what each is about>
```
