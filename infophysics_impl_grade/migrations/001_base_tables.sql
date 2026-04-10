-- 001_base_tables.sql
-- Tenancy
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id        text PRIMARY KEY,
  name             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  is_active        boolean NOT NULL DEFAULT true,
  kms_key_ref      text NULL
);

-- Policy scopes
CREATE TABLE IF NOT EXISTS policy_scopes (
  policy_scope_id  text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name             text NOT NULL,
  rules_json       jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Information Objects
CREATE TABLE IF NOT EXISTS information_objects (
  io_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  type             text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  captured_at      timestamptz NULL,

  raw_uri          text NULL,
  raw_hash         text NULL,
  mime_type        text NULL,
  size_bytes       bigint NULL,
  encryption_ref   text NULL,

  source_system    text NULL,
  source_object_id text NULL,
  author           text NULL,
  time_start       timestamptz NULL,
  time_end         timestamptz NULL,
  policy_scope_id  text NULL REFERENCES policy_scopes(policy_scope_id),

  lineage_root     uuid NULL,
  is_deleted       boolean NOT NULL DEFAULT false
);

-- Versioned representations
CREATE TABLE IF NOT EXISTS extracted_text_versions (
  text_ref         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  io_id            uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  version          int  NOT NULL,
  extractor        text NOT NULL,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  text_uri         text NOT NULL,
  text_hash        text NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, io_id, version)
);

CREATE TABLE IF NOT EXISTS chunk_versions (
  chunks_ref       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  io_id            uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  text_ref         uuid NOT NULL REFERENCES extracted_text_versions(text_ref) ON DELETE CASCADE,
  version          int  NOT NULL,
  chunker          text NOT NULL,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  chunks_uri       text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, io_id, version)
);

CREATE TABLE IF NOT EXISTS embedding_versions (
  embedding_ref    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  io_id            uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  chunks_ref       uuid NOT NULL REFERENCES chunk_versions(chunks_ref) ON DELETE CASCADE,
  version          int  NOT NULL,
  model_ref        text NOT NULL,
  dims             int  NOT NULL,
  index_backend    text NOT NULL,
  index_pointer    jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, io_id, model_ref, version)
);

CREATE TABLE IF NOT EXISTS summary_versions (
  summary_ref      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  io_id            uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  version          int  NOT NULL,
  scope            text NOT NULL,
  model_ref        text NOT NULL,
  params           jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_uri      text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, io_id, scope, version)
);

CREATE TABLE IF NOT EXISTS structured_view_versions (
  view_ref         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  version          int  NOT NULL,
  name             text NULL,
  schema_spec      jsonb NOT NULL,
  loss_budget      jsonb NOT NULL DEFAULT '{}'::jsonb,
  storage_backend  text NOT NULL,
  storage_pointer  jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name, version)
);

-- Derivation events (immutable transformation records)
CREATE TABLE IF NOT EXISTS derivation_events (
  event_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  operator         text NOT NULL,
  timestamp        timestamptz NOT NULL DEFAULT now(),
  parameters       jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_ref        text NULL,
  cost_metrics     jsonb NOT NULL DEFAULT '{}'::jsonb,
  provenance_map   jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS derivation_event_inputs (
  event_id         uuid NOT NULL REFERENCES derivation_events(event_id) ON DELETE CASCADE,
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  io_id            uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  ref              text NULL,
  PRIMARY KEY (event_id, io_id, ref)
);

CREATE TABLE IF NOT EXISTS derivation_event_outputs (
  event_id         uuid NOT NULL REFERENCES derivation_events(event_id) ON DELETE CASCADE,
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  io_id            uuid NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  ref              text NOT NULL,
  PRIMARY KEY (event_id, ref)
);

-- Links and entities
CREATE TABLE IF NOT EXISTS io_links (
  link_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  from_io_id       uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  to_io_id         uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  link_type        text NOT NULL,
  confidence       numeric NULL,
  evidence_ref     text NULL,
  created_by       text NOT NULL DEFAULT 'system',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entities (
  entity_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  canonical_name   text NOT NULL,
  entity_type      text NOT NULL,
  attributes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  alias            text NOT NULL,
  PRIMARY KEY (tenant_id, entity_id, alias)
);

CREATE TABLE IF NOT EXISTS entity_mentions (
  mention_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  entity_id        uuid NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  io_id            uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  locator          text NOT NULL,
  confidence       numeric NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS citations (
  citation_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        text NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  io_id            uuid NOT NULL REFERENCES information_objects(io_id) ON DELETE CASCADE,
  locator          text NOT NULL,
  quote            text NULL,
  confidence       numeric NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- NOTE: uq_io_dedupe_hash and uq_io_source constraints intentionally removed.
-- Multiple AIOs per CSV file share the same source_object_id, so uq_io_source
-- would block saving all but the first AIO row per file.  raw_hash is not
-- populated by the current ingest path, making uq_io_dedupe_hash useless.
-- Both constraints are dropped idempotently by migrations 004 and 005.
