-- 015_rls_aio_hsl_mro.sql
-- Adds tenant_id + Row-Level Security to aio_data, hsl_data, mro_objects.
--
-- Prior to this migration the three most important business tables were
-- un-isolated: any tenant could read/write every other tenant's AIOs,
-- HSLs, and MROs. This migration makes the "multi-tenant" claim real.
--
-- Strategy matches 003_rls.sql: tenant scope is set per-request via
--   SET LOCAL app.tenant_id = '<tenant>'
-- and the policy compares to current_setting('app.tenant_id', true).
--
-- We use FORCE ROW LEVEL SECURITY so the policy also applies to the
-- table owner (the app role). Without FORCE, owners bypass RLS and the
-- isolation would be cosmetic.
--
-- Idempotent: safe to re-run.

-- ── 1. Add tenant_id to aio_data / hsl_data ──────────────────────────
-- Existing rows are backfilled to 'tenantA' via the column default.
ALTER TABLE aio_data ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenantA';
ALTER TABLE hsl_data ADD COLUMN IF NOT EXISTS tenant_id text NOT NULL DEFAULT 'tenantA';

CREATE INDEX IF NOT EXISTS idx_aio_data_tenant ON aio_data(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hsl_data_tenant ON hsl_data(tenant_id);

-- mro_objects already has tenant_id from 011_mro_objects.sql. Backfill
-- any rows that slipped in with NULL.
UPDATE mro_objects SET tenant_id = 'tenantA' WHERE tenant_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_mro_objects_tenant ON mro_objects(tenant_id);

-- ── 2. Enable + FORCE RLS on all three tables ────────────────────────
ALTER TABLE aio_data     ENABLE ROW LEVEL SECURITY;
ALTER TABLE aio_data     FORCE  ROW LEVEL SECURITY;
ALTER TABLE hsl_data     ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsl_data     FORCE  ROW LEVEL SECURITY;
ALTER TABLE mro_objects  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mro_objects  FORCE  ROW LEVEL SECURITY;

-- ── 3. Tenant-isolation policies ─────────────────────────────────────
-- USING governs visibility on SELECT / UPDATE / DELETE; WITH CHECK
-- prevents INSERT / UPDATE writing a row outside the current tenant.
DO $$ BEGIN
  CREATE POLICY p_aio_data_tenant_isolation ON aio_data
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_hsl_data_tenant_isolation ON hsl_data
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_mro_objects_tenant_isolation ON mro_objects
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
