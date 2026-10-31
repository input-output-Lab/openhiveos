-- migrations/027_task_worklogs.sql
-- S17-BE-04 (#2552): task worklogs + per-session active-time derivation
--
-- What this migration adds:
--   1. task_worklogs — time worked on a task, from two sources:
--        source='auto'   nightly derivation from tool_invocations sessions
--                        (this migration + the worklog_derive cron)
--        source='human'  manual time entry (S17-BE-03 #2557, log_time MCP
--                        tool + REST endpoint — same table, different source)
--   2. idx_tool_invocations_session_called — (session_id, called_at) partial
--      composite. The derivation scan is "all invocations of one session in
--      called_at order"; 026 added session_id with only a bare partial index,
--      which forces a sort per session. Silas research (memory 3343).
--   3. v_session_active_time — the documented derivation view:
--      per (session_id, task_id, agent_slug, work day), active_minutes =
--      sum of consecutive-call gaps ≤ ACTIVE_GAP_THRESHOLD_MINUTES (15)
--      plus the final call's own duration_ms. Calls with actor_type=
--      'automation' are EXCLUDED from active_minutes but preserved in
--      automation_minutes (L10 policy: keep automation in logs, out of
--      effort). The threshold is a named constant documented here and
--      mirrored in src/utilities/worklog-derive.ts.
--
-- Design notes:
--   - minutes are NUMERIC(7,2) — fractional minutes from duration_ms sums.
--   - Idempotency for the nightly job: UNIQUE (task_id, agent_slug, source,
--     worked_on) for auto rows. One auto worklog per task/agent/day, keyed
--     by the UTC day of the session's first invocation. Human entries are
--     exempt (source='human' has no unique constraint — a human may log the
--     same day twice; that is their bookkeeping).
--   - worked_on is the UTC calendar day. Cross-midnight sessions attribute
--     to the day the session STARTED (simple, stable, documented).
--   - session_id is stored on auto rows for traceability back to
--     tool_invocations; human rows carry it NULL.
--
-- Rollback: migrations/rollback_027_task_worklogs.sql
-- Run with: psql "$DATABASE_URL" -f migrations/027_task_worklogs.sql
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. task_worklogs
-- ---------------------------------------------------------------------------

CREATE TABLE task_worklogs (
  id            BIGSERIAL PRIMARY KEY,
  task_id       BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  agent_slug    TEXT NOT NULL,
  source        TEXT NOT NULL,
  minutes       NUMERIC(7,2) NOT NULL CHECK (minutes > 0),
  worked_on     DATE NOT NULL,
  session_id    TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_task_worklogs_source CHECK (source IN ('auto', 'human')),
  -- auto rows are derivable: they must carry the session they came from.
  -- human rows are manual: session_id must be NULL.
  CONSTRAINT chk_task_worklogs_session CHECK (
    (source = 'auto' AND session_id IS NOT NULL)
    OR (source = 'human' AND session_id IS NULL)
  )
);

-- Idempotency (auto only): one derived row per task/agent/day.
-- PG has no partial UNIQUE *constraint* — the partial index IS the constraint.
CREATE UNIQUE INDEX uq_task_worklogs_auto
  ON task_worklogs (task_id, agent_slug, worked_on)
  WHERE source = 'auto';

CREATE INDEX idx_task_worklogs_task   ON task_worklogs (task_id);
CREATE INDEX idx_task_worklogs_day    ON task_worklogs (worked_on);
CREATE INDEX idx_task_worklogs_agent  ON task_worklogs (agent_slug, worked_on);

-- ---------------------------------------------------------------------------
-- 2. Session-scan index for the derivation query
-- ---------------------------------------------------------------------------

CREATE INDEX idx_tool_invocations_session_called
  ON tool_invocations (session_id, called_at)
  WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. v_session_active_time — the derivation, stated once, in SQL.
--
-- ACTIVE_GAP_THRESHOLD_MINUTES = 15 (L10 2026-10-29 item 15). Two consecutive
-- calls in a session are "continuous work" iff gap ≤ 15 min. Active time for
-- a bucket = Σ(gap where gap ≤ 15) + duration_ms of the last call in the
-- bucket. Gaps > 15 min are "away" and contribute nothing.
--
-- Bucketing: (session_id, task_id, agent_slug, date_trunc('day', first call))
-- so a session touching two tasks yields two worklogs; automation calls are
-- bucketed alongside for the excluded-minutes ledger but contribute 0.
--
-- agent_slug is part of the bucket: two agents in one session (rare — e.g.
-- bridge relay) are attributed individually, never merged.
-- ---------------------------------------------------------------------------

CREATE VIEW v_session_active_time AS
WITH ordered AS (
  SELECT
    session_id,
    task_id,
    agent_slug,
    actor_type,
    called_at,
    duration_ms,
    LAG(called_at) OVER w AS prev_called_at,
    DATE_TRUNC('day', MIN(called_at) OVER (PARTITION BY session_id, task_id, agent_slug)) AS worked_on
  FROM tool_invocations
  WHERE session_id IS NOT NULL
    AND task_id IS NOT NULL
  WINDOW w AS (PARTITION BY session_id, task_id, agent_slug ORDER BY called_at)
),
gapped AS (
  SELECT
    *,
    -- human-relevant gap: agent/unknown actor rows only
    CASE
      WHEN prev_called_at IS NULL THEN NULL
      ELSE EXTRACT(EPOCH FROM (called_at - prev_called_at)) / 60.0
    END AS gap_minutes
  FROM ordered
)
SELECT
  session_id,
  task_id,
  agent_slug,
  worked_on,
  -- active: non-automation rows; first row contributes its own duration
  COALESCE(SUM(
    CASE
      WHEN actor_type = 'automation' THEN 0
      WHEN gap_minutes IS NULL THEN COALESCE(duration_ms, 0) / 60000.0
      WHEN gap_minutes <= 15 THEN gap_minutes
      ELSE COALESCE(duration_ms, 0) / 60000.0   -- back from away: only own duration counts
    END
  ), 0)::numeric(10,2) AS active_minutes,
  -- ledger: automation minutes observed in the bucket (never effort)
  COALESCE(SUM(
    CASE
      WHEN actor_type = 'automation' AND (gap_minutes IS NULL OR gap_minutes <= 15)
        THEN COALESCE(gap_minutes, COALESCE(duration_ms, 0) / 60000.0)
      ELSE 0
    END
  ), 0)::numeric(10,2) AS automation_minutes,
  COUNT(*) FILTER (WHERE actor_type = 'automation')::int AS automation_calls,
  COUNT(*)::int AS total_calls
FROM gapped
GROUP BY session_id, task_id, agent_slug, worked_on;

COMMIT;
