# Existing Filter implementation — Debt adapter

Use this evidence only when integrating with or changing the existing Filter
service. Debt, phone and email are its implemented domain adapter; they do not
define the generic product. Start with the [generic product contract](../PRD.md)
for product design. These current-behavior sections supersede the older blueprint.
Gallade owns this product.

## Evidence baseline

The current-behavior descriptions were inspected on 2026-09-15 against
`Spring-Oaks-Capital-LLC/filter` commit `451a667` (local checkout named `filter`).
Resolve the actual repository path from the workspace; no developer-specific
absolute path is required. Pin a fresh revision when implementing changes.
Local verification passed `pnpm check` and 374 tests across 33 files. No deployed
AWS configuration, live Lexicon content, or production latency was certified.

## Read by task

| Reference | Contents |
| --- | --- |
| [Product and boundaries](product-and-boundaries.md) | Ownership, current discovery, implemented capabilities, non-goals |
| [Batch contract](batch-contract.md) | Inputs, candidate semantics, examples, output schemas, report statistics |
| [Rules and queries](rules-and-queries.md) | Catalogs, context matching, explicit subsets, compiler and Persist contracts |
| [Single entity](single-entity.md) | Direct invocation, response/rejection shapes, cache, timeouts, open SLO |
| [Architecture](architecture.md) | Infrastructure inventory, runtime configuration, IAM and source map |
| [Capacity operations](capacity-operations.md) | Weighted admission, consumer setup, cleanup, operator controls, redrive |
| [Debt universe](debt-universe.md) | Shared snapshots, Graph Ready, freshness, leases, fallback and flags |
| [Eligibility writeback](eligibility-writeback.md) | Opt-in daily phone graph facts, independent workflow, recovery |
| [Marketplace and migration](marketplace-and-migration.md) | Future tenant-install contract, compatible naming migration, dependencies |
| [Verification](verification.md) | Local checks, scenario coverage, environment smoke, metric evidence |
| [Known gaps](known-gaps.md) | Remaining implementation requirements, priority, ownership and closure evidence |

## Status discipline

Treat **current behavior** as the inspected implementation contract and **target**
as a requirement that remains to be implemented or reconciled. Preserve current
callers while closing gaps. In particular, do not assume canonical batch discovery,
marketplace packaging, Node 24, region portability, or a 300 ms evaluator already
exist. See [known gaps](known-gaps.md) before claiming readiness.
