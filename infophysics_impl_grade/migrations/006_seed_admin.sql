-- 006_seed_admin.sql
-- Ensure the default System Admin user exists.
-- Uses ON CONFLICT DO NOTHING so it is fully idempotent and safe to re-run.

INSERT INTO users (username, email, password_hash, role)
VALUES (
  'Michael Bodner',
  'bodner.michael@gmail.com',
  '$2b$12$Lqv8i3UH.YJg5R3ybR9uDORYoQrucq9/4/PJKKjMqfKy/9Lamg8F6',
  'System Admin'
)
ON CONFLICT (email) DO NOTHING;
