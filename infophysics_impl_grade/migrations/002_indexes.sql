-- 002_indexes.sql
CREATE INDEX IF NOT EXISTS idx_io_tenant_type_time ON information_objects(tenant_id, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_io_tenant_source ON information_objects(tenant_id, source_system, source_object_id);
CREATE INDEX IF NOT EXISTS idx_io_tenant_hash ON information_objects(tenant_id, raw_hash);

CREATE INDEX IF NOT EXISTS idx_deriv_events_tenant_time ON derivation_events(tenant_id, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_links_tenant_from ON io_links(tenant_id, from_io_id);
CREATE INDEX IF NOT EXISTS idx_links_tenant_to ON io_links(tenant_id, to_io_id);

CREATE INDEX IF NOT EXISTS idx_mentions_tenant_entity ON entity_mentions(tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_tenant_io ON entity_mentions(tenant_id, io_id);

-- Useful for time-window filtering
CREATE INDEX IF NOT EXISTS idx_io_time_range ON information_objects(tenant_id, time_start, time_end);
