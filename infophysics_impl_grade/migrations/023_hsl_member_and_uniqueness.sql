-- 023_hsl_member_and_uniqueness.sql
--
-- Two structural upgrades to the HSL substrate:
--
--   1. UNIQUE INDEX hsl_data(tenant_id, hsl_name)
--        Makes concurrent rebuilds structurally safe and lets the bulk
--        rebuild loop replace its existence-check round-trips with a
--        single batched INSERT … ON CONFLICT DO NOTHING.
--
--   2. New side table hsl_member(hsl_id, member_value, member_kind, …)
--        Lifts the 100-element width cap on hsl_data. Members are stored
--        relationally — no graph, no index — keyed on (hsl_id, member_value).
--        hsl_data.hsl_element_1..100 is kept dual-written for backward
--        compatibility with the elements_text generated column (migration
--        016) and the legacy fallback paths in chat.py.
--
-- Idempotent: safe to re-run.

-- ── 0. Tenant scope for backfill ─────────────────────────────────────
-- FORCE RLS on hsl_data (migration 015) means even the owning role obeys
-- the tenant_id policy. Migrations connect without an app.tenant_id, so
-- we set it to the only real-world tenant before the backfill so the
-- INSERT … SELECT can see the existing rows.
SELECT set_config('app.tenant_id', 'tenantA', false);


-- ── 1. Dedupe hsl_data on (tenant_id, hsl_name) before unique index ──
-- Bulk-rebuild prior to this migration could leave duplicates if two
-- concurrent runs raced. Keep the oldest hsl_id per (tenant, name);
-- hsl_member rows for the discarded ids are unreachable and harmless.
DELETE FROM hsl_data h
USING hsl_data h2
WHERE h.tenant_id = h2.tenant_id
  AND h.hsl_name  = h2.hsl_name
  AND h.created_at > h2.created_at;


-- ── 2. UNIQUE INDEX (tenant_id, hsl_name) ────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS hsl_data_tenant_name_uidx
  ON hsl_data(tenant_id, hsl_name);


-- ── 3. hsl_member side table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hsl_member (
  hsl_id        uuid        NOT NULL REFERENCES hsl_data(hsl_id) ON DELETE CASCADE,
  member_value  text        NOT NULL,
  member_kind   text        NOT NULL DEFAULT 'aio'
                CHECK (member_kind IN ('aio', 'mro')),
  tenant_id     text        NOT NULL DEFAULT 'tenantA',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hsl_id, member_value)
);

CREATE INDEX IF NOT EXISTS hsl_member_tenant_idx ON hsl_member(tenant_id);
CREATE INDEX IF NOT EXISTS hsl_member_hsl_idx    ON hsl_member(hsl_id);
CREATE INDEX IF NOT EXISTS hsl_member_value_idx  ON hsl_member(member_value);


-- ── 4. Backfill from hsl_element_1..100 ──────────────────────────────
-- Unnest the 100 element columns into one (hsl_id, value) row each.
-- MRO refs ([MRO.<id>]) are tagged kind='mro'; everything else 'aio'.
INSERT INTO hsl_member (hsl_id, member_value, member_kind, tenant_id, created_at)
SELECT
  h.hsl_id,
  v.member_value,
  CASE
    WHEN v.member_value LIKE '[MRO.%]' THEN 'mro'
    ELSE 'aio'
  END                                                  AS member_kind,
  h.tenant_id,
  h.created_at
FROM hsl_data h
CROSS JOIN LATERAL (
  VALUES
    (h.hsl_element_1),  (h.hsl_element_2),  (h.hsl_element_3),  (h.hsl_element_4),  (h.hsl_element_5),
    (h.hsl_element_6),  (h.hsl_element_7),  (h.hsl_element_8),  (h.hsl_element_9),  (h.hsl_element_10),
    (h.hsl_element_11), (h.hsl_element_12), (h.hsl_element_13), (h.hsl_element_14), (h.hsl_element_15),
    (h.hsl_element_16), (h.hsl_element_17), (h.hsl_element_18), (h.hsl_element_19), (h.hsl_element_20),
    (h.hsl_element_21), (h.hsl_element_22), (h.hsl_element_23), (h.hsl_element_24), (h.hsl_element_25),
    (h.hsl_element_26), (h.hsl_element_27), (h.hsl_element_28), (h.hsl_element_29), (h.hsl_element_30),
    (h.hsl_element_31), (h.hsl_element_32), (h.hsl_element_33), (h.hsl_element_34), (h.hsl_element_35),
    (h.hsl_element_36), (h.hsl_element_37), (h.hsl_element_38), (h.hsl_element_39), (h.hsl_element_40),
    (h.hsl_element_41), (h.hsl_element_42), (h.hsl_element_43), (h.hsl_element_44), (h.hsl_element_45),
    (h.hsl_element_46), (h.hsl_element_47), (h.hsl_element_48), (h.hsl_element_49), (h.hsl_element_50),
    (h.hsl_element_51), (h.hsl_element_52), (h.hsl_element_53), (h.hsl_element_54), (h.hsl_element_55),
    (h.hsl_element_56), (h.hsl_element_57), (h.hsl_element_58), (h.hsl_element_59), (h.hsl_element_60),
    (h.hsl_element_61), (h.hsl_element_62), (h.hsl_element_63), (h.hsl_element_64), (h.hsl_element_65),
    (h.hsl_element_66), (h.hsl_element_67), (h.hsl_element_68), (h.hsl_element_69), (h.hsl_element_70),
    (h.hsl_element_71), (h.hsl_element_72), (h.hsl_element_73), (h.hsl_element_74), (h.hsl_element_75),
    (h.hsl_element_76), (h.hsl_element_77), (h.hsl_element_78), (h.hsl_element_79), (h.hsl_element_80),
    (h.hsl_element_81), (h.hsl_element_82), (h.hsl_element_83), (h.hsl_element_84), (h.hsl_element_85),
    (h.hsl_element_86), (h.hsl_element_87), (h.hsl_element_88), (h.hsl_element_89), (h.hsl_element_90),
    (h.hsl_element_91), (h.hsl_element_92), (h.hsl_element_93), (h.hsl_element_94), (h.hsl_element_95),
    (h.hsl_element_96), (h.hsl_element_97), (h.hsl_element_98), (h.hsl_element_99), (h.hsl_element_100)
) AS v(member_value)
WHERE v.member_value IS NOT NULL
  AND length(trim(v.member_value)) > 0
ON CONFLICT (hsl_id, member_value) DO NOTHING;


-- ── 5. RLS on hsl_member (mirrors policy on hsl_data) ────────────────
ALTER TABLE hsl_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE hsl_member FORCE  ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY p_hsl_member_tenant_isolation ON hsl_member
    USING      (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
