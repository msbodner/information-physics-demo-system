-- 008_new_tables.sql
-- Adds: roles table, last_login to users, aio_data table, hsl_data table

-- ── Roles table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS roles (
  role_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name  text        UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO roles (role_name) VALUES ('System Admin') ON CONFLICT DO NOTHING;
INSERT INTO roles (role_name) VALUES ('General User') ON CONFLICT DO NOTHING;

-- ── Add last_login to users ────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- ── AIO Data table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aio_data (
  aio_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aio_name   text NOT NULL,
  element_1  text, element_2  text, element_3  text, element_4  text, element_5  text,
  element_6  text, element_7  text, element_8  text, element_9  text, element_10 text,
  element_11 text, element_12 text, element_13 text, element_14 text, element_15 text,
  element_16 text, element_17 text, element_18 text, element_19 text, element_20 text,
  element_21 text, element_22 text, element_23 text, element_24 text, element_25 text,
  element_26 text, element_27 text, element_28 text, element_29 text, element_30 text,
  element_31 text, element_32 text, element_33 text, element_34 text, element_35 text,
  element_36 text, element_37 text, element_38 text, element_39 text, element_40 text,
  element_41 text, element_42 text, element_43 text, element_44 text, element_45 text,
  element_46 text, element_47 text, element_48 text, element_49 text, element_50 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── HSL Data table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hsl_data (
  hsl_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hsl_name      text NOT NULL,
  hsl_element_1   text, hsl_element_2   text, hsl_element_3   text, hsl_element_4   text, hsl_element_5   text,
  hsl_element_6   text, hsl_element_7   text, hsl_element_8   text, hsl_element_9   text, hsl_element_10  text,
  hsl_element_11  text, hsl_element_12  text, hsl_element_13  text, hsl_element_14  text, hsl_element_15  text,
  hsl_element_16  text, hsl_element_17  text, hsl_element_18  text, hsl_element_19  text, hsl_element_20  text,
  hsl_element_21  text, hsl_element_22  text, hsl_element_23  text, hsl_element_24  text, hsl_element_25  text,
  hsl_element_26  text, hsl_element_27  text, hsl_element_28  text, hsl_element_29  text, hsl_element_30  text,
  hsl_element_31  text, hsl_element_32  text, hsl_element_33  text, hsl_element_34  text, hsl_element_35  text,
  hsl_element_36  text, hsl_element_37  text, hsl_element_38  text, hsl_element_39  text, hsl_element_40  text,
  hsl_element_41  text, hsl_element_42  text, hsl_element_43  text, hsl_element_44  text, hsl_element_45  text,
  hsl_element_46  text, hsl_element_47  text, hsl_element_48  text, hsl_element_49  text, hsl_element_50  text,
  hsl_element_51  text, hsl_element_52  text, hsl_element_53  text, hsl_element_54  text, hsl_element_55  text,
  hsl_element_56  text, hsl_element_57  text, hsl_element_58  text, hsl_element_59  text, hsl_element_60  text,
  hsl_element_61  text, hsl_element_62  text, hsl_element_63  text, hsl_element_64  text, hsl_element_65  text,
  hsl_element_66  text, hsl_element_67  text, hsl_element_68  text, hsl_element_69  text, hsl_element_70  text,
  hsl_element_71  text, hsl_element_72  text, hsl_element_73  text, hsl_element_74  text, hsl_element_75  text,
  hsl_element_76  text, hsl_element_77  text, hsl_element_78  text, hsl_element_79  text, hsl_element_80  text,
  hsl_element_81  text, hsl_element_82  text, hsl_element_83  text, hsl_element_84  text, hsl_element_85  text,
  hsl_element_86  text, hsl_element_87  text, hsl_element_88  text, hsl_element_89  text, hsl_element_90  text,
  hsl_element_91  text, hsl_element_92  text, hsl_element_93  text, hsl_element_94  text, hsl_element_95  text,
  hsl_element_96  text, hsl_element_97  text, hsl_element_98  text, hsl_element_99  text, hsl_element_100 text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
