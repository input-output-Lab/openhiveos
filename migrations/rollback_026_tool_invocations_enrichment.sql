-- Rollback for 026_tool_invocations_enrichment.sql
-- WARNING: drops enriched analytics data. Backup before running.

BEGIN;

DROP INDEX IF EXISTS idx_tool_invocations_actor;
DROP INDEX IF EXISTS idx_tool_invocations_task_id;
DROP INDEX IF EXISTS idx_tool_invocations_session_id;

ALTER TABLE tool_invocations
  DROP CONSTRAINT IF EXISTS chk_tool_invocations_actor_type,
  DROP CONSTRAINT IF EXISTS chk_tool_invocations_client_surface,
  DROP COLUMN IF EXISTS response_bytes,
  DROP COLUMN IF EXISTS error_message,
  DROP COLUMN IF EXISTS args_hash,
  DROP COLUMN IF EXISTS arg_keys,
  DROP COLUMN IF EXISTS actor_type,
  DROP COLUMN IF EXISTS client_surface,
  DROP COLUMN IF EXISTS project_id,
  DROP COLUMN IF EXISTS task_id,
  DROP COLUMN IF EXISTS request_id,
  DROP COLUMN IF EXISTS session_id;

COMMIT;
