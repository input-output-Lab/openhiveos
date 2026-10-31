-- migrations/rollback_027_task_worklogs.sql
-- Rollback for 027_task_worklogs.sql (S17-BE-04 #2552)

BEGIN;

DROP VIEW IF EXISTS v_session_active_time;
DROP INDEX IF EXISTS idx_tool_invocations_session_called;
DROP TABLE IF EXISTS task_worklogs;

COMMIT;
