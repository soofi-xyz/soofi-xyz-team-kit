SELECT concat('ledger-', l.ledger_id) AS `~id`, 'ledger' AS `~label`,
  CAST(round(l.amount * coalesce(r.factor, 1.0)) AS BIGINT) AS `units:Long`
FROM source_ledgers l JOIN source_members m ON l.member_id = m.member_id LEFT JOIN source_rates r ON r.tier = m.tier
