-- Rollback for 022_usage_enrichment.sql
-- Additive migration — rollback drops the new columns/tables/view.
-- WARNING: drops enriched data (model_id resolution, cost_source, requested_at…).
-- The existing 3 views and UNIQUE(session_id, loop_index) are unaffected.

BEGIN;

DROP VIEW IF EXISTS v_usage_enriched;
DROP INDEX IF EXISTS idx_llm_usage_project_recorded;
DROP INDEX IF EXISTS idx_llm_usage_model_recorded;

ALTER TABLE llm_usage
  DROP COLUMN IF EXISTS model_id,
  DROP COLUMN IF EXISTS cost_source,
  DROP COLUMN IF EXISTS prompt_token_details,
  DROP COLUMN IF EXISTS reasoning_tokens,
  DROP COLUMN IF EXISTS request_id,
  DROP COLUMN IF EXISTS requested_at,
  DROP COLUMN IF EXISTS client_surface,
  DROP COLUMN IF EXISTS project_id;

DROP TABLE IF EXISTS llm_model_aliases;
DROP TABLE IF EXISTS llm_models;

COMMIT;
