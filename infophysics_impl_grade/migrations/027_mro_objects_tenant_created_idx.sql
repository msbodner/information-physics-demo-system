-- 027_mro_objects_tenant_created_idx.sql
-- Adds a composite index on mro_objects(tenant_id, created_at DESC) to let the
-- planner satisfy stats.get_stat_mro lookups (and similar tenant-scoped recent
-- listings) with an index range scan instead of a full table scan. The query
-- logic in api/routes/stats.py is unchanged; this index only improves equality
-- on tenant_id combined with created_at ordering. Idempotent.

CREATE INDEX IF NOT EXISTS idx_mro_objects_tenant_created
  ON mro_objects (tenant_id, created_at DESC);
