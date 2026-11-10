-- migrations/032_step_up_user.sql
-- S19-ARCH-01c (#2776): human step-up attribution per ARCH-028 Decision 5.
--
-- Adds the human-operator column to the gate-transition record. The pair
-- (changed_by = authenticated agent, auth_strength = 'session',
--  step_up_user = operator label) is the full attribution for a transition
-- that passed elicitation step-up:
--
--   changed_by      keeps the AGENT — it keys resolveActorRole and the P5
--                   audit contract (S17-BE-01). Never the human. This is a
--                   deliberate refinement of ARCH-026's "human recorded in
--                   changed_by" wording — see ARCH-028 Decision 5.
--   step_up_user    the operator label relayed by the gateway after the
--                   human approved the elicitation. NULL = no step-up
--                   occurred (normal agent-driven transitions stay NULL).
--
-- DELIBERATE SCOPE FENCE: no column on tool_invocations. The gateway cannot
-- see approval semantics (it relays, never parses) — the authoritative
-- step-up record is the history row only (ARCH-028 trade-off 5).
--
-- Also replaces the trigger function to persist the new hive.step_up_user
-- session var alongside the 031 columns (hive_claimed_persona /
-- hive_auth_strength readers are untouched — created by 031, OR REPLACE is
-- idempotent-safe if 031 and 032 land in one deploy).
--
-- Rollback: migrations/rollback_032_step_up_user.sql
-- Run with: psql "$DATABASE_URL" -f migrations/032_step_up_user.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Column + domain (additive, nullable — historical rows stay NULL)
-- ---------------------------------------------------------------------------

ALTER TABLE task_status_history
  ADD COLUMN step_up_user TEXT;

-- Same shape discipline as the persona claim: a label for audit readability,
-- 1..64 chars, no whitespace/control chars. Not an identity proof (ARCH-028
-- trade-off 4) — on a second-operator machine this column alone is NOT
-- sufficient attribution (OAuth trigger).
ALTER TABLE task_status_history
  ADD CONSTRAINT chk_task_status_history_step_up_user
    CHECK (step_up_user IS NULL OR (length(step_up_user) BETWEEN 1 AND 64
                                    AND step_up_user !~ '\s'));

-- Audit query pattern: "which closes did a human actually approve?"
CREATE INDEX idx_tsh_step_up_user
  ON task_status_history (step_up_user, changed_at)
  WHERE step_up_user IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Session-var reader (companion to 031's hive_claimed_persona /
--    hive_auth_strength)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hive_step_up_user() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hive.step_up_user', true), '');
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger function — 031 body + step_up_user persistence.
--    Signature identical → CREATE OR REPLACE swaps atomically under the
--    live trigger. Everything else byte-identical to 031's body.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION trg_tasks_after_update() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor TEXT := COALESCE(hive_current_actor(), 'system:sql');
  claim TEXT := hive_claimed_persona();
  strength TEXT := hive_auth_strength();
  stepup TEXT := hive_step_up_user();
BEGIN
  -- status transition → history (dedupe: skip same-status writes)
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_status_history
      (task_id, from_status, to_status, changed_by, claimed_persona, auth_strength, step_up_user, changed_at)
    VALUES (NEW.id, OLD.status, NEW.status, actor, claim, strength, stepup, NOW());

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

COMMIT;
