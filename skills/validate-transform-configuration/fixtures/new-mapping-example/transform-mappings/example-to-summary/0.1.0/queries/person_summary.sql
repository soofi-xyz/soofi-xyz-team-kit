SELECT
  person_id,
  UPPER(TRIM(family_name)) AS family_name,
  CAST(ROUND(balance * 100) AS BIGINT) AS balance_cents,
  CASE WHEN opted_out IS TRUE THEN 'true' ELSE 'false' END AS opted_out
FROM source_people
WHERE person_id IS NOT NULL
ORDER BY person_id
