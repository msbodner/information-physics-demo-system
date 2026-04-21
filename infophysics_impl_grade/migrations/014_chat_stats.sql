-- 014_chat_stats.sql
-- Stores performance and context statistics for every ChatAIO search.
-- One row per search event (Send, AIO Search, Substrate).

CREATE TABLE IF NOT EXISTS chat_search_stats (
    stat_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       TEXT        NOT NULL DEFAULT 'tenantA',
    search_mode     TEXT        NOT NULL,   -- 'Send' | 'AIOSearch' | 'Substrate'
    query_text      TEXT        NOT NULL,
    result_preview  TEXT,                   -- first 500 chars of the reply
    elapsed_ms      INTEGER     DEFAULT 0,
    input_tokens    INTEGER     DEFAULT 0,
    output_tokens   INTEGER     DEFAULT 0,
    total_tokens    INTEGER     DEFAULT 0,
    -- Send / AIO Search fields
    context_records INTEGER     DEFAULT 0,
    matched_hsls    INTEGER     DEFAULT 0,
    matched_aios    INTEGER     DEFAULT 0,
    -- Substrate-specific fields
    cue_count       INTEGER     DEFAULT 0,
    neighborhood_size INTEGER   DEFAULT 0,
    prior_count     INTEGER     DEFAULT 0,
    mro_saved       BOOLEAN     DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_stats_tenant
    ON chat_search_stats (tenant_id, created_at DESC);
