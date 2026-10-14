SELECT record_id, NULLIF(UPPER(TRIM(status)), '') AS tracked_value
FROM source_records
