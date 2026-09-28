# Reference implementation evidence and migration boundaries

Ground this guide in the inspected `stage` repository at revision
`86d4ecca9c495fb74243b812c2b1212114aad9cd`. Its checkout was read only while writing
this specification. Source and test inspection establish the behaviors below;
no live AWS run or source database query was performed. The guide is complete
without cloning that repository or knowing its deployment identities.

## Preserve the useful behavior

| Evidence in that revision | Behavior to preserve generically |
| --- | --- |
| `glue_scripts/account_aggregator.py`: `TableSpec`, `required_select_columns`, `resolve_jdbc_table_names` | Table-owned keys/links/cursors/filter columns supplement a SQL-derived business projection; runtime manifest activation for additional tables |
| Same module: `compute_row_hash`, `compute_changed_records`, `merge_partial_record_indexes` | Per-record new/modified detection; cumulative indexes retain unseen historical identities across partial and zero-row windows |
| Same module: `build_table_record_index`, `expand_impacted_debts_with_primary` | Direct and bridge links; current in-scope entity fan-out; one-way, one-hop related-ID expansion |
| Same module: `resolve_hydration_targets`, `hydrate_dependency_context` | SQL-derived companion dependencies; hydrate incrementally read companions, exclude deliberately partial-history targets |
| Same module: `build_hydration_key_in_list_clause`, `resolve_debt_note_hydration_source` | Indexable bounded source reads; exact complete snapshot provenance before using historical context; safe JDBC fallback when compatible snapshot is absent |
| Same module: `build_account_status_observations`, `verify_account_status_observations_published` | Independent nullable transition signal; fan-out presence does not create an event; never checkpoint an observation that was not published |
| `glue_scripts/retained_change_state.py` and `phone_status_state.py` | Reusable retained canonical-value hashes/timestamps plus a source-specific policy; preserve source-time validation and output-only annotations |
| `lambda_functions/snapshot_collector.py`, `aggregate_costs.py` | Bootstrap pins previous record-index identity and lower bound; report output locations and deferred checkpoint artifacts for the parent orchestrator |
| `glue_scripts/single_snapshot_processor.py`, `generate_sample_workflow.py` | Selected-table reads, bounded live samples, materialized samples and authoritative manifest-override provenance |
| `lambda_functions/snapshot_refresh_planner.py`, `snapshot_refresh_result.py`; snapshot merger and CDK construct | Separate ordered snapshot refresh, full baseline requirement, replay ledger, guarded Iceberg updates and drift reporting |
| `tests/test_glue_script.py`, `test_account_status_observations.py`, `test_retained_change_state.py`, `test_phone_status_state.py`, `test_snapshot_refresh_planner.py` | Characterization cases for hydration, observations, retained state, empty windows and refresh eligibility |

Use the symbols as traceability anchors, not as names to hardcode into the new
product. Preserve domain policies in a registered adapter/configuration release.
Do not copy customer tables, status vocabularies, credential locations, AWS
profiles, metrics namespaces or source-specific SQL into the general engine.

## Distinguish current implementation from target contracts

| Inspected implementation | New Connect requirement / migration work |
| --- | --- |
| Fixed PostgreSQL table registry and business entity identity | Versioned source/table/entity registration; generalized direct/bridge links. Generic registration is a build requirement, not observed shipped support. |
| Python CDK/Lambdas and mixed Glue versions; main aggregation and snapshot merge explicitly use Glue 5.0 | For a new build follow shared TypeScript control-plane/CDK rules and Python Spark jobs. Preserve existing entry points/contracts during an explicit migration. |
| Sorted Spark JSON row hash, record index version 2 | Pin hash, Spark serialization, schema/projection and tracked-policy versions. Do not reuse a checkpoint across incompatible hashing changes without a characterized migration. A migration plan file is not proof the migration shipped. |
| Some missing projection entries warn and use `SELECT *` | New registrations require explicit projections. Preserve a legacy fallback only behind a documented migration adapter; never make silent widening the new default. |
| Bootstrap can swallow checkpoint-listing errors and fall back to a full read | New resolver distinguishes verified first use from access/service/corruption errors and fails the latter before an unplanned full scan. |
| Separate status readers have different fallback/completeness behavior | New reader resolves one complete committed generation for all indexes and sidecars, with per-table empty-baseline coverage. Do not combine independently selected generations. |
| `defer_checkpoint_promotion` defaults false for compatibility; parent promotes staged datasets after downstream success | New production registration defaults to consumer-gated promotion. Atomic generation pointer/lease is a required improvement; multi-prefix copies in a parent are not an atomic transaction. |
| Some activation/publication switches are CDK context options | Provision needed infrastructure inactive, then activate through runtime configuration. Do not require another deploy to enable a supported feature. |
| Fixed cost assumptions, broad S3 grants and implementation-specific log/metric behavior | Use verified environment pricing, scoped IAM and shared observability/alert integrations. Cost models remain estimates, not invoiced actual spend. |
| Snapshot refresh starts independently on extraction success | Preserve separate source-snapshot progress; it does not establish downstream delivery or authorize ingestion checkpoint advancement. |

Do not rewrite the existing service merely to match new file names. Inventory
callers, map legacy input/output fields to the versioned generic request/result,
and keep supported behavior until an explicit cutover. In particular, preserve
the original meaning of full versus selected-table runs, debug limits, date
windows, manifest overrides, deferred checkpoint artifacts and status annotations.
Do not claim the old deployment accepts the new JSON schemas.
