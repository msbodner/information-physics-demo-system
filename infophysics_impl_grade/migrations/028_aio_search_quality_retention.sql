-- 028_aio_search_quality_retention.sql
-- Retention support for the aio_search_quality telemetry table (migration 024).
--
-- This migration does NOT delete rows. Instead it:
--   (1) Documents the retention policy in a table comment so ops have a
--       single source of truth.
--   (2) Adds a btree index on created_at so a periodic cleanup job
--       (e.g. ``DELETE FROM aio_search_quality WHERE created_at < now() - interval '30 days'``)
--       can use a range scan instead of a full table scan.
--
-- Recommended cleanup cadence: run nightly via cron / pg_cron. Rows are
-- write-mostly telemetry; aggregate views (``aio_search_quality_stats``)
-- are computed by the backend on read and do not rely on history beyond
-- the configured window.

COMMENT ON TABLE aio_search_quality IS
  'Per-search quality telemetry (Phase 2 retrieval). RETENTION: ops should '
  'periodically delete rows older than the configured window (default 30 '
  'days) — see migration 028. Aggregate stats are computed on read; no '
  'historical rollups depend on this table.';

CREATE INDEX IF NOT EXISTS idx_aio_search_quality_created
  ON aio_search_quality (created_at);
