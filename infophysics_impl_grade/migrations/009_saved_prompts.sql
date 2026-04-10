-- 009_saved_prompts.sql
-- Adds: saved_prompts table for persistent ChatAIO prompt storage

CREATE TABLE IF NOT EXISTS saved_prompts (
  prompt_id   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_text text        NOT NULL,
  label       text,
  category    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
