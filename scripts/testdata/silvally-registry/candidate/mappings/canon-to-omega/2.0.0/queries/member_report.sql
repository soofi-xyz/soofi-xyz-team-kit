SELECT regexp_replace(`~id`, '^member-', '') AS member_id, `display_name:String` AS display_name, `tier:String` AS tier
FROM source_vertex_member ORDER BY member_id
