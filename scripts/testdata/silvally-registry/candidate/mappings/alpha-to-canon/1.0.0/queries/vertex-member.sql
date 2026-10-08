SELECT concat('member-', member_id) AS `~id`, 'member' AS `~label`, display_name AS `display_name:String`,
  CASE WHEN tier IN ('gold', 'silver') THEN tier END AS `tier:String`
FROM source_members WHERE member_id IS NOT NULL
