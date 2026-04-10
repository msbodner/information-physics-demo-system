-- 003_rls.sql
-- RLS strategy: set tenant id in session parameter `app.tenant_id`.
-- Example (per request): SET LOCAL app.tenant_id = 'tenantA';

-- Helper: ensure parameter exists
DO $$
BEGIN
  PERFORM current_setting('app.tenant_id', true);
EXCEPTION WHEN others THEN
  -- ignore
END $$;

-- Enable RLS on core tables
ALTER TABLE information_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE extracted_text_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE chunk_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE embedding_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE summary_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE structured_view_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE derivation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE derivation_event_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE derivation_event_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE io_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_scopes ENABLE ROW LEVEL SECURITY;

-- Policies (isolation) -- idempotent via DO blocks
DO $$ BEGIN
  CREATE POLICY p_io_tenant_isolation ON information_objects
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_text_tenant_isolation ON extracted_text_versions
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_chunks_tenant_isolation ON chunk_versions
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_embed_tenant_isolation ON embedding_versions
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_summary_tenant_isolation ON summary_versions
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_view_tenant_isolation ON structured_view_versions
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_events_tenant_isolation ON derivation_events
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_event_inputs_tenant_isolation ON derivation_event_inputs
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_event_outputs_tenant_isolation ON derivation_event_outputs
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_links_tenant_isolation ON io_links
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_entities_tenant_isolation ON entities
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_entity_aliases_tenant_isolation ON entity_aliases
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_entity_mentions_tenant_isolation ON entity_mentions
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_citations_tenant_isolation ON citations
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY p_policy_scopes_tenant_isolation ON policy_scopes
    USING (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
