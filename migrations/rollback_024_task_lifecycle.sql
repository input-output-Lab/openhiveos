-- Rollback for 024_task_lifecycle.sql
-- WARNING: destroys task_status_history and audit_log data (irrecoverable).
-- Take a backup before running. Lifecycle columns are dropped with it.

BEGIN;

DROP TRIGGER IF EXISTS trg_projects_lifecycle ON projects;
DROP FUNCTION IF EXISTS trg_projects_after_update();
DROP FUNCTION IF EXISTS hive_project_changes(projects, projects);

DROP TRIGGER IF EXISTS trg_tasks_lifecycle ON tasks;
DROP FUNCTION IF EXISTS trg_tasks_after_update();
DROP FUNCTION IF EXISTS hive_task_changes(tasks, tasks);
DROP FUNCTION IF EXISTS hive_current_actor();

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS task_status_history;

DROP INDEX IF EXISTS idx_tasks_status_age;
DROP INDEX IF EXISTS idx_tasks_resolution;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_reviewer_agent_slug_fkey,
  DROP CONSTRAINT IF EXISTS chk_tasks_resolution,
  DROP COLUMN IF EXISTS reviewer_agent_slug,
  DROP COLUMN IF EXISTS resolution,
  DROP COLUMN IF EXISTS completed_at,
  DROP COLUMN IF EXISTS started_at;

COMMIT;
