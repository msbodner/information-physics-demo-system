-- 030_seed_default_admin.sql
-- Seed the canonical default admin used for first-launch login on
-- fresh installations (notably the local DMG variant, which initdb's
-- a brand-new Postgres cluster on every Mac that mounts it).
--
-- Credentials:
--   Username: Admin
--   Email:    michael@informationphysics.ai
--   Password: Admin&123
--   Role:     System Admin
--
-- The password_hash is a bcrypt of "Admin&123" with cost 12, generated
-- via Python's bcrypt module. Round-trip verified before commit.
--
-- Idempotent: ON CONFLICT (email) DO NOTHING. Safe to re-run.
-- Operators are expected to change the password on first login —
-- shipping a known credential is acceptable for a single-tenant demo
-- DMG but should never be used as-is in a multi-user deployment.

INSERT INTO users (username, email, password_hash, role)
VALUES (
  'Admin',
  'michael@informationphysics.ai',
  '$2b$12$BBKWNz6mqlfh0p4J6zzPqeFqEMtPT9cZmTUqSUWDQJSQL6nji86vi',
  'System Admin'
)
ON CONFLICT (email) DO NOTHING;
