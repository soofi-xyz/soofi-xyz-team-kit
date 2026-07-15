---
name: access-orchestrate-call-outputs
description: Query approved production Athena communication and calling datasets for counts and date filtering while preserving workflow lineage. Use for orchestrated call eligibility/schedules and for discoverable phone-call, email-message, or SMS-message entities; inspect live Glue metadata and partitions before claiming availability.
---

# Access Orchestrate Call Outputs

Use this skill as the canonical Athena access contract for Hoothoot. Keep the agent prompt concise and defer Athena discovery, safety, lineage, and query examples here.

## Route and boundaries

- Prefer Athena for counts and easy date filtering when the requested entity is one of:
  - orchestrated call eligibility or scheduled-call output;
  - a live, discoverable `phone_call` entity;
  - live, discoverable email-message or SMS-message entities.
- Use production only. Reuse the AWS profile selected through Hoothoot's normal access flow, set it explicitly on every command, use region `us-east-2`, and require account `014948052063`. Do not require a separate Athena-specific profile name.
- Use `AwsDataCatalog` and names discovered from Athena/Glue. Never guess a workgroup, result location, database, table, identifier, timestamp, or partition column.
- Keep Athena read-only. Run only metadata calls and `SELECT`/`WITH` queries. Do not run DDL, CTAS, `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `UNLOAD`, repairs, crawlers, or source-data mutation.
- Do not expand this approval to unrelated Athena datasets. Use Hoothoot's normal Lexicon/Rules/Persist path outside these communication/call entities.
- Do not substitute an easy Athena count for a business-defined population. Confirm that the discovered table semantics match the user's wording.
- Add `LIMIT` to row samples, project only necessary non-sensitive columns, and do not expose phone numbers, email addresses, message bodies, names, addresses, SSNs, or other PII in chat, logs, screenshots, or report provenance.
- For debt-backed counts, retain Hoothoot's default exclusion of identifiers matching the `UNMATCHED_SSN` placeholder pattern unless the user explicitly asks to analyze them.

## Discover access before querying

Run every AWS command with the profile and region explicit. In the examples below, `SELECTED_AWS_PROFILE` is the profile already selected and verified through Hoothoot's normal AWS access flow.

1. Verify caller identity and stop unless the account is exactly `014948052063`:

```bash
AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws sts get-caller-identity --query '{Account:Account,Arn:Arn}' --output json
```

2. List workgroups, choose an enabled approved workgroup from the returned metadata, and inspect its configuration:

```bash
AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws athena list-work-groups \
  --query 'WorkGroups[].{Name:Name,State:State,Description:Description}' --output table

AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws athena get-work-group --work-group "$WORKGROUP" \
  --query 'WorkGroup.{Name:Name,State:State,Enforce:Configuration.EnforceWorkGroupConfiguration,OutputLocation:Configuration.ResultConfiguration.OutputLocation,ExpectedBucketOwner:Configuration.ResultConfiguration.ExpectedBucketOwner,Encryption:Configuration.ResultConfiguration.EncryptionConfiguration}' \
  --output json
```

3. Verify the selected workgroup's query-result location and encryption. If the workgroup does not enforce an approved output location, obtain and pass an approved `s3://...` result location before starting a query. Do not improvise a bucket.

4. Confirm `AwsDataCatalog`, then discover databases and tables:

```bash
AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws athena list-data-catalogs --work-group "$WORKGROUP" \
  --query 'DataCatalogsSummary[].CatalogName' --output table

AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws glue get-databases --catalog-id 014948052063 \
  --query 'DatabaseList[].Name' --output table

AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws glue get-tables --catalog-id 014948052063 --database-name "$DATABASE" \
  --query 'TableList[].Name' --output table
```

5. Inspect every selected table's columns, partition keys, location, and live partitions:

```bash
AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws glue get-table --catalog-id 014948052063 \
  --database-name "$DATABASE" --name "$TABLE" \
  --query 'Table.{Columns:StorageDescriptor.Columns[].{Name:Name,Type:Type},PartitionKeys:PartitionKeys[].{Name:Name,Type:Type},Location:StorageDescriptor.Location}' \
  --output json

AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws glue get-partitions --catalog-id 014948052063 \
  --database-name "$DATABASE" --table-name "$TABLE" \
  --query 'Partitions[].Values' --output json
```

In the Athena console, use Query editor with the selected workgroup, select `AwsDataCatalog`, choose a database returned by Glue, and verify the query-result setting before running read-only SQL. Use the console only as another view of discovered metadata, not as permission to guess names or mutate data.

## Current orchestrated-call contract

Rediscover this metadata on every run. The currently known production database is `orchestrate_call_outputs` with:

