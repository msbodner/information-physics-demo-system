-- AI Field Maps: fuzzy key groupings for semantically similar field names
CREATE TABLE IF NOT EXISTS field_map_keys (
  key_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fuzzy_key   text NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS field_map_members (
  member_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key_id      uuid NOT NULL REFERENCES field_map_keys(key_id) ON DELETE CASCADE,
  field_name  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(key_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_fmm_key   ON field_map_members(key_id);
CREATE INDEX IF NOT EXISTS idx_fmm_field ON field_map_members(field_name);
