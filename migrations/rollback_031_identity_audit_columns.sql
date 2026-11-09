-- Rollback for 031_identity_audit_columns.sql
-- WARNING: drops claimed_persona / auth_strength audit data on both surfaces.
-- Backup before running.
--
-- ORDER MATTERS: the trigger function body is restored to the 024 version
-- BEFORE dropping the columns. The 024 body inserts into task_status_history
-- WITHOUT the two columns — if columns were dropped first, every task UPDATE
-- in the window between the two statements would fail (trigger references
-- missing columns). Restoring first closes that window entirely.
--
-- The 024 function body references hive_current_actor() only; the two new
-- hive_* readers are dropped after the function restore for the same reason.

BEGIN;

-- 1. Restore the exact migration-024 trigger function body first.
CREATE OR REPLACE FUNCTION trg_tasks_after_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor TEXT := COALESCE(hive_current_actor(), 'system:sql');
BEGIN
  -- status transition → history (dedupe: skip same-status writes)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, actor, NOW());

    -- lifecycle timestamps on the row itself (single source for reports)
    IF NEW.status = 'wip' AND NEW.started_at IS NULL THEN
      NEW.started_at := NOW();
    END IF;
    IF NEW.status = 'done' THEN
      NEW.completed_at := NOW();
    END IF;
  END IF;

  -- mutation audit (only tracked columns that actually changed)
  INSERT INTO audit_log (table_name, row_id, action, actor, changes, changed_at)
  SELECT 'tasks', NEW.id, 'UPDATE', actor, hive_task_changes(OLD, NEW), NOW()
  WHERE hive_task_changes(OLD, NEW) <> '{}'::jsonb;

  RETURN NEW;
END;
$$;

-- 2. Drop the companion session-var readers.
DROP FUNCTION IF EXISTS hive_claimed_persona();
DROP FUNCTION IF EXISTS hive_auth_strength();

-- 3. Drop indexes then columns.
DROP INDEX IF EXISTS idx_tsh_auth_strength;
DROP INDEX IF EXISTS idx_tool_invocations_auth_strength;

ALTER TABLE task_status_history
  DROP CONSTRAINT IF EXISTS chk_task_status_history_auth_strength,
  DROP CONSTRAINT IF EXISTS chk_task_status_history_claimed_persona,
  DROP COLUMN IF EXISTS auth_strength,
  DROP COLUMN IF EXISTS claimed_persona;

ALTER TABLE tool_invocations
  DROP CONSTRAINT IF EXISTS chk_tool_invocations_auth_strength,
  DROP CONSTRAINT IF EXISTS chk_tool_invocations_claimed_persona,
  DROP COLUMN IF EXISTS auth_strength,
  DROP COLUMN IF EXISTS claimed_persona;

COMMIT;