- `workflow_run_catalog`
- `eligible_to_call`
- `scheduled_calls`

All three use partition keys `year INT`, `month INT`, and `date DATE`. Map user wording such as "day" or "daily" to the `date` partition. Never invent or query a `day` column. Include `year`, `month`, and `date` predicates whenever the requested period permits partition pruning.

The current `orchestrate_call_outputs` corrective backfill is static through `2026-07-14` and has no automatic refresh. Scope that warning only to these current run-aware tables; do not imply that all Athena communication data is static.

### Preserve workflow lineage

The same `date` can contain retries, diagnostics, rotation runs, and recoveries. Never silently select a latest, successful, largest, or otherwise "canonical" run.

1. Start with `workflow_run_catalog`.
2. Show the candidate `solver_execution_id`, `filter_source_id`, `classification`, status, and inclusion/exclusion fields for the requested partition.
3. Require an explicit run/filter-source selection or an explicit, user-visible selection policy.
4. Filter `scheduled_calls` by both the selected `solver_execution_id` and `filter_source_id`.
5. Filter `eligible_to_call` by the exact `filter_source_id`.
6. Join eligible and scheduled results through that exact Filter lineage, never by date alone.

Discover the live columns first, then list candidate runs:

```sql
SELECT
  date,
  solver_execution_id,
  filter_source_id,
  classification,
  solver_status,
  include_in_scheduled_dataset,
  exclusion_reason,
  scheduled_count
FROM "orchestrate_call_outputs"."workflow_run_catalog"
WHERE year = 2026
  AND month = 7
  AND date = DATE '2026-07-14'
ORDER BY solver_start_time, solver_execution_id;
```

## Availability and planned entity families

Athena communication coverage is expanding gradually. Planned entity families are `phone_call`, email messages, and SMS messages, with historical coverage intended from January 2026 onward. Plans are not evidence.

Before every answer:

1. List live Glue databases and tables.
2. Inspect candidate table columns and partition keys.
3. Inspect partitions and report the actual minimum/maximum dates plus missing dates or months.
4. State which requested entity families are present, absent, partial, or stale.
5. Never claim January 2026 coverage, or any planned table, merely because this skill mentions it.

To discover future candidates, inspect all discovered database/table names and then validate each candidate's schema and semantics. A compact CLI search is:

```bash
for database in $(AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws glue get-databases --catalog-id 014948052063 \
  --query 'DatabaseList[].Name' --output text); do
  AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
    aws glue get-tables --catalog-id 014948052063 --database-name "$database" \
    --query "TableList[?contains(Name, 'phone') || contains(Name, 'call') || contains(Name, 'email') || contains(Name, 'sms') || contains(Name, 'message')].Name" \
    --output text
done
```

When a requested entity becomes available, Athena is preferred for its counts and date filters. Discover its real business-ID and timestamp columns. Report `count(*)` as rows and `count(DISTINCT <business_id>)` as distinct business entities when those semantics differ; label both clearly. Do not assume one row equals one call or message.

## Query examples

Use discovered workgroup/database/result settings to execute these read-only queries. If the workgroup does not enforce its result location:

```bash
QUERY_ID=$(AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws athena start-query-execution \
  --work-group "$WORKGROUP" \
  --query-execution-context "Catalog=AwsDataCatalog,Database=$DATABASE" \
  --result-configuration "OutputLocation=$RESULT_OUTPUT" \
  --query-string "$SQL" \
  --query 'QueryExecutionId' --output text)

AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws athena get-query-execution --query-execution-id "$QUERY_ID" \
  --query 'QueryExecution.Status' --output json

AWS_PROFILE="$SELECTED_AWS_PROFILE" AWS_REGION=us-east-2 \
  aws athena get-query-results --query-execution-id "$QUERY_ID" \
  --max-results 100
```

If the workgroup enforces a verified result location, omit the client-side `--result-configuration`. Always inspect final query status and the actual result location before reading results.

### Partition availability for a bounded month

Prefer Glue partition listing for full coverage discovery. This bounded query also shows which dates contain cataloged runs:

```sql
SELECT date, count(*) AS cataloged_runs
FROM "orchestrate_call_outputs"."workflow_run_catalog"
WHERE year = 2026
  AND month = 7
GROUP BY date
ORDER BY date;
```

### Daily counts for an explicitly selected lineage

```sql
SELECT
  count(*) AS scheduled_rows,
  count(DISTINCT debt_id) AS distinct_scheduled_debts
FROM "orchestrate_call_outputs"."scheduled_calls"
WHERE year = 2026
  AND month = 7
  AND date = DATE '2026-07-14'
  AND solver_execution_id = '<selected-solver-execution-id>'
  AND filter_source_id = '<selected-filter-source-id>'
  AND debt_id NOT LIKE 'UNMATCHED_SSN%';
```

