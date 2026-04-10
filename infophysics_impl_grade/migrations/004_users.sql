-- 004_users.sql
-- System users and settings tables (no RLS -- system-wide)
-- Also fixes the AIO deduplication constraint to allow multiple AIOs per CSV file

-- ── Fix AIO over-deduplication ───────────────────────────────────────────────
-- The old uq_io_source constraint blocked saving more than one AIO per source
-- file (all rows from the same CSV share source_object_id). Replace with a
-- partial index that only deduplicates CSV records.
-- Drop the old broad unique constraint (blocks multiple AIOs per file)
ALTER TABLE information_objects DROP CONSTRAINT IF EXISTS uq_io_source;

-- NOTE: no replacement partial index for CSV -- allow re-uploading the same
-- CSV file without a duplicate-key error.  De-duplication is handled in
-- application logic when needed.

-- ── Users table ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  user_id       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text        NOT NULL,
  email         text        UNIQUE NOT NULL,
  password_hash text        NOT NULL,
  role          text        NOT NULL CHECK (role IN ('System Admin', 'General User')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  is_active     boolean     NOT NULL DEFAULT true
);

-- ── System settings table ────────────────────────────────────────────────────
-- Global key-value store (e.g. anthropic_api_key)
CREATE TABLE IF NOT EXISTS system_settings (
  key        text        PRIMARY KEY,
  value      text        NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
