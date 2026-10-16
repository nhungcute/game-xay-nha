-- Third map kind "town" (Thị trấn): city + countryside mixed. Always a random map (rows in world_templates).
-- 0001 declared the CHECK inline, so Postgres auto-named it worlds_map_kind_check.
ALTER TABLE worlds DROP CONSTRAINT IF EXISTS worlds_map_kind_check;
ALTER TABLE worlds ADD CONSTRAINT worlds_map_kind_check CHECK (map_kind IN ('city', 'farm', 'town'));
