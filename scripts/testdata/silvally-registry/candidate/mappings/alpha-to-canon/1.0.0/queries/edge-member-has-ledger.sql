SELECT concat('mhl-', l.ledger_id) AS `~id`, 'member_has_ledger' AS `~label`,
  concat('member-', l.member_id) AS `~from`, concat('ledger-', l.ledger_id) AS `~to`
FROM source_ledgers l JOIN source_members m ON l.member_id = m.member_id