```sql
SELECT
  count(*) AS eligible_rows,
  count(DISTINCT debt_id) AS distinct_eligible_debts
FROM "orchestrate_call_outputs"."eligible_to_call"
WHERE year = 2026
  AND month = 7
  AND date = DATE '2026-07-14'
  AND filter_source_id = '<selected-filter-source-id>'
  AND debt_id NOT LIKE 'UNMATCHED_SSN%';
```

### Monthly counts without hiding run variants

Return one row per lineage. Aggregate these rows only after the user explicitly chooses which classifications/runs belong in the monthly total.

```sql
SELECT
  c.date,
  c.solver_execution_id,
  c.filter_source_id,
  c.classification,
  count(s.debt_id) AS scheduled_rows,
  count(DISTINCT s.debt_id) AS distinct_scheduled_debts
FROM "orchestrate_call_outputs"."workflow_run_catalog" AS c
LEFT JOIN "orchestrate_call_outputs"."scheduled_calls" AS s
  ON s.year = 2026
 AND s.month = 7
 AND s.date = c.date
 AND s.solver_execution_id = c.solver_execution_id
 AND s.filter_source_id = c.filter_source_id
 AND s.debt_id NOT LIKE 'UNMATCHED_SSN%'
WHERE c.year = 2026
  AND c.month = 7
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2;
```

### Exact-lineage eligible/scheduled comparison

```sql
WITH selected_run AS (
  SELECT
    year,
    month,
    date,
    solver_execution_id,
    filter_source_id,
    classification
  FROM "orchestrate_call_outputs"."workflow_run_catalog"
  WHERE year = 2026
    AND month = 7
    AND date = DATE '2026-07-14'
    AND solver_execution_id = '<selected-solver-execution-id>'
    AND filter_source_id = '<selected-filter-source-id>'
),
eligible AS (
  SELECT filter_source_id, count(*) AS eligible_rows,
         count(DISTINCT debt_id) AS distinct_eligible_debts
  FROM "orchestrate_call_outputs"."eligible_to_call"
  WHERE year = 2026
    AND month = 7
    AND date = DATE '2026-07-14'
    AND filter_source_id = '<selected-filter-source-id>'
    AND debt_id NOT LIKE 'UNMATCHED_SSN%'
  GROUP BY filter_source_id
),
scheduled AS (
  SELECT solver_execution_id, filter_source_id, count(*) AS scheduled_rows,
         count(DISTINCT debt_id) AS distinct_scheduled_debts
  FROM "orchestrate_call_outputs"."scheduled_calls"
  WHERE year = 2026
    AND month = 7
    AND date = DATE '2026-07-14'
    AND solver_execution_id = '<selected-solver-execution-id>'
    AND filter_source_id = '<selected-filter-source-id>'
    AND debt_id NOT LIKE 'UNMATCHED_SSN%'
  GROUP BY solver_execution_id, filter_source_id
)
SELECT
  r.date,
  r.solver_execution_id,
  r.filter_source_id,
  r.classification,
  e.eligible_rows,
  e.distinct_eligible_debts,
  s.scheduled_rows,
  s.distinct_scheduled_debts
FROM selected_run AS r
LEFT JOIN eligible AS e
  ON e.filter_source_id = r.filter_source_id
LEFT JOIN scheduled AS s
  ON s.solver_execution_id = r.solver_execution_id
 AND s.filter_source_id = r.filter_source_id;
```

### Future phone-call/email/SMS count shape

Replace placeholders only after Glue discovery:

```sql
SELECT
  date,
  count(*) AS row_count,
  count(DISTINCT <discovered_business_id_column>) AS distinct_entities
FROM "<discovered_database>"."<discovered_table>"
WHERE year = 2026
  AND month = 1
  AND date BETWEEN DATE '2026-01-01' AND DATE '2026-01-31'
GROUP BY date
ORDER BY date;
```

If the table uses different partition keys, use those discovered keys instead. Use the discovered timestamp column only for event-time grouping inside already pruned partitions.

## Return provenance

For every answer, state:

- verified account, region, catalog, workgroup, and database;
- selected table(s), partition predicates, and actual available date range/gaps;
- query execution ID and verified result location, without exposing signed URLs;
- row-count versus distinct-business-ID semantics;
- selected `solver_execution_id`, `filter_source_id`, and `classification` for orchestrated-call data;
- the exact-lineage join policy;
- the narrow static-backfill warning when current `orchestrate_call_outputs` tables are used;
- unavailable or planned entity families as unavailable/planned, never as present.
