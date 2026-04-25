-- 019_aio_embeddings.sql
-- Sidecar table for AIO embedding vectors used by the Phase 3 re-rank.
--
-- Design notes:
--   * Plain `double precision[]` rather than pgvector — keeps the migration
--     dependency-free across Railway/Postgres images that don't ship with
--     the extension. Cosine similarity is computed in Python over the
--     small candidate set (≤ AIO_CAP) returned by lexical retrieval, so
--     ANN indexes aren't needed at this scale.
--   * `model_ref` records which embedding model produced the vector so
--     mixed-model corpora don't silently degrade re-rank quality. The
--     re-rank step skips rows whose model_ref differs from the active
--     query embedding's model.
--   * `dim` is denormalised for sanity-checking — a corrupted insert with
--     the wrong dimensionality is caught before the Python dot product
--     blows up with a shape mismatch.
--   * Embeddings are OPTIONAL. The chat pipeline gates on the presence of
--     an embedding provider (VOYAGE_API_KEY); when disabled this table
--     stays empty and Phase 3 falls through to the lexical ordering.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS aio_embeddings (
  aio_id      uuid PRIMARY KEY REFERENCES aio_data(aio_id) ON DELETE CASCADE,
  tenant_id   text NOT NULL DEFAULT 'tenantA',
  model_ref   text NOT NULL,
  dim         int  NOT NULL,
  vector      double precision[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_aio_embeddings_tenant     ON aio_embeddings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_aio_embeddings_model_ref  ON aio_embeddings(model_ref);

ALTER TABLE aio_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE aio_embeddings FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_aio_embeddings_tenant_isolation ON aio_embeddings
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
