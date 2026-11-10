-- Rollback for 032_step_up_user.sql
-- WARNING: drops the step_up_user audit column (human step-up attribution
-- on gate transitions). Backup before running.
--
-- ORDER MATTERS (same rule as 031's rollback): restore the 031 trigger body
-- BEFORE dropping the column, so no UPDATE window exists where the live
-- trigger references a missing column.

BEGIN;

-- 1. Restore the migration-031 trigger function body (no step_up_user).
CREATE OR REPLACE FUNCTION trg_tasks_after_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor TEXT := COALESCE(hive_current_actor(), 'system:sql');
  claim TEXT := hive_claimed_persona();
  strength TEXT := hive_auth_strength();
BEGIN
  -- status transition → history (dedupe: skip same-status writes)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, claimed_persona, auth_strength, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, actor, claim, strength, NOW());

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

-- 2. Drop the companion session-var reader.
DROP FUNCTION IF EXISTS hive_step_up_user();

-- 3. Drop index, constraint, column.
DROP INDEX IF EXISTS idx_tsh_step_up_user;

ALTER TABLE task_status_history
  DROP CONSTRAINT IF EXISTS chk_task_status_history_step_up_user,
  DROP COLUMN IF EXISTS step_up_user;

COMMIT;
