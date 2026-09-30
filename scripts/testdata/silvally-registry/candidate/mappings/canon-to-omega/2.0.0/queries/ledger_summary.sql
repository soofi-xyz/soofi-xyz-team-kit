SELECT regexp_replace(m.`~id`, '^member-', '') AS member_id, count(l.`~id`) AS ledger_count,
  coalesce(sum(l.`units:Long`), CAST(0 AS BIGINT)) AS total_units
FROM source_vertex_member m
LEFT JOIN source_edge_member_has_ledger e ON e.`~from` = m.`~id`
LEFT JOIN source_vertex_ledger l ON l.`~id` = e.`~to`
GROUP BY m.`~id` ORDER BY member_id
