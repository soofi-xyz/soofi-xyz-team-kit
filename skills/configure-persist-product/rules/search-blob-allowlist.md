---
title: Allowlist the S3 location for blob_text
impact: HIGH
tags: vector-search, blob_text, s3, iam, allowlist, persist
---

## Allowlist the S3 location for `blob_text`

Every stage reads no bucket by default. Until a location is listed, every
`blob_text` value is skipped as `Unreadable(NotAllowed)` and the build writes no
chunks for it. Skip this rule for `content: "text"`.

### The one-line Persist PR

Edit `VECTOR_BLOB_SOURCES` in `lib/vector-search-stage.ts` of
[Spring-Oaks-Capital-LLC/persist](https://github.com/Spring-Oaks-Capital-LLC/persist),
one entry per stage that needs it:

```ts
export const VECTOR_BLOB_SOURCES: Readonly<Record<string, ReadonlyArray<VectorBlobSourceLocation>>> = {
  dev: [{ bucket: "tenant-documents-dev", prefix: "documents/" }],
  prod: []
}
```

- The prefix ends in `/`, so `documents/` does not admit `documents-archive/`.
- The entry grants the vector stream poller and backfill shard worker
  `s3:GetObject` on exactly `arn:aws:s3:::<bucket>/<prefix>*` and nothing else.
- Add the PROD entry only in the PROD rollout, after approval.
- Persist's own `PersistBlobBucket` (where GraphSON `persist:Blob` values land
  under `persist-blobs/`) is not listed either; list it with its pinned
  physical bucket name when those blobs must be searchable.
- The CDK context `vectorBlobSourceAllowlist` (`bucket/prefix,…`) replaces a
  stage's list for one deployment; use it only for a deliberate trial.
- Opening the PR deploys the branch to shared DEV. Ask first.

### Check the bucket is readable by Persist

1. Same account: the PR's grant is enough unless the bucket uses SSE-KMS with a
   customer key. Then also pass `vectorBlobSourceKmsKeyArns=<key-arn>` context
   and make sure the key policy allows those roles.
2. Another account: the bucket owner must grant `s3:GetObject` on the prefix to
   the two Persist roles in their bucket policy (and `kms:Decrypt` in the key
   policy for SSE-KMS). Until then every read is `AccessDenied`, skipped and
   counted. Find the role ARNs:

   ```bash
   aws cloudformation describe-stack-resources --stack-name PersistSearchStack \
     --query "StackResources[?ResourceType=='AWS::IAM::Role' && (starts_with(LogicalResourceId,'VectorStreamPoller') || starts_with(LogicalResourceId,'VectorBackfillShardWorker'))].PhysicalResourceId"
   ```

   These are role names; the ARN is `arn:aws:iam::<persist-account>:role/<name>`.

   Ask the user to request the grant from the bucket owner; do not edit another
   team's bucket policy.
3. Prove it: run a DEV backfill scoped by `entityIds` to one or two elements
   whose URI points at a known object ([search-backfill](search-backfill.md)),
   and require `unreadableSources: 0`. Your own `aws s3api head-object` proves
   the object exists, not that Persist can read it.

### Limits and formats (`blob-text/v1`)

| Case | Outcome |
| --- | --- |
| `text/plain` (any parameters) or a key ending in `.txt`, valid UTF-8 | Embedded as stored (a leading BOM is dropped) |
| AWS Transcribe batch result JSON | Embedded as one `spk_N: text` line per speaker turn, or the plain transcript |
| Any other format, invalid UTF-8 or malformed JSON | `UnsupportedFormat`, skipped and counted |
| Object over 5 MiB | `TooLarge`, skipped and counted |
| Not an allowlisted `s3://bucket/key` (`https://`, empty, free text) | `NotAllowed`, skipped and counted, no S3 call |
| 403 / KMS denied | `AccessDenied`, skipped and counted |
| 404 | `NotFound`: skipped by the backfill; the stream poller deletes that element's chunks |
| Throttling, 5xx, timeout (20 s per object) | Retried; a shard or stream page fails rather than skipping content |

PDF, HTML or DOCX need a new extraction policy: route to `conkeldurr`. Evidence
offsets for `blob_text` hits point into the extracted text, not the URI.

### Watch

Backfill and poller publish `VectorBlobSourceUnreadable` by `reason` (namespace
`persist`, `service=persist-vector-backfill` or `persist-vector-stream`).
`VectorBackfillBlobUnreadableAlarm` and `VectorStreamBlobUnreadableAlarm` fire
after 15 minutes of skips. Errors name the bucket only, never the key or content.
