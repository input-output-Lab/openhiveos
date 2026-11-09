-- migrations/031_identity_audit_columns.sql
-- S19-ARCH-01a (#2774): identity audit columns per ARCH-026 Decision 1.
--
-- Adds the claimed-persona audit surface to the two write paths the gateway
-- feeds:
--   tool_invocations     — every MCP tool call observed by the gateway.
--   task_status_history  — the gate-transition record (migration 024's
--                          trigger is its single audit writer).
--
-- COLUMNS
--   claimed_persona  TEXT NULL — the LLM-supplied persona label lifted by
--     the gateway from the optional `persona` tool argument (ARCH-026).
--     NULL = no claim was made. CONSUMER RULE (ARCH-026 consequence 4):
--     never read this as a verified identity. It is spoofable by design —
--     a prompt-injected agent can claim any persona. It is a label for
--     humans reading the audit trail, not a control.
--
--   auth_strength    TEXT NULL — the authentication path that produced the
--     row's actor attribution, stamped by the gateway (never by clients):
--       'bearer'       — per-agent bearer token verified (DB hash lookup)
--       'shared_token' — legacy /sse MCP_GATEWAY_TOKEN (Bridge)
--       'dev'          — MCP_GATEWAY_AUTH_DISABLED path (non-privileged
--                        dev-actor only; S17-BE-06 guard applies)
--       'session'      — RESERVED for 01c elicitation human step-up
--                        (do not emit until 01c ships)
--       'unverified'   — self-reported rows / unknown provenance
--     NULL = row predates this migration (see Backfill honesty below).
--
-- DEFERRED TO 01c CO-DESIGN (scope fence): the `user` column from the
-- ARCH-026 files table (the human recorded at step-up) is intentionally
-- NOT added here — its shape depends on the 01c step-up interaction
-- design. These two columns record step-up events; 01a records claims.
--
-- RECORDER WIRING (this migration is inert without it, shipped together):
--   - Gateway stamps auth_strength at auth resolution and lifts the
--     persona claim from tool arguments into _meta (packages/mcp-gateway).
--   - withActor() accepts an auth context and SET LOCALs it; the 024
--     trigger (replaced below) reads it via the new hive_* readers and
--     writes the columns on every status transition.
--
-- Backfill honesty: historical rows stay NULL. The 2026-07-10 → 10-28
-- attribution gap is unfixable (ARCH-026 trade-off 4) — this record is
-- trustworthy going forward, not retroactively.
--
-- Trigger function: this migration CREATE OR REPLACEs
-- trg_tasks_after_update (from 024). No later migration touched it
-- (verified 2026-11-09). The rollback restores the 024 body BEFORE
-- dropping the columns — order matters, or the trigger breaks.
--
-- Rollback: migrations/rollback_031_identity_audit_columns.sql
-- Run with: psql "$DATABASE_URL" -f migrations/031_identity_audit_columns.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Columns — additive and nullable (026 pattern: historical rows stay valid)
-- ---------------------------------------------------------------------------

ALTER TABLE tool_invocations
  ADD COLUMN claimed_persona TEXT,
  ADD COLUMN auth_strength   TEXT;

ALTER TABLE task_status_history
  ADD COLUMN claimed_persona TEXT,
  ADD COLUMN auth_strength   TEXT;

-- Single shared domain check per table (same value domain everywhere a
-- consumer might UNION the surfaces for an audit query).
ALTER TABLE tool_invocations
  ADD CONSTRAINT chk_tool_invocations_auth_strength
    CHECK (auth_strength IS NULL OR auth_strength IN
      ('bearer', 'shared_token', 'dev', 'session', 'unverified')),
  ADD CONSTRAINT chk_tool_invocations_claimed_persona
    CHECK (claimed_persona IS NULL OR claimed_persona ~ '^[a-z][a-z0-9_-]{0,63}$');

ALTER TABLE task_status_history
  ADD CONSTRAINT chk_task_status_history_auth_strength
    CHECK (auth_strength IS NULL OR auth_strength IN
      ('bearer', 'shared_token', 'dev', 'session', 'unverified')),
  ADD CONSTRAINT chk_task_status_history_claimed_persona
    CHECK (claimed_persona IS NULL OR claimed_persona ~ '^[a-z][a-z0-9_-]{0,63}$');

-- Audit query pattern: "which calls/transitions carried weak auth?"
-- Partial — most rows will be 'bearer' eventually; keep the index tight.
CREATE INDEX idx_tool_invocations_auth_strength
  ON tool_invocations (auth_strength, called_at DESC)
  WHERE auth_strength IS NOT NULL;

CREATE INDEX idx_tsh_auth_strength
  ON task_status_history (auth_strength, changed_at)
  WHERE auth_strength IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Session-var readers (companion to 024's hive_current_actor)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION hive_claimed_persona() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hive.claimed_persona', true), '');
$$;

CREATE OR REPLACE FUNCTION hive_auth_strength() RETURNS TEXT
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('hive.auth_strength', true), '');
$$;

-- ---------------------------------------------------------------------------
-- 3. Trigger function — 024 body extended with the two audit columns.
--    Everything else is byte-identical in intent to 024: same dedupe,
--    same lifecycle timestamps, same audit_log write. The trigger
--    definition itself (DROP/CREATE TRIGGER) is unchanged — signature is
--    identical, so OR REPLACE swaps the body atomically under the live
--    trigger (no audit window).
-- ---------------------------------------------------------------------------

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

COMMIT;
