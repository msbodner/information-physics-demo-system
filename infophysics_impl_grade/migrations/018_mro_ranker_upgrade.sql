-- 018_mro_ranker_upgrade.sql
-- Two ranker inputs added to mro_objects:
--
--   1. `query_tsv tsvector` — generated from query_text. Lets the
--      Substrate / AIO Search prior ranker compute `ts_rank` against
--      the new query, so paraphrases ("show me revenue" vs "what was
--      income") are scored above zero even when their cue sets
--      share no exact tokens.
--
--   2. `trust_score numeric` — incremented every time a new MRO is
--      saved that used this MRO as a prior. Acts as a gradient-
--      reinforcement signal: priors that have been useful before
--      drift up the ranking; priors that never get reused stay flat.
--
-- Both are nullable / defaulted so existing rows light up immediately
-- after the migration runs. Idempotent.

ALTER TABLE mro_objects
  ADD COLUMN IF NOT EXISTS query_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(query_text, ''))) STORED;

ALTER TABLE mro_objects
  ADD COLUMN IF NOT EXISTS trust_score numeric NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_mro_objects_query_tsv
  ON mro_objects USING GIN (query_tsv);

CREATE INDEX IF NOT EXISTS idx_mro_objects_trust_score
  ON mro_objects (trust_score DESC);
