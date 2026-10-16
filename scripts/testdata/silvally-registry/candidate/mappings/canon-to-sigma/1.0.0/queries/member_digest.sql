SELECT regexp_replace(`~id`, '^member-', '') AS member_id, `display_name:String` AS display_name FROM source_vertex_member
