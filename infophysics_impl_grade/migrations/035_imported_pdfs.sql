-- 035_imported_pdfs.sql
--
-- V5.0+ — persist every PDF run through /v1/op/pdf-extract so admins can
-- review, re-download, or delete the original document from System Admin
-- → PDFs. The bytes live in a bytea column (most demo PDFs are <5 MB);
-- larger payloads are still permitted (backend caps at 100 MB on ingest)
-- but operators should consider object storage if the table grows large.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS imported_pdfs (
  pdf_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,
  filename      text NOT NULL,
  size_bytes    bigint NOT NULL,
  page_count    int,
  sha256        text,
  -- bytea is NULLable so that metadata-only restores from a demo backup
  -- (which excludes the content column to keep backup files small) can
  -- still re-create rows. The /v1/op/pdf-extract path always provides
  -- bytes; restored metadata-only rows surface "content purged" in the
  -- admin viewer.
  content       bytea,
  status        text NOT NULL DEFAULT 'extracted',  -- extracted | failed | pending | partial
  csv_text      text,
  headers       jsonb,
  row_count     int,
  chunk_count   int,
  chunks_failed int,
  duration_ms   int,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_imported_pdfs_tenant_created
  ON imported_pdfs (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_imported_pdfs_sha256
  ON imported_pdfs (tenant_id, sha256)
  WHERE sha256 IS NOT NULL;
