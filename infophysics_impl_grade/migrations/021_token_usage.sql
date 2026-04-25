-- 021_token_usage.sql
-- Per-tenant daily token-budget enforcement.
--
-- Two pieces:
--   1. ``tenant_token_usage`` — daily counter of consumed input/output
--      tokens, keyed (tenant_id, usage_day). The ``record_usage`` helper
--      upserts on every successful LLM call.
--   2. system_settings rows — ``daily_token_budget_per_tenant`` (global
--      default) and optional per-tenant overrides. Soft warning triggers
--      at 80% spend, hard block at 100%.
--
-- The hard block returns HTTP 429 from ``budget.check_budget()`` so the
-- caller can short-circuit BEFORE the Anthropic round-trip — that is
-- the whole point: to stop a runaway loop before it costs anything.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS tenant_token_usage (
  tenant_id     text NOT NULL DEFAULT 'tenantA',
  usage_day     date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  input_tokens  bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  call_count    int    NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, usage_day)
);

CREATE INDEX IF NOT EXISTS idx_token_usage_day
  ON tenant_token_usage(usage_day);

ALTER TABLE tenant_token_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_token_usage FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_token_usage_tenant_isolation ON tenant_token_usage
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Default budget. Tenants can override by inserting their own row in
-- system_settings keyed ``daily_token_budget:<tenant_id>``. The helper
-- consults the override first and falls back to this global default.
INSERT INTO system_settings (key, value)
  VALUES ('daily_token_budget_per_tenant', '500000')
  ON CONFLICT (key) DO NOTHING;
