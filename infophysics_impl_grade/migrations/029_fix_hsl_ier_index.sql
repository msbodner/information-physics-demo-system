-- 029_fix_hsl_ier_index.sql
-- Fix HSL inverted-index population so cue→HSL lookups work.
--
-- Background: migration 017 created `information_element_refs` as the fast
-- inverted index for HSL Phase 2 retrieval. Its `ier_refresh_hsl` helper
-- only scanned `hsl_element_*` columns through `ier_parse_bracket`, which
-- only emits a row when the input is a `[Key.Value]` bracket token.
--
-- In practice `hsl_data.hsl_element_*` carries AIO row-name refs like
-- `acc_rfis.csv - Row 164` rather than bracket tokens. The bracket parser
-- silently no-ops on those, so the index never gained an HSL row. The HSL's
-- own `[Key.Value]` token actually lives in `hsl_data.hsl_name` (e.g.
-- `[Assigned To.James Okafor].hsl`) and was never read.
--
-- Fix: replace `ier_refresh_hsl` so it ALSO parses `hsl_name` (after
-- stripping the trailing `.hsl` suffix). The element-column scan is kept
-- for HSLs whose elements happen to carry bracket-form refs (e.g.
-- `[MRO.<id>]` back-links from `link_mro_to_hsl`). Then re-run the
-- backfill from migration 017 so existing HSL rows get indexed.
--
-- Idempotent: the inner DELETE-then-INSERT in `ier_refresh_hsl` makes
-- re-running this migration safe — refs are rebuilt without duplicates.

CREATE OR REPLACE FUNCTION ier_refresh_hsl(p_hsl_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  row_json jsonb;
  row_tenant text;
  hsl_name_local text;
  i int;
  col_val text;
  parsed record;
BEGIN
  DELETE FROM information_element_refs WHERE hsl_id = p_hsl_id;

  SELECT to_jsonb(h.*), h.tenant_id, h.hsl_name
    INTO row_json, row_tenant, hsl_name_local
    FROM hsl_data h WHERE h.hsl_id = p_hsl_id;
  IF row_json IS NULL THEN RETURN; END IF;

  -- NEW: index the HSL's own [Key.Value] derived from hsl_name. The .hsl
  -- suffix is stripped first so the bracket parser sees a clean token.
  -- position=0 marks "this came from the name itself."
  IF hsl_name_local IS NOT NULL THEN
    FOR parsed IN SELECT * FROM ier_parse_bracket(
      regexp_replace(hsl_name_local, '\.hsl$', '')
    ) LOOP
      INSERT INTO information_element_refs
        (tenant_id, field_name, value, value_lower, hsl_id, aio_id, position)
      VALUES
        (row_tenant, parsed.field_name, parsed.value,
         lower(parsed.value), p_hsl_id, NULL, 0);
    END LOOP;
  END IF;

  -- Existing element-column scan stays for HSLs whose elements carry
  -- bracket-form refs ([MRO.<id>] back-links and any future shape).
  FOR i IN 1..100 LOOP
    col_val := row_json->>('hsl_element_' || i);
    IF col_val IS NULL OR length(trim(col_val)) = 0 THEN CONTINUE; END IF;
    FOR parsed IN SELECT * FROM ier_parse_bracket(col_val) LOOP
      INSERT INTO information_element_refs
        (tenant_id, field_name, value, value_lower, hsl_id, aio_id, position)
      VALUES
        (row_tenant, parsed.field_name, parsed.value,
         lower(parsed.value), p_hsl_id, NULL, i);
    END LOOP;
  END LOOP;
END;
$$;

-- Re-run the backfill from migration 017 so existing HSL rows pick up
-- the new hsl_name-derived refs. Same RLS-bypass dance as 017.
DO $$
DECLARE
  r record;
BEGIN
  SET LOCAL row_security = off;

  FOR r IN SELECT hsl_id, tenant_id FROM hsl_data LOOP
    PERFORM set_config('app.tenant_id', r.tenant_id, true);
    PERFORM ier_refresh_hsl(r.hsl_id);
  END LOOP;
END $$;

SET row_security = on;
