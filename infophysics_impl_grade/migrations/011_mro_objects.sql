CREATE TABLE IF NOT EXISTS mro_objects (
  mro_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mro_key TEXT NOT NULL,
  query_text TEXT NOT NULL,
  intent TEXT,
  seed_hsls TEXT,
  matched_aios_count INTEGER DEFAULT 0,
  search_terms JSONB,
  result_text TEXT NOT NULL,
  context_bundle TEXT,
  confidence TEXT DEFAULT 'derived',
  policy_scope TEXT DEFAULT 'tenantA',
  tenant_id TEXT DEFAULT 'tenantA',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mro_tenant ON mro_objects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mro_key ON mro_objects(mro_key);

-- Fix: drop NOT NULL on tenant_id if it exists from prior migration run
ALTER TABLE mro_objects ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE mro_objects ALTER COLUMN tenant_id SET DEFAULT 'tenantA';
