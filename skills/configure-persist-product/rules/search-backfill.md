---
title: Build a vector generation with the backfill workflow
impact: HIGH
tags: vector-search, backfill, step-functions, bedrock, generation
---

## Build a generation

`PersistVectorBackfillWorkflow` builds one new index `persist_vector_chunks_g<N>`
from current graph state, using every embedding the Lexicon declares, and leaves
it `READY`. It never activates it, and never touches the ACTIVE generation or
the Gremlin full-text index. Ask before starting a run.

### Input

| Field | Where | Use |
| --- | --- | --- |
| `executionId` | all stages | Always pass it, equal to the execution name; it names the artifact prefix and lets a failed run resume. |
| `maxConcurrency` | all stages | Concurrency of both distributed maps (default 4, maximum 16). Use `2`. |
| `resumeExecutionId` | all stages | Rerun a failed execution with its original manifest, generation, W0 and profile; finished plans, slabs and shards are skipped. |
| `entityIds` | DEV only | 1–500 exact element ids to embed (exclusive with `maxSourceElements`). For a first trial of a new field. |
| `maxSourceElements` | DEV only | Cap per embedding target, e.g. `500`. |
| `embeddingNames` | DEV only | Build only these embeddings. The generation then contains only them. |
| `generationNumber`, `profileId`/`profileVersion`, `shardSize` | all stages | Leave unset: the next number and the default profile are correct for a field change. A new profile is Conkeldurr work. |

`entityIds`, `maxSourceElements` and `embeddingNames` are refused outside DEV,
because a partial generation would pass every activation gate. A PROD build
therefore always embeds every declared embedding over the full population.

Bedrock throttling: a shard retries up to 5 times (20 s, doubling, jittered) on
provider errors, timeouts and throttling. The map tolerates no failed shard, so
a shard that stays throttled fails the whole execution. Keep `maxConcurrency`
at 2 and resume a failed run instead of raising concurrency.

### Size the run first

Count eligible elements with a read-only Gremlin query through
`POST /persist/gremlin`, for example
`g.V().hasLabel('note').has('text').count()` or
`g.E().hasLabel('document_has_file').has('uri').count()`. A count that times out
means the population is large: tell the user the build will take hours and cost
proportionally (Cohere Embed v4 on Bedrock, about $0.12 per million tokens),
and get approval. Every additional generation also costs stream embeddings
while it is not retired.

### Start and watch (DEV)

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=us-east-2
SM=$(aws ssm get-parameter --name /persist/opensearch/vector-backfill-workflow-arn --query Parameter.Value --output text)

# 1. Scoped trial of the new field on known elements.
RUN="vector-note-trial-$(date +%Y%m%dT%H%M%S)"
EXEC=$(aws stepfunctions start-execution --state-machine-arn "$SM" --name "$RUN" --query executionArn --output text \
  --input "{\"executionId\":\"$RUN\",\"maxConcurrency\":2,\"embeddingNames\":[\"note_text_embedding\"],\"entityIds\":[\"<id-1>\",\"<id-2>\"]}")

# 2. Full DEV generation with every declared embedding.
RUN="vector-full-$(date +%Y%m%dT%H%M%S)"
EXEC=$(aws stepfunctions start-execution --state-machine-arn "$SM" --name "$RUN" --query executionArn --output text \
  --input "{\"executionId\":\"$RUN\",\"maxConcurrency\":2}")

aws stepfunctions describe-execution --execution-arn "$EXEC" --query '{status:status,error:error,cause:cause}'
aws stepfunctions list-map-runs --execution-arn "$EXEC" --query 'mapRuns[].mapRunArn' --output text \
  | xargs -n1 -I{} aws stepfunctions describe-map-run --map-run-arn {} --query '{status:status,items:itemCounts}'

# Resume a failed run.
aws stepfunctions start-execution --state-machine-arn "$SM" --name "$RUN-resume1" \
  --input "{\"resumeExecutionId\":\"$RUN\",\"maxConcurrency\":2}"
```

States in order: `PrepareVectorBackfill` (captures the stream position W0,
registers the generation as `BUILDING`, creates the index), `PlanVectorTargets`,
`ExtractVectorSlabs`, `EmbedVectorShards` (reads, chunks, embeds, writes),
`FinalizeVectorBackfill` (sums counters, marks `READY`). The workflow times out
after 12 hours. Artifacts live under
`s3://<maintenance-bucket>/vector-backfill/<executionId>/` for 14 days; resume
within that window or start over.

A first trial on an `embeddingNames` scope is for inspection. Activating it in
DEV would remove every other embedding from DEV search, because search serves
one generation.

### Read the result

When the execution is `SUCCEEDED`, its output carries `generation`,
`indexName`, `bucket`, `prefix` and `finalizeCounters`:

```bash
aws stepfunctions describe-execution --execution-arn "$EXEC" --query output --output text \
  | jq '{generation, indexName, finalizeCounters}'
```

| Counter | Meaning | Expect |
| --- | --- | --- |
| `sourceElements` | Elements read for the targets | Close to your count query |
| `emptySources` | Blank or whitespace-only values; no chunks | Small |
| `chunksWritten` | Chunk documents written to the index | ≥ non-empty elements |
| `embeddingInputs` / `embeddingCacheHits` | Texts sent to Bedrock / identical texts reused within a shard | — |
| `unreadableSources` | `blob_text` objects skipped; split by reason in the `VectorBlobSourceUnreadable` metric | 0, or explained |
| `extractionFailures` | Graph rows that could not be decoded | Must be 0, or activation is blocked |

`summary.json` under the prefix also records `indexDocumentCount`. Logs never
contain source text; report only these numbers.
