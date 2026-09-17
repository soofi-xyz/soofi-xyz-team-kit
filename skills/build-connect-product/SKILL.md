---
name: build-connect-product
description: "Build the Connect ingestion product from Stage-derived behavior: JDBC/PySpark extraction, registered source contracts, entity delta bundles, dependency hydration, downstream-gated checkpoints, sampling and Iceberg snapshots. Use for source-to-Transform delivery, not the separate partner API/webhook flow compiler."
---

# Build Connect Product

Use `lapras` for Connect ingestion. Make the database extraction/delta workflow
its primary, fully specified use case. Generalize source tables, entity links,
projections and policies through registration; do not hardcode a source system
or business domain. Implement product code in the user's target repository.
This skill contains instructions, contracts and examples only.

## Read by task

1. Read [the product contract](reference/PRD.md) for ownership and required behavior.
2. For a new implementation, follow [the build sequence](reference/from-scratch.md)
   and [machine contracts](reference/contracts.md). Use the defaults instead of
   asking the user to choose routine libraries or module layouts.
3. For source reads, deltas or missing related records, read
   [extraction and hydration](reference/extraction-and-hydration.md).
4. For replay, lost updates, observed changes or downstream delivery, read
   [checkpoints and observations](reference/checkpoints-and-observations.md).
5. For current-state copies, historical context or bounded trials, read
   [snapshots and samples](reference/snapshots-and-samples.md).
6. Implement [the worked example and acceptance cases](reference/verification.md)
   and [AWS workflow](reference/aws-workflow.md) in the target repository.
7. When adapting Stage, use [implementation evidence](reference/implementation-evidence.md)
   to preserve its actual contracts and distinguish generalization work from
   shipped functionality. A source checkout is not required to follow this guide.

## Keep shared skills

- Apply [engineering guidelines](../apply-engineering-guidelines/SKILL.md):
  TypeScript control plane/CDK, Python PySpark jobs, quality checks, telemetry and alerts.
- Use [Lexicon](../build-lexicon-product/SKILL.md) for governed source schemas,
  projections, mapping dependencies and configuration publication.
- Use [batch workflows](../build-batch-workflows/SKILL.md) for capacity, admission,
  bounded concurrency and retry orchestration when building the workflows.
- Use [Transform](../build-transform-product/SKILL.md) for language conversion
  and [Persist](../build-persist-service/SKILL.md) for requested graph delivery.
  Keep ingestion results and each consumer's success independently verifiable.
- Preserve the separate [Connect service](../build-connect-service/SKILL.md)
  and [inbound SFTP](../build-inbound-sftp-workflows/SKILL.md) contracts when those
  transport surfaces are requested. Do not silently combine their APIs with the
  Stage-derived ingestion workflow.

## Invariants

Require explicit source/version and entity scope. Pin configuration, source-read
semantics and the exact committed checkpoint before Spark starts. Fail unknown
or incompatible registrations; never turn a checkpoint read error into an
unplanned full scan. Keep extraction, changed records, affected entities,
hydrated context and delivered outputs distinct.

Publish typed dataset manifests and pending checkpoint artifacts only after
validation. Advance a production generation only at its configured delivery
boundary. Keep samples/backfills isolated, workflow switches operable through
runtime configuration, and snapshot refresh outside the extraction critical path.

Return implemented changes and evidence for local execution, synthesized
infrastructure and any actual deployment separately. Do not claim generic
connectors, deletion propagation or transactional source snapshots exist without
implementing and verifying their explicit contracts.
