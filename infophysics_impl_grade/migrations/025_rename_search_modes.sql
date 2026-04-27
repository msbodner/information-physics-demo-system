-- 025_rename_search_modes.sql
-- Rename legacy search_mode discriminators in chat_search_stats to align
-- with the V4.4 user-facing labels:
--   'Send'    → 'BroadSearch'   (formerly "Blind Dump AIO/HSL")
--   'PureLLM' → 'RawSearch'     (formerly "CSV→LLM Raw")
--
-- The other two discriminators ('AIOSearch', 'Substrate') keep their
-- legacy codes; the UI maps them to "Live Search" / "Recall Search".
--
-- Idempotent: a re-run is a no-op because nothing matches the old codes
-- after the first run.

UPDATE chat_search_stats
   SET search_mode = 'BroadSearch'
 WHERE search_mode = 'Send';

UPDATE chat_search_stats
   SET search_mode = 'RawSearch'
 WHERE search_mode = 'PureLLM';
