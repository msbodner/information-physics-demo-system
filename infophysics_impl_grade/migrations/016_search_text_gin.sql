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
-- Generated STORED columns update automatically on INSERT/UPDATE, so
-- application code does not need to maintain the search column.
--
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── aio_data: name + 50 element columns ─────────────────────────────
ALTER TABLE aio_data
  ADD COLUMN IF NOT EXISTS elements_text text
  GENERATED ALWAYS AS (
    lower(concat_ws(' ',
      aio_name,
      element_1,  element_2,  element_3,  element_4,  element_5,
      element_6,  element_7,  element_8,  element_9,  element_10,
      element_11, element_12, element_13, element_14, element_15,
      element_16, element_17, element_18, element_19, element_20,
      element_21, element_22, element_23, element_24, element_25,
      element_26, element_27, element_28, element_29, element_30,
      element_31, element_32, element_33, element_34, element_35,
      element_36, element_37, element_38, element_39, element_40,
      element_41, element_42, element_43, element_44, element_45,
      element_46, element_47, element_48, element_49, element_50
    ))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_aio_data_elements_trgm
  ON aio_data USING GIN (elements_text gin_trgm_ops);

-- ── hsl_data: name + 100 element columns ────────────────────────────
ALTER TABLE hsl_data
  ADD COLUMN IF NOT EXISTS elements_text text
  GENERATED ALWAYS AS (
    lower(concat_ws(' ',
      hsl_name,
      hsl_element_1,   hsl_element_2,   hsl_element_3,   hsl_element_4,   hsl_element_5,
      hsl_element_6,   hsl_element_7,   hsl_element_8,   hsl_element_9,   hsl_element_10,
      hsl_element_11,  hsl_element_12,  hsl_element_13,  hsl_element_14,  hsl_element_15,
      hsl_element_16,  hsl_element_17,  hsl_element_18,  hsl_element_19,  hsl_element_20,
      hsl_element_21,  hsl_element_22,  hsl_element_23,  hsl_element_24,  hsl_element_25,
      hsl_element_26,  hsl_element_27,  hsl_element_28,  hsl_element_29,  hsl_element_30,
      hsl_element_31,  hsl_element_32,  hsl_element_33,  hsl_element_34,  hsl_element_35,
      hsl_element_36,  hsl_element_37,  hsl_element_38,  hsl_element_39,  hsl_element_40,
      hsl_element_41,  hsl_element_42,  hsl_element_43,  hsl_element_44,  hsl_element_45,
      hsl_element_46,  hsl_element_47,  hsl_element_48,  hsl_element_49,  hsl_element_50,
      hsl_element_51,  hsl_element_52,  hsl_element_53,  hsl_element_54,  hsl_element_55,
      hsl_element_56,  hsl_element_57,  hsl_element_58,  hsl_element_59,  hsl_element_60,
      hsl_element_61,  hsl_element_62,  hsl_element_63,  hsl_element_64,  hsl_element_65,
      hsl_element_66,  hsl_element_67,  hsl_element_68,  hsl_element_69,  hsl_element_70,
      hsl_element_71,  hsl_element_72,  hsl_element_73,  hsl_element_74,  hsl_element_75,
      hsl_element_76,  hsl_element_77,  hsl_element_78,  hsl_element_79,  hsl_element_80,
      hsl_element_81,  hsl_element_82,  hsl_element_83,  hsl_element_84,  hsl_element_85,
      hsl_element_86,  hsl_element_87,  hsl_element_88,  hsl_element_89,  hsl_element_90,
      hsl_element_91,  hsl_element_92,  hsl_element_93,  hsl_element_94,  hsl_element_95,
      hsl_element_96,  hsl_element_97,  hsl_element_98,  hsl_element_99,  hsl_element_100
    ))
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_hsl_data_elements_trgm
  ON hsl_data USING GIN (elements_text gin_trgm_ops);
