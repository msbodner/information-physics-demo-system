-- 007_drop_csv_partial_index.sql
-- Drop the uq_io_source_csv partial unique index created by migration 004.
-- That index blocked re-uploading a CSV file with the same name, and blocked
-- saving CSV records after the first upload of a given filename.
-- Idempotent -- safe to run on databases where the index never existed.

DROP INDEX IF EXISTS uq_io_source_csv;
