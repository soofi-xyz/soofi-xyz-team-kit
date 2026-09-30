# Connect implementation scope

Use Lapras for the Connect engine and Wingull for partner configuration. Discover
the current repository/revision; the 2026-09-30 comparison reports the following
Prism behavior and identifies differences from the historical Staircase service.
Verify those differences in the target code before claiming deployed support.

## Current boundary

Connect communicates with external partners. It returns job status, signed
callbacks/task-token replies and checksummed pointers to landed files. Parsing,
classification, graph writes and internal business orchestration belong to consumers.

- Use the current `/connect/partners/{partner}/flows/{flow}/jobs` family and the
  flow, partner-configuration and activation surfaces. Verify complete routes in
  the target repository. The service uses IAM SigV4, not the old vendor API-key surface.
- Keep secrets in tagged Secrets Manager references on connections. Do not restore
  the old Connect credential vault, token APIs or vendor CRUD.
- Compile flow definitions in the API runtime into Step Functions execution.
  Keep workflow control in Step Functions; compilation itself is not a separate
  Step Functions compiler workflow in the reported implementation.
- Use the implemented worker families and imported AWS Transfer Family connectors.
  Static-IP egress, native HTTP tasks, Fargate Runner and connector provisioning
  are not established as shipped by the supplied comparison.
- Use landing-bucket job prefixes, SSE-KMS, webhook/drop-zone SQS queues and DLQs.
  Validate the target's Draft 2020-12 JSON Schema using its existing Ajv setup;
  do not replace it merely because the historical PRD mandated Zod.
- Preserve full-jitter retry behavior, per-item failures, `PARTIAL` results and
  failure-only child replay for supported batch jobs. Verify the reported 207 behavior.
- Use HMAC-signed callbacks or task-token replies, inbound HMAC/header authentication,
  early webhook buffering and pinned activation flow versions.

## Reconcile proposals with implementation

The [block contracts](../../build-connect-product/reference/flow-spec.md) describe
configurable behavior, including some unimplemented options. Inspect current
schemas and conformance tests before exposing an option to Wingull. Mark proposed,
implemented and live-verified capabilities separately. Preserve circuit-breaker
limits, upload checksums and observability when verified in the target service.

Test worker/compiler behavior, auth failures, callback signatures, duplicate and
early webhooks, retries, partial jobs and local partner fakes. Follow the product's
existing dev acceptance suite and shared interactive workflow.

[Historical requirements](legacy/PRD.md) are migration context only. Do not rebuild
the `/connector-jobs/vendors` routes, credential vault, health-posting service or
API-key callback model by default.
