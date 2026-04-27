-- 026_chat_stats_mode_index.sql
-- Adds a composite index supporting the per-mode filter pills, summary cards,
-- and time-ordered table on the Search Statistics Analytics screen. Without
-- this index, the analytics queries scan the full chat_search_stats table per
-- mode pill click; with it, the planner can do a small index range read.
--
-- Idempotent. Safe to run on an empty or warm table.

CREATE INDEX IF NOT EXISTS idx_chat_search_stats_mode
    ON chat_search_stats (tenant_id, search_mode, created_at DESC);
