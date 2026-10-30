-- migrations/024_task_lifecycle.sql
-- S16-DB-01 (#2547): task lifecycle history + audit log + lifecycle columns
--
-- Schema design: Silas (design owner per L10 2026-10-29; task metadata).
-- Consumed by: aging/escalation cron (#2551), flow metrics (#2565),
-- cleanup of 100 stuck tasks (#2549), audit_hive (#2567).
--
-- What this migration adds:
--   1. tasks lifecycle columns: started_at, completed_at, resolution,
--      reviewer_agent_slug (decision D5/D6: Elizabeth approves done,
--      Nova approves Elizabeth's tasks; reviewer defaults by domain).
--   2. task_status_history: append-only, one row per status transition.
--   3. audit_log: append-only mutation log (before/after JSONB) for
--      tasks, projects, seals — the hive-level audit surface (#2567).
--   4. One AFTER UPDATE trigger per table feeding both.
--   5. Backfill: history + timestamps derived from existing rows
--      (updated_at is the only truth we have pre-history; documented limit).
--
-- Backfill honesty: rows created before this migration get ONE history entry
-- each (their current status at created_at) and started_at/completed_at
-- derived from created_at/updated_at. True per-transition times did not exist
-- before this migration; better a coarse history than none.
--
-- Rollback: migrations/rollback_024_task_lifecycle.sql
-- Run with: psql "$DATABASE_URL" -f migrations/024_task_lifecycle.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Lifecycle columns on tasks
-- ---------------------------------------------------------------------------

ALTER TABLE tasks
  ADD COLUMN started_at           TIMESTAMPTZ,   -- first wip transition (backfill: created_at for non-todo rows)
  ADD COLUMN completed_at         TIMESTAMPTZ,   -- done transition (backfill: updated_at for done rows)
  ADD COLUMN resolution           TEXT,          -- HOW closed: completed|wont_do|duplicate|obsolete|auto_closed (NULL = not closed)
  ADD COLUMN reviewer_agent_slug  TEXT,          -- who gates review → pending-close (default by domain, D6)

  ADD CONSTRAINT chk_tasks_resolution CHECK (resolution IS NULL OR resolution IN
    ('completed', 'wont_do', 'duplicate', 'obsolete', 'auto_closed'));

-- reviewer is an agent (same reference semantics as assignee)
ALTER TABLE tasks
  ADD CONSTRAINT tasks_reviewer_agent_slug_fkey
  FOREIGN KEY (reviewer_agent_slug) REFERENCES agents(slug) ON DELETE SET NULL;

CREATE INDEX idx_tasks_resolution        ON tasks (resolution)        WHERE resolution IS NOT NULL;
CREATE INDEX idx_tasks_status_age        ON tasks (status, updated_at) WHERE status IN ('review', 'pending-close');

-- ---------------------------------------------------------------------------
-- 2. task_status_history — append-only
-- ---------------------------------------------------------------------------

CREATE TABLE task_status_history (
  id           BIGSERIAL PRIMARY KEY,
  task_id      BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  from_status  TEXT,                                  -- NULL = creation entry
  to_status    TEXT NOT NULL,
  changed_by   TEXT,                                  -- agent slug or 'system:<actor>' e.g. 'system:auto_close'
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tsh_task     ON task_status_history (task_id, changed_at);
CREATE INDEX idx_tsh_status   ON task_status_history (to_status, changed_at);

-- ---------------------------------------------------------------------------
-- 3. audit_log — append-only mutation surface for #2567 (audit_hive)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  table_name    TEXT NOT NULL,
  row_id        BIGINT NOT NULL,
  action        TEXT NOT NULL,                        -- UPDATE (INSERT/DELETE added later if needed)
  actor         TEXT,                                 -- agent slug or 'system:<actor>'
  changes       JSONB NOT NULL,                       -- {col: {from, to}} for tracked columns only
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_table_row ON audit_log (table_name, row_id, changed_at);
CREATE INDEX idx_audit_changed   ON audit_log (changed_at);

-- ---------------------------------------------------------------------------
-- 4. Triggers — one function per table, one audit writer, session actor var
--
-- Actor: the API sets `SET LOCAL hive.actor = '<slug>'` per transaction
-- (added in update-task.ts); direct SQL/psql migrations get NULL → logged
-- as 'system:sql'. Cron/system transitions set 'system:auto_close' etc.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hive_current_actor() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hive.actor', true), '');
$$;

-- Shared: build the changes JSONB for tracked columns (skip NULL→NULL noise)
CREATE OR REPLACE FUNCTION hive_task_changes(old_row tasks, new_row tasks)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'status',              CASE WHEN old_row.status  IS DISTINCT FROM new_row.status
                                THEN jsonb_build_object('from', old_row.status, 'to', new_row.status) END,
    'assignee_agent_slug', CASE WHEN old_row.assignee_agent_slug IS DISTINCT FROM new_row.assignee_agent_slug
                                THEN jsonb_build_object('from', old_row.assignee_agent_slug, 'to', new_row.assignee_agent_slug) END,
    'title',               CASE WHEN old_row.title IS DISTINCT FROM new_row.title
                                THEN jsonb_build_object('from', old_row.title, 'to', new_row.title) END,
    'resolution',          CASE WHEN old_row.resolution IS DISTINCT FROM new_row.resolution
                                THEN jsonb_build_object('from', old_row.resolution, 'to', new_row.resolution) END,
    'reviewer_agent_slug', CASE WHEN old_row.reviewer_agent_slug IS DISTINCT FROM new_row.reviewer_agent_slug
                                THEN jsonb_build_object('from', old_row.reviewer_agent_slug, 'to', new_row.reviewer_agent_slug) END,
    'github_pr_url',       CASE WHEN old_row.github_pr_url IS DISTINCT FROM new_row.github_pr_url
                                THEN jsonb_build_object('from', old_row.github_pr_url, 'to', new_row.github_pr_url) END
  ));
$$;

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

DROP TRIGGER IF EXISTS trg_tasks_lifecycle ON tasks;
CREATE TRIGGER trg_tasks_lifecycle
  AFTER UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION trg_tasks_after_update();

-- projects audit (owner/status changes matter to the hive)
CREATE OR REPLACE FUNCTION hive_project_changes(old_row projects, new_row projects)
RETURNS JSONB LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'status',           CASE WHEN old_row.status IS DISTINCT FROM new_row.status
                             THEN jsonb_build_object('from', old_row.status, 'to', new_row.status) END,
    'owner_agent_slug', CASE WHEN old_row.owner_agent_slug IS DISTINCT FROM new_row.owner_agent_slug
                             THEN jsonb_build_object('from', old_row.owner_agent_slug, 'to', new_row.owner_agent_slug) END
  ));
$$;

CREATE OR REPLACE FUNCTION trg_projects_after_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor TEXT := COALESCE(hive_current_actor(), 'system:sql');
BEGIN
  INSERT INTO audit_log (table_name, row_id, action, actor, changes, changed_at)
  SELECT 'projects', NEW.id, 'UPDATE', actor, hive_project_changes(OLD, NEW), NOW()
  WHERE hive_project_changes(OLD, NEW) <> '{}'::jsonb;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_lifecycle ON projects;
CREATE TRIGGER trg_projects_lifecycle
  AFTER UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION trg_projects_after_update();

-- ---------------------------------------------------------------------------
-- 5. Backfill — coarse but honest (see header note)
-- ---------------------------------------------------------------------------

-- history: one creation entry per task at its created_at, current status
INSERT INTO task_status_history (task_id, from_status, to_status, changed_by, changed_at)
SELECT id, NULL, status, 'system:backfill', created_at
FROM tasks
WHERE NOT EXISTS (SELECT 1 FROM task_status_history h WHERE h.task_id = tasks.id);

-- timestamps: non-todo work "started" somewhere between creation and now —
-- created_at is the conservative floor; done tasks completed at updated_at
UPDATE tasks
SET    started_at = created_at
WHERE  started_at IS NULL AND status NOT IN ('todo', 'triage');

UPDATE tasks
SET    completed_at = updated_at
WHERE  completed_at IS NULL AND status = 'done';

COMMIT;
