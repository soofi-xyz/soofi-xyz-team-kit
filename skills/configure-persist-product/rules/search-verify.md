---
title: Verify search results and recall
impact: HIGH
tags: vector-search, graphql, sigv4, awscurl, recall, verification
---

## Verify search results and recall

`search` is a nullable root field on the existing IAM-authorized
`POST /persist/graphql`. There is no REST search route, and Gremlin
`Neptune#fts` is unrelated to it.

### Sign the request

The API requires SigV4. awscurl's bundled botocore cannot refresh an SSO
session, so export short-lived credentials first and keep `AWS_PROFILE` out of
awscurl's environment:

```bash
export AWS_PROFILE=<selected-profile> AWS_REGION=us-east-2
API=$(aws ssm get-parameter --name persist-api-url --query Parameter.Value --output text)
eval "$(aws configure export-credentials --profile "$AWS_PROFILE" --format env)"

# The schema must list search; vertex owners appear in union SearchEntity.
env -u AWS_PROFILE awscurl --service execute-api --region "$AWS_REGION" "$API/persist/graphql/schema" \
  | jq -r .sdl | grep -E 'search\(|union SearchEntity'
```

Re-run the `export-credentials` line when the credentials expire.

### Query

Keep the request in a local file that is not committed:

```json
{
  "query": "query($input: SearchInput!) { search(input: $input) { hits { rank score unitId entityKind entityId ownerLabel entity { __typename ... on Note { id } } evidence { property embeddingName chunkOrdinal startOffset endOffset snippet lexicalRank vectorRank } } pageInfo { hasNextPage endCursor } retrieval { mode generation indexName profileId profileVersion model fusion lastCommitAt caughtUpAt } } }",
  "variables": {
    "input": { "query": "customer disputes the balance", "mode": "HYBRID", "first": 5, "ownerLabels": ["note"], "embeddingNames": ["note_text_embedding"] }
  }
}
```

```bash
env -u AWS_PROFILE awscurl --service execute-api --region "$AWS_REGION" -X POST \
  -H 'content-type: application/json' -d @search.json "$API/persist/graphql" \
  | jq '.data.search | {retrieval, hits: [.hits[] | {rank, unitId, ownerLabel, embeddings: [.evidence[].embeddingName], lexicalRank: .evidence[0].lexicalRank, vectorRank: .evidence[0].vectorRank}]}'
```

The `jq` projection drops snippets so result text does not land in the
terminal log or chat. Look at snippets only when the user asks, locally.

| Input | Values |
| --- | --- |
| `query` | Non-blank, at most 1,000 characters |
| `mode` | `HYBRID` (default: BM25 and vector, fused with RRF k=60), `KEYWORD` (BM25 only, no Bedrock call), `SEMANTIC` (vector only) |
| `first` / `after` | 1–50 (default 10); `after` is `pageInfo.endCursor`, bound to the same query, mode, filters and generation |
| `ownerLabels` | Labels that declare embeddings (for an `out_vertex` embedding, the edge label) |
| `embeddingNames` | Lexicon embedding names |
| `entityIds` | At most 100 element ids (or owner vertex ids for `out_vertex`) |

An unknown label or embedding name is a `VectorSearchInputError` before any
network call. Exercise all three modes.

### Read the hits

- `retrieval.generation` must be the generation you activated; it is how a swap
  or rollback is observed. `lastCommitAt` / `caughtUpAt` show freshness.
- `unitId` is `<entityKind>:<entityId>`, or `vertex:<owner vertex id>` for an
  `out_vertex` embedding. One element appears once even when several chunks
  match.
- `entity` is the hit as its generated Lexicon type (vertex hits and `out_vertex`
  hits). It is `null` for an edge hit, or for an element deleted after indexing
  until the stream removes its chunks; read an edge by `entityId` instead.
- `score` is the RRF score; compare ranks, not scores across queries.
- `evidence` has one entry per retrieval arm: `lexicalRank`/`vectorRank` show
  which arm found it (`null` for the other). A lexical snippet is the highlight
  (`<em>…</em>`, up to 200 characters of context); a vector-only snippet is the
  chunk text cut to 240 characters.
- `startOffset`/`endOffset` are the chunk's span in UTF-16 code units, end
  exclusive, in the source text: the graph property for `text`, the extracted
  object text for `blob_text`.

| `extensions.code` | Meaning |
| --- | --- |
| `VectorSearchInputError` | Bad input, unknown filter value, foreign cursor |
| `VectorSearchUnavailableError` | No ACTIVE generation, profile not loaded, or search not configured |
| `VectorSearchBackendError` | OpenSearch rejected the request (retriable on 429/5xx) |
| `VectorSearchTimeoutError` | 5-second field budget exceeded (retriable) |
| `Embedding*Error` | Bedrock failure or throttle on the query embedding |

### Quick recall check

1. Ask the user for 5–10 known element ids of the new field and, for each, a
   short paraphrase of what it is about written without copying its words.
   Keep that list in a local, uncommitted file; never paste the source text.
2. Run each paraphrase in `SEMANTIC` and `HYBRID` with `first: 5` and the
   field's `embeddingNames`.
3. Recall@5 = queries whose expected id appears in the top 5 ÷ number of queries.
   Report the number and which ids were missed, nothing else.
4. Search serves only the ACTIVE generation, so measure a candidate by
   activating it and rolling back if it is worse, or pass an offline result to
   `activate` as `evaluation: { "setId": "<name>", "recallAt5": <value> }`;
   below 0.85 blocks activation.

Logs in the `persist-graphql` log group (`GraphQL search completed`) and the
`persist`/`service=persist-graphql-search` metrics (`SearchRequests`,
`SearchFailures`, `SearchLatencyMilliseconds`) carry counts and timings only.
