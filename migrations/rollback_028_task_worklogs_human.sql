-- migrations/rollback_028_task_worklogs_human.sql
-- Rollback for 028_task_worklogs_human.sql (S17-BE-03 #2557)
-- Drops the human-entry columns and triggers. Auto rows (027) are untouched.
-- Human rows are deleted first: they cannot satisfy the 027 schema without
-- the category/actor_type columns, and they carry no auto-derivation data.

BEGIN;

DELETE FROM task_worklogs WHERE source = 'human';

DROP TRIGGER IF EXISTS trg_task_worklogs_audit ON task_worklogs;
DROP TRIGGER IF EXISTS trg_task_worklogs_touch ON task_worklogs;
DROP FUNCTION IF EXISTS trg_task_worklogs_audit();
DROP FUNCTION IF EXISTS trg_task_worklogs_touch();

DROP INDEX IF EXISTS idx_task_worklogs_actor_day;

ALTER TABLE task_worklogs
  DROP CONSTRAINT IF EXISTS chk_task_worklogs_manual_fields,
  DROP CONSTRAINT IF EXISTS chk_task_worklogs_note,
  DROP CONSTRAINT IF EXISTS chk_task_worklogs_category,
  DROP CONSTRAINT IF EXISTS chk_task_worklogs_actor_type;

ALTER TABLE task_worklogs
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS billable,
  DROP COLUMN IF EXISTS actor_type,
  DROP COLUMN IF EXISTS updated_at;

COMMIT;
