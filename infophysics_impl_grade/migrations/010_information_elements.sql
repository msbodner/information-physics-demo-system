-- Information Elements table: unique element field names with AIO occurrence counts
CREATE TABLE IF NOT EXISTS information_elements (
  element_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name text NOT NULL UNIQUE,
  aio_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_information_elements_field_name ON information_elements (field_name);
