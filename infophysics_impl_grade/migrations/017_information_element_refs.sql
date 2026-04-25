-- 017_information_element_refs.sql
-- Inverted-index for HSL Phase 2 retrieval.
--
-- Before this migration, AIO Search Phase 2 (chat.py::_aio_search_prepare)
-- ran one of:
--   • elements_text LIKE %needle% × N needles            (trigram GIN, fast)
--   • per-element ILIKE × 100 columns × N needles        (full seq scan)
-- The fast path works at our current scale (~1K HSLs) but degrades with
-- N×100×rows. The fallback path is a dead end past ~5K HSLs.
--
-- Strategy: every HSL/AIO element string of the form `[Key.Value]` is
-- exploded into a row in `information_element_refs(field_name, value, …)`
-- with B-tree indexes on the value column. Phase 2 then becomes:
--   SELECT DISTINCT hsl_id FROM information_element_refs
--   WHERE value_lower = ANY(%s)
-- Single indexed query, O(log n) per needle.
--
-- The `value_lower` column is also trigram-indexed so substring needles
-- (e.g. "vance" matching "Sarah Vance") can still hit the index when an
-- exact-equality probe misses.
--
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 1. The inverted-index table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS information_element_refs (
  ref_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   text NOT NULL DEFAULT 'tenantA',
  field_name  text NOT NULL,                -- the [Key.…] portion
  value       text NOT NULL,                -- original-case [….Value]
  value_lower text NOT NULL,                -- lower(value) for index hits
  hsl_id      uuid NULL,                    -- set when row originates in hsl_data
  aio_id      uuid NULL,                    -- set when row originates in aio_data
  position    int  NOT NULL,                -- element column index (1-based)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Tenant-scoped indexes; the value_lower B-tree drives the equality probe,
-- and the trgm GIN drives ILIKE fallback.
CREATE INDEX IF NOT EXISTS idx_ier_tenant         ON information_element_refs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ier_value_lower    ON information_element_refs(value_lower);
CREATE INDEX IF NOT EXISTS idx_ier_field_value    ON information_element_refs(field_name, value_lower);
CREATE INDEX IF NOT EXISTS idx_ier_hsl_id         ON information_element_refs(hsl_id) WHERE hsl_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ier_aio_id         ON information_element_refs(aio_id) WHERE aio_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ier_value_trgm     ON information_element_refs USING GIN (value_lower gin_trgm_ops);

ALTER TABLE information_element_refs ENABLE ROW LEVEL SECURITY;
ALTER TABLE information_element_refs FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_ier_tenant_isolation ON information_element_refs
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 2. Element parser ────────────────────────────────────────────────
-- Parses `[Key.Value]` → (field_name, value). Returns NULL row when the
-- string is not a bracket token (e.g. raw values pre-format).  We accept
-- the first dot as the field/value separator so values may themselves
-- contain dots, e.g. `[File.report.v2.pdf]` → field="File", value="report.v2.pdf".
CREATE OR REPLACE FUNCTION ier_parse_bracket(s text)
RETURNS TABLE(field_name text, value text)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  inner_ text;
  dot int;
BEGIN
  IF s IS NULL THEN RETURN; END IF;
  s := trim(s);
  IF length(s) < 4 OR left(s, 1) <> '[' OR right(s, 1) <> ']' THEN RETURN; END IF;
  inner_ := substring(s FROM 2 FOR length(s) - 2);
  dot := position('.' IN inner_);
  IF dot < 2 OR dot = length(inner_) THEN RETURN; END IF;
  field_name := substring(inner_ FROM 1 FOR dot - 1);
  value      := substring(inner_ FROM dot + 1);
  RETURN NEXT;
END;
$$;

-- ── 3. Per-row refresh helpers ───────────────────────────────────────
-- These rebuild the refs for a single hsl/aio row. Called from the
-- triggers AND from the backfill block.
CREATE OR REPLACE FUNCTION ier_refresh_hsl(p_hsl_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  i int;
  col_val text;
  parsed record;
BEGIN
  DELETE FROM information_element_refs WHERE hsl_id = p_hsl_id;

  SELECT * INTO rec FROM hsl_data WHERE hsl_id = p_hsl_id;
  IF rec IS NULL THEN RETURN; END IF;

  FOR i IN 1..100 LOOP
    EXECUTE format('SELECT ($1).hsl_element_%s', i) INTO col_val USING rec;
    IF col_val IS NULL OR length(trim(col_val)) = 0 THEN CONTINUE; END IF;
    FOR parsed IN SELECT * FROM ier_parse_bracket(col_val) LOOP
      INSERT INTO information_element_refs
        (tenant_id, field_name, value, value_lower, hsl_id, aio_id, position)
      VALUES
        (rec.tenant_id, parsed.field_name, parsed.value,
         lower(parsed.value), p_hsl_id, NULL, i);
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION ier_refresh_aio(p_aio_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  rec record;
  i int;
  col_val text;
  parsed record;
BEGIN
  DELETE FROM information_element_refs WHERE aio_id = p_aio_id;

  SELECT * INTO rec FROM aio_data WHERE aio_id = p_aio_id;
  IF rec IS NULL THEN RETURN; END IF;

  FOR i IN 1..50 LOOP
    EXECUTE format('SELECT ($1).element_%s', i) INTO col_val USING rec;
    IF col_val IS NULL OR length(trim(col_val)) = 0 THEN CONTINUE; END IF;
    FOR parsed IN SELECT * FROM ier_parse_bracket(col_val) LOOP
      INSERT INTO information_element_refs
        (tenant_id, field_name, value, value_lower, hsl_id, aio_id, position)
      VALUES
        (rec.tenant_id, parsed.field_name, parsed.value,
         lower(parsed.value), NULL, p_aio_id, i);
    END LOOP;
  END LOOP;
END;
$$;

-- ── 4. Triggers to keep the index in sync ────────────────────────────
CREATE OR REPLACE FUNCTION ier_hsl_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM information_element_refs WHERE hsl_id = OLD.hsl_id;
    RETURN OLD;
  ELSE
    PERFORM ier_refresh_hsl(NEW.hsl_id);
    RETURN NEW;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION ier_aio_trigger()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM information_element_refs WHERE aio_id = OLD.aio_id;
    RETURN OLD;
  ELSE
    PERFORM ier_refresh_aio(NEW.aio_id);
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_hsl_data_ier ON hsl_data;
CREATE TRIGGER trg_hsl_data_ier
AFTER INSERT OR UPDATE OR DELETE ON hsl_data
FOR EACH ROW EXECUTE FUNCTION ier_hsl_trigger();

DROP TRIGGER IF EXISTS trg_aio_data_ier ON aio_data;
CREATE TRIGGER trg_aio_data_ier
AFTER INSERT OR UPDATE OR DELETE ON aio_data
FOR EACH ROW EXECUTE FUNCTION ier_aio_trigger();

-- ── 5. Backfill ──────────────────────────────────────────────────────
-- Only runs if the inverted-index table is empty, so re-running this
-- migration is a no-op.
DO $$
DECLARE
  cnt int;
  r record;
BEGIN
  SELECT count(*) INTO cnt FROM information_element_refs;
  IF cnt > 0 THEN RETURN; END IF;

  -- Back-fill must bypass RLS while it scans every tenant. The
  -- migration session runs as the table owner with FORCE RLS off
  -- here because we set app.tenant_id on a per-row basis below.
  PERFORM set_config('app.tenant_id', 'tenantA', true);

  FOR r IN SELECT hsl_id, tenant_id FROM hsl_data LOOP
    PERFORM set_config('app.tenant_id', r.tenant_id, true);
    PERFORM ier_refresh_hsl(r.hsl_id);
  END LOOP;

  FOR r IN SELECT aio_id, tenant_id FROM aio_data LOOP
    PERFORM set_config('app.tenant_id', r.tenant_id, true);
    PERFORM ier_refresh_aio(r.aio_id);
  END LOOP;
END $$;
