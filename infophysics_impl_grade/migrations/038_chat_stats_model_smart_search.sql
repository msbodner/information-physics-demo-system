-- 038_chat_stats_model_smart_search.sql
-- Surface in Search Statistics: which LLM model handled each ChatAIO
-- query, and whether Smart Search auto-classified the query rather
-- than the operator clicking a specific mode button. Both columns are
-- nullable so historical rows (written before this migration) stay
-- queryable; new writes populate them.

ALTER TABLE chat_search_stats
    ADD COLUMN IF NOT EXISTS model_used        TEXT,
    ADD COLUMN IF NOT EXISTS smart_search_used BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for "show me everything that ran on claude-haiku-4-5" type
-- queries.
CREATE INDEX IF NOT EXISTS idx_chat_stats_model_used
    ON chat_search_stats (tenant_id, model_used, created_at DESC)
    WHERE model_used IS NOT NULL;
