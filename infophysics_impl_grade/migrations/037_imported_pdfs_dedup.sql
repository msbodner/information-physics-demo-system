-- 037_imported_pdfs_dedup.sql
--
-- V5.0.8+ — collapse duplicate rows in imported_pdfs and prevent future
-- duplicates. Earlier versions inserted a fresh row on every upload of
-- the same PDF, so re-uploading PO-PRJ002-0512.pdf during dev created
-- multiple identical bytea blobs cluttering System Admin → PDFs.
--
-- Strategy: keep the BEST row per (tenant_id, sha256) — best is
-- 'extracted' first, then 'partial', then 'pending', with newer
-- created_at breaking ties. Drop the rest. Then replace the existing
-- non-unique sha256 index with a UNIQUE one so any future INSERT path
-- using ON CONFLICT (or just plain duplicate guarding in app code)
-- has a structural backstop.
--
-- Idempotent.

WITH ranked AS (
  SELECT pdf_id,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, sha256
           ORDER BY
             CASE status
               WHEN 'extracted' THEN 1
               WHEN 'partial'   THEN 2
               WHEN 'finalizing' THEN 3
               WHEN 'extracting' THEN 4
               WHEN 'pending'   THEN 5
               WHEN 'failed'    THEN 6
               ELSE 7
             END,
             created_at DESC
         ) AS rn
    FROM imported_pdfs
   WHERE sha256 IS NOT NULL
)
DELETE FROM imported_pdfs
 WHERE pdf_id IN (SELECT pdf_id FROM ranked WHERE rn > 1);

-- Replace non-unique sha256 lookup index with unique partial index.
DROP INDEX IF EXISTS idx_imported_pdfs_sha256;

CREATE UNIQUE INDEX IF NOT EXISTS idx_imported_pdfs_unique_sha256
  ON imported_pdfs (tenant_id, sha256)
  WHERE sha256 IS NOT NULL;
