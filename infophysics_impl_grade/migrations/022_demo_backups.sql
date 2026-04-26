-- Migration 022: demo_backups
-- Snapshots of tenant data tables (everything except users / roles /
-- system_settings / tenants) so an operator can clear the system for a
-- fresh demo and optionally restore the prior state.

CREATE TABLE IF NOT EXISTS demo_backups (
    backup_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     TEXT NOT NULL,
    name          TEXT NOT NULL,
    note          TEXT,
    counts        JSONB NOT NULL DEFAULT '{}'::jsonb,
    snapshot      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by    TEXT
);

CREATE INDEX IF NOT EXISTS idx_demo_backups_tenant_created
    ON demo_backups (tenant_id, created_at DESC);

-- demo_backups is tenant-scoped via tenant_id column. We do NOT enable RLS
-- here so that admin operators can list/restore across tenants when
-- explicitly authorized; the API layer enforces tenant scoping by passing
-- X-Tenant-Id through to the WHERE clause.
