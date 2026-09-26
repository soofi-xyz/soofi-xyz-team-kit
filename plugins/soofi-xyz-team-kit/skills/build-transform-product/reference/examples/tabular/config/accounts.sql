SELECT
  customer_code AS account_id,
  display_name AS account_name,
  CAST(balance AS DECIMAL(18, 2)) AS balance,
  active,
  created_on
FROM source_customers
