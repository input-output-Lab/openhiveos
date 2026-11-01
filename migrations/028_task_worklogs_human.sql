-- migrations/028_task_worklogs_human.sql
-- S17-BE-03 (#2557): human/agent time entries on task_worklogs
--
-- Extends the 027 table (owned by #2552) with the L10 spec fields for manual
-- time entry. Auto rows (source='auto') are unaffected by these columns.
--
--   updated_at  — maintained by trigger; audit trail anchor
--   actor_type  — who logged the entry: 'agent' (log_time MCP tool) or
--                 'human' (REST entry). Required on source='human' rows.
--   billable    — billable flag, default TRUE
--   category    — hour-estimation category code (DA/UX/FE/BE/QA/DO/RI/PM).
--                 Required on source='human' rows; NULL on auto rows.
--   note        — free text, ≤500 chars
--
-- Audit: INSERT and UPDATE on task_worklogs write to audit_log, attributed
-- via hive_current_actor() (set by withActor in src/db/client.ts). Same
-- writer as the 024 task audit.
--
-- Rollback: migrations/rollback_028_task_worklogs_human.sql
-- Run with: psql "$DATABASE_URL" -f migrations/028_task_worklogs_human.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE task_worklogs
  ADD COLUMN updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN actor_type  TEXT,
  ADD COLUMN billable    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN category    TEXT,
  ADD COLUMN note        TEXT;

-- ---------------------------------------------------------------------------
-- 2. Constraints (fail closed at the DB, not just in the API)
-- ---------------------------------------------------------------------------

ALTER TABLE task_worklogs
  ADD CONSTRAINT chk_task_worklogs_actor_type CHECK (
    actor_type IS NULL OR actor_type IN ('agent', 'human')
  ),
  ADD CONSTRAINT chk_task_worklogs_category CHECK (
    category IS NULL OR category IN ('DA', 'UX', 'FE', 'BE', 'QA', 'DO', 'RI', 'PM')
  ),
  ADD CONSTRAINT chk_task_worklogs_note CHECK (
    note IS NULL OR char_length(note) <= 500
  ),
  -- auto rows carry no manual metadata; human rows must carry actor + category.
  ADD CONSTRAINT chk_task_worklogs_manual_fields CHECK (
    (source = 'auto' AND actor_type IS NULL AND category IS NULL)
    OR (source = 'human' AND actor_type IS NOT NULL AND category IS NOT NULL)
  );

CREATE INDEX idx_task_worklogs_actor_day ON task_worklogs (actor_type, worked_on);

-- ---------------------------------------------------------------------------
-- 3. updated_at maintenance
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_task_worklogs_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_worklogs_touch
  BEFORE UPDATE ON task_worklogs
  FOR EACH ROW
  EXECUTE FUNCTION trg_task_worklogs_touch();

-- ---------------------------------------------------------------------------
-- 4. Audit trail (same writer as 024 task audit)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_task_worklogs_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor TEXT := COALESCE(hive_current_actor(), 'system:sql');
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, row_id, action, actor, changes, changed_at)
    VALUES ('task_worklogs', NEW.id, 'INSERT', actor,
            jsonb_strip_nulls(to_jsonb(NEW) - 'metadata'), NOW());
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, row_id, action, actor, changes, changed_at)
    SELECT 'task_worklogs', NEW.id, 'UPDATE', actor,
           jsonb_strip_nulls(jsonb_build_object(
             'minutes',  CASE WHEN OLD.minutes  IS DISTINCT FROM NEW.minutes
                              THEN jsonb_build_object('from', OLD.minutes, 'to', NEW.minutes) END,
             'billable', CASE WHEN OLD.billable IS DISTINCT FROM NEW.billable
                              THEN jsonb_build_object('from', OLD.billable, 'to', NEW.billable) END,
             'category', CASE WHEN OLD.category IS DISTINCT FROM NEW.category
                              THEN jsonb_build_object('from', OLD.category, 'to', NEW.category) END,
             'note',     CASE WHEN OLD.note     IS DISTINCT FROM NEW.note
                              THEN jsonb_build_object('from', OLD.note, 'to', NEW.note) END,
             'worked_on',CASE WHEN OLD.worked_on IS DISTINCT FROM NEW.worked_on
                              THEN jsonb_build_object('from', OLD.worked_on, 'to', NEW.worked_on) END
           )), NOW()
    WHERE (OLD.minutes, OLD.billable, OLD.category, OLD.note, OLD.worked_on)
          IS DISTINCT FROM (NEW.minutes, NEW.billable, NEW.category, NEW.note, NEW.worked_on);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_task_worklogs_audit
  AFTER INSERT OR UPDATE ON task_worklogs
  FOR EACH ROW
  EXECUTE FUNCTION trg_task_worklogs_audit();

COMMIT;
