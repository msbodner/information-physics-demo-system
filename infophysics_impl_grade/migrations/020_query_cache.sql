-- 020_query_cache.sql
-- (query_hash → MRO) micro-cache.
--
-- Anthropic's prompt cache helps within ~5 minutes; this layer extends the
-- horizon and skips the LLM call entirely. On exact hit we serve the prior
-- MRO with a "served from memory" badge — zero LLM cost, sub-50ms latency.
-- Especially powerful in demo loops where the same question is asked
-- repeatedly across sessions.
--
-- The cache is INTENTIONALLY conservative: keyed on the SHA-256 of
-- (mode, normalized_query, tenant) — only an EXACT normalized match wins.
-- Paraphrases and near-misses fall through to the full retrieval pipeline
-- where the alias / tsvector / embedding layers do their job. We don't try
-- to be clever about similarity here; that's what the rest of the stack
-- is for.
--
-- Two columns of provenance:
--   * mro_id — when the cached result has been persisted as a real MRO,
--     this points to it. The frontend can then deep-link the answer to
--     its provenance trail just like any other reply.
--   * answer_text — the verbatim reply, kept inline so the cache is
--     self-contained even if the parent MRO is later deleted.
--
-- TTL: ``expires_at`` is enforced by a partial index + GC sweep. Cache
-- bypass is supported via a query param (so demos can force a re-run).
-- Idempotent.

CREATE TABLE IF NOT EXISTS query_cache (
  cache_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL DEFAULT 'tenantA',
  mode            text NOT NULL,                -- 'aio-search' | 'chat' | …
  query_hash      text NOT NULL,                -- sha256(mode|tenant|normalized_query)
  normalized_query text NOT NULL,               -- the input we hashed (for inspection)
  answer_text     text NOT NULL,
  mro_id          uuid NULL REFERENCES mro_objects(mro_id) ON DELETE SET NULL,
  hit_count       int  NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_hit_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE (tenant_id, mode, query_hash)
);

CREATE INDEX IF NOT EXISTS idx_query_cache_tenant_mode_hash
  ON query_cache (tenant_id, mode, query_hash);
CREATE INDEX IF NOT EXISTS idx_query_cache_expires
  ON query_cache (expires_at);

ALTER TABLE query_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE query_cache FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_query_cache_tenant_isolation ON query_cache
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
