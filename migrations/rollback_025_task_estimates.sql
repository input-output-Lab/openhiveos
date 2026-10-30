-- Rollback for 025_task_estimates.sql
-- WARNING: drops versioned estimate history (irrecoverable). Backup first.

BEGIN;

DROP TABLE IF EXISTS task_estimates;

DROP INDEX IF EXISTS idx_tasks_estimated_hours;

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_tasks_estimates_confidence,
  DROP CONSTRAINT IF EXISTS chk_tasks_estimates_bounds,
  DROP COLUMN IF EXISTS estimate_confidence,
  DROP COLUMN IF EXISTS billing_high,
  DROP COLUMN IF EXISTS billing_low,
  DROP COLUMN IF EXISTS estimated_hours;

COMMIT;
