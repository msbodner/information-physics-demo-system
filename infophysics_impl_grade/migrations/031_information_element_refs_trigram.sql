-- 031_information_element_refs_trigram.sql
--
-- Add trigram support to the inverted index used by Recall and Live
-- Search. Without this, every cue-to-HSL probe is exact match
-- (`value_lower = ANY(...)`); a typo, declension, abbreviation, or
-- partial token in the query falls through to the AIO needle-scan
-- fallback and loses the HSL gating signal.
--
-- After this migration, find-by-needles-full accepts a `fuzzy=true`
-- flag that switches the WHERE clause to use the trigram similarity
-- operator (`%`). Default similarity threshold is 0.30 — tunable per
-- request via `set_limit()` in the same transaction.
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS, CREATE INDEX IF NOT
-- EXISTS. Re-running this migration is a no-op.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN index keyed by trigrams of value_lower. Used when the request
-- asks for fuzzy matching. Exact-match queries still use the
-- existing equality-on-value_lower path (which doesn't need this
-- index).
CREATE INDEX IF NOT EXISTS idx_ier_value_lower_trgm
  ON information_element_refs
  USING GIN (value_lower gin_trgm_ops);
