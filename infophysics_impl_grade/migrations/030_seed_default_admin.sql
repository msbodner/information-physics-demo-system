-- 030_seed_default_admin.sql
-- Seed the canonical default admin used for first-launch login on
-- fresh installations (notably the local DMG variant, which initdb's
-- a brand-new Postgres cluster on every Mac that mounts it).
--
-- Credentials (hard-coded by operator request):
--   Username: Michael Bodner
--   Email:    bodner.michael@gmail.com
--   Password: Admin&123
--   Role:     System Admin
--
-- The password_hash is a bcrypt of "Admin&123" with cost 12, generated
-- via Python's bcrypt module. Round-trip verified before commit.
--
-- ON CONFLICT (email) DO UPDATE — by operator request the seed is
-- authoritative for this email. Every backend startup / DMG migration
-- run forces the password back to "Admin&123" and role back to
-- "System Admin". A password rotation via System Admin → Users will
-- therefore not survive a restart; that's the intended trade-off.

INSERT INTO users (username, email, password_hash, role)
VALUES (
  'Michael Bodner',
  'bodner.michael@gmail.com',
  '$2b$12$BBKWNz6mqlfh0p4J6zzPqeFqEMtPT9cZmTUqSUWDQJSQL6nji86vi',
  'System Admin'
)
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      role          = EXCLUDED.role,
      username      = COALESCE(NULLIF(users.username, ''), EXCLUDED.username);
