-- 016_search_text_gin.sql
-- Kill the 500-condition ILIKE storm in aio-search and friends.
--
-- Before this migration, every HSL/AIO needle search expanded into an
-- OR over 50 (AIO) or 100 (HSL) element columns, per needle — up to
-- ~500 ILIKE predicates for a single query, all unindexed, forcing
-- sequential scans on every table scan. The hottest offender is the
-- fallback branch of /v1/op/aio-search (chat.py), which previously
-- generated `element_1 ILIKE %s OR element_2 ILIKE %s OR ...` ×10.
--
-- Strategy: collapse the per-row element columns into one generated
-- text column (`elements_text`) and index it with a pg_trgm GIN so
-- `ILIKE '%needle%'` becomes a single indexed predicate.
--
-- IMPORTANT: Postgres requires GENERATED ALWAYS AS STORED expressions
-- to be IMMUTABLE. `concat_ws()` is STABLE (not IMMUTABLE) because
-- its polymorphic text casting depends on the session. We therefore
-- use plain `||` chaining with `coalesce(col, '')`, which is fully
-- immutable for text columns.
--
-- Generated STORED columns update automatically on INSERT/UPDATE, so
-- application code does not need to maintain the search column.
--
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── aio_data: name + 50 element columns ─────────────────────────────
ALTER TABLE aio_data
  ADD COLUMN IF NOT EXISTS elements_text text
  GENERATED ALWAYS AS (
    lower(
      coalesce(aio_name,    '') || ' ' ||
      coalesce(element_1,   '') || ' ' || coalesce(element_2,   '') || ' ' ||
      coalesce(element_3,   '') || ' ' || coalesce(element_4,   '') || ' ' ||
      coalesce(element_5,   '') || ' ' || coalesce(element_6,   '') || ' ' ||
      coalesce(element_7,   '') || ' ' || coalesce(element_8,   '') || ' ' ||
      coalesce(element_9,   '') || ' ' || coalesce(element_10,  '') || ' ' ||
      coalesce(element_11,  '') || ' ' || coalesce(element_12,  '') || ' ' ||
      coalesce(element_13,  '') || ' ' || coalesce(element_14,  '') || ' ' ||
      coalesce(element_15,  '') || ' ' || coalesce(element_16,  '') || ' ' ||
      coalesce(element_17,  '') || ' ' || coalesce(element_18,  '') || ' ' ||
      coalesce(element_19,  '') || ' ' || coalesce(element_20,  '') || ' ' ||
      coalesce(element_21,  '') || ' ' || coalesce(element_22,  '') || ' ' ||
      coalesce(element_23,  '') || ' ' || coalesce(element_24,  '') || ' ' ||
      coalesce(element_25,  '') || ' ' || coalesce(element_26,  '') || ' ' ||
      coalesce(element_27,  '') || ' ' || coalesce(element_28,  '') || ' ' ||
      coalesce(element_29,  '') || ' ' || coalesce(element_30,  '') || ' ' ||
      coalesce(element_31,  '') || ' ' || coalesce(element_32,  '') || ' ' ||
      coalesce(element_33,  '') || ' ' || coalesce(element_34,  '') || ' ' ||
      coalesce(element_35,  '') || ' ' || coalesce(element_36,  '') || ' ' ||
      coalesce(element_37,  '') || ' ' || coalesce(element_38,  '') || ' ' ||
      coalesce(element_39,  '') || ' ' || coalesce(element_40,  '') || ' ' ||
      coalesce(element_41,  '') || ' ' || coalesce(element_42,  '') || ' ' ||
      coalesce(element_43,  '') || ' ' || coalesce(element_44,  '') || ' ' ||
      coalesce(element_45,  '') || ' ' || coalesce(element_46,  '') || ' ' ||
      coalesce(element_47,  '') || ' ' || coalesce(element_48,  '') || ' ' ||
      coalesce(element_49,  '') || ' ' || coalesce(element_50,  '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_aio_data_elements_trgm
  ON aio_data USING GIN (elements_text gin_trgm_ops);

-- ── hsl_data: name + 100 element columns ────────────────────────────
ALTER TABLE hsl_data
  ADD COLUMN IF NOT EXISTS elements_text text
  GENERATED ALWAYS AS (
    lower(
      coalesce(hsl_name,        '') || ' ' ||
      coalesce(hsl_element_1,   '') || ' ' || coalesce(hsl_element_2,   '') || ' ' ||
      coalesce(hsl_element_3,   '') || ' ' || coalesce(hsl_element_4,   '') || ' ' ||
      coalesce(hsl_element_5,   '') || ' ' || coalesce(hsl_element_6,   '') || ' ' ||
      coalesce(hsl_element_7,   '') || ' ' || coalesce(hsl_element_8,   '') || ' ' ||
      coalesce(hsl_element_9,   '') || ' ' || coalesce(hsl_element_10,  '') || ' ' ||
      coalesce(hsl_element_11,  '') || ' ' || coalesce(hsl_element_12,  '') || ' ' ||
      coalesce(hsl_element_13,  '') || ' ' || coalesce(hsl_element_14,  '') || ' ' ||
      coalesce(hsl_element_15,  '') || ' ' || coalesce(hsl_element_16,  '') || ' ' ||
      coalesce(hsl_element_17,  '') || ' ' || coalesce(hsl_element_18,  '') || ' ' ||
      coalesce(hsl_element_19,  '') || ' ' || coalesce(hsl_element_20,  '') || ' ' ||
      coalesce(hsl_element_21,  '') || ' ' || coalesce(hsl_element_22,  '') || ' ' ||
      coalesce(hsl_element_23,  '') || ' ' || coalesce(hsl_element_24,  '') || ' ' ||
      coalesce(hsl_element_25,  '') || ' ' || coalesce(hsl_element_26,  '') || ' ' ||
      coalesce(hsl_element_27,  '') || ' ' || coalesce(hsl_element_28,  '') || ' ' ||
      coalesce(hsl_element_29,  '') || ' ' || coalesce(hsl_element_30,  '') || ' ' ||
      coalesce(hsl_element_31,  '') || ' ' || coalesce(hsl_element_32,  '') || ' ' ||
      coalesce(hsl_element_33,  '') || ' ' || coalesce(hsl_element_34,  '') || ' ' ||
      coalesce(hsl_element_35,  '') || ' ' || coalesce(hsl_element_36,  '') || ' ' ||
      coalesce(hsl_element_37,  '') || ' ' || coalesce(hsl_element_38,  '') || ' ' ||
      coalesce(hsl_element_39,  '') || ' ' || coalesce(hsl_element_40,  '') || ' ' ||
      coalesce(hsl_element_41,  '') || ' ' || coalesce(hsl_element_42,  '') || ' ' ||
      coalesce(hsl_element_43,  '') || ' ' || coalesce(hsl_element_44,  '') || ' ' ||
      coalesce(hsl_element_45,  '') || ' ' || coalesce(hsl_element_46,  '') || ' ' ||
      coalesce(hsl_element_47,  '') || ' ' || coalesce(hsl_element_48,  '') || ' ' ||
      coalesce(hsl_element_49,  '') || ' ' || coalesce(hsl_element_50,  '') || ' ' ||
      coalesce(hsl_element_51,  '') || ' ' || coalesce(hsl_element_52,  '') || ' ' ||
      coalesce(hsl_element_53,  '') || ' ' || coalesce(hsl_element_54,  '') || ' ' ||
      coalesce(hsl_element_55,  '') || ' ' || coalesce(hsl_element_56,  '') || ' ' ||
      coalesce(hsl_element_57,  '') || ' ' || coalesce(hsl_element_58,  '') || ' ' ||
      coalesce(hsl_element_59,  '') || ' ' || coalesce(hsl_element_60,  '') || ' ' ||
      coalesce(hsl_element_61,  '') || ' ' || coalesce(hsl_element_62,  '') || ' ' ||
      coalesce(hsl_element_63,  '') || ' ' || coalesce(hsl_element_64,  '') || ' ' ||
      coalesce(hsl_element_65,  '') || ' ' || coalesce(hsl_element_66,  '') || ' ' ||
      coalesce(hsl_element_67,  '') || ' ' || coalesce(hsl_element_68,  '') || ' ' ||
      coalesce(hsl_element_69,  '') || ' ' || coalesce(hsl_element_70,  '') || ' ' ||
      coalesce(hsl_element_71,  '') || ' ' || coalesce(hsl_element_72,  '') || ' ' ||
      coalesce(hsl_element_73,  '') || ' ' || coalesce(hsl_element_74,  '') || ' ' ||
      coalesce(hsl_element_75,  '') || ' ' || coalesce(hsl_element_76,  '') || ' ' ||
      coalesce(hsl_element_77,  '') || ' ' || coalesce(hsl_element_78,  '') || ' ' ||
      coalesce(hsl_element_79,  '') || ' ' || coalesce(hsl_element_80,  '') || ' ' ||
      coalesce(hsl_element_81,  '') || ' ' || coalesce(hsl_element_82,  '') || ' ' ||
      coalesce(hsl_element_83,  '') || ' ' || coalesce(hsl_element_84,  '') || ' ' ||
      coalesce(hsl_element_85,  '') || ' ' || coalesce(hsl_element_86,  '') || ' ' ||
      coalesce(hsl_element_87,  '') || ' ' || coalesce(hsl_element_88,  '') || ' ' ||
      coalesce(hsl_element_89,  '') || ' ' || coalesce(hsl_element_90,  '') || ' ' ||
      coalesce(hsl_element_91,  '') || ' ' || coalesce(hsl_element_92,  '') || ' ' ||
      coalesce(hsl_element_93,  '') || ' ' || coalesce(hsl_element_94,  '') || ' ' ||
      coalesce(hsl_element_95,  '') || ' ' || coalesce(hsl_element_96,  '') || ' ' ||
      coalesce(hsl_element_97,  '') || ' ' || coalesce(hsl_element_98,  '') || ' ' ||
      coalesce(hsl_element_99,  '') || ' ' || coalesce(hsl_element_100, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_hsl_data_elements_trgm
  ON hsl_data USING GIN (elements_text gin_trgm_ops);
