-- 024_aio_search_quality.sql
-- Per-query quality + timing log for AIO Search.
--
-- Pure observability: we capture one row per AIO Search invocation with
-- timing breakdown, retrieval counts, citation stats, and cache flags.
-- This is the prerequisite for safely tuning AIO_SEARCH_*_CAP, evaluating
-- HNSW candidate generation, or measuring whether a two-stage retrieval
-- variant actually wins. Without this table, those changes can only be
-- evaluated by gut feel.
--
-- Writes are best-effort (silent on failure) and gated by env flag
-- AIO_SEARCH_LOG_QUALITY=1, so this migration is a no-op for deployments
-- that don't opt in. The table is independent — nothing references it,
-- nothing queries it on the hot path.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS aio_search_quality (
  log_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           text NOT NULL DEFAULT 'tenantA',
  mode                text NOT NULL,                  -- 'aio-search' | 'aio-search-stream'
  query_text          text NOT NULL,
  query_hash          text NOT NULL,                  -- sha256(tenant|mode|normalized)

  -- Cue / retrieval shape
  num_cues            int  NOT NULL DEFAULT 0,
  hsls_matched        int  NOT NULL DEFAULT 0,
  aios_matched        int  NOT NULL DEFAULT 0,
  aios_shipped        int  NOT NULL DEFAULT 0,
  sources_cited       int  NULL,                      -- from cite_aios post-pass
  density_per_cue     real NULL,                      -- aios_matched / max(1, num_cues)

  -- Timing breakdown (milliseconds)
  parse_ms            int  NOT NULL DEFAULT 0,
  retrieval_ms        int  NOT NULL DEFAULT 0,
  llm_ms              int  NOT NULL DEFAULT 0,
  total_ms            int  NOT NULL DEFAULT 0,

  -- Cache flags
  served_from_cache   boolean NOT NULL DEFAULT false, -- answer cache hit (skipped LLM entirely)
  parse_cache_hit     boolean NOT NULL DEFAULT false, -- parse cache hit (skipped Phase 1 LLM)

  -- Token usage (informational; budget table is the source of truth)
  input_tokens        int  NOT NULL DEFAULT 0,
  output_tokens       int  NOT NULL DEFAULT 0,

  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Tenant-first indexes for the obvious dashboard queries:
--   "p95 total_ms by day" / "cited / shipped over time" / "cache hit rate".
CREATE INDEX IF NOT EXISTS idx_aio_search_quality_tenant_created
  ON aio_search_quality (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aio_search_quality_query_hash
  ON aio_search_quality (tenant_id, query_hash);

ALTER TABLE aio_search_quality ENABLE ROW LEVEL SECURITY;
ALTER TABLE aio_search_quality FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_aio_search_quality_tenant_isolation ON aio_search_quality
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
