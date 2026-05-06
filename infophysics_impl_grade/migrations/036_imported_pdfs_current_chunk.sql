-- 036_imported_pdfs_current_chunk.sql
--
-- V5.0.5+ — track the currently-processing chunk index so the
-- polling UI can render a live progress bar without depending on SSE
-- (which has been failing with payload-size buffering issues).
--
-- Existing rows: current_chunk stays NULL (legacy data, no progress).
-- Idempotent.

ALTER TABLE imported_pdfs
  ADD COLUMN IF NOT EXISTS current_chunk INT;
