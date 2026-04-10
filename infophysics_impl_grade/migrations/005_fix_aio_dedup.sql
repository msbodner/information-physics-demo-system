-- 005_fix_aio_dedup.sql
-- Drop the over-broad source dedup constraint that prevented saving more than
-- one AIO row per CSV file (all rows share the same source_object_id = filename).
-- The hash-level constraint (uq_io_dedupe_hash) is also dropped because raw_hash
-- is not populated by the current ingest path, making it safe to remove.
-- Both drops are idempotent.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_io_source'
  ) THEN
    ALTER TABLE information_objects DROP CONSTRAINT uq_io_source;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_io_dedupe_hash'
  ) THEN
    ALTER TABLE information_objects DROP CONSTRAINT uq_io_dedupe_hash;
  END IF;
END $$;
