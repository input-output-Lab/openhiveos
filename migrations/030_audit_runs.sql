-- 030_audit_runs.sql
--
-- S18-QA-01 (#2567): hive invariant audit runs.
--
-- Each audit_hive execution persists one row: overall score, the list of
-- invariants executed, and the full findings payload (jsonb — same shape
-- the MCP tool returns). Read-only invariants; this table is their only
-- write surface (fire-and-forget insert, audit history for trend analysis).
--
-- Rollback: migrations/rollback_030_audit_runs.sql
-- Run with: psql "$DATABASE_URL" -f migrations/030_audit_runs.sql

BEGIN;

CREATE TABLE IF NOT EXISTS audit_runs (
  id              BIGSERIAL PRIMARY KEY,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms     INTEGER,
  score           NUMERIC(5,2) NOT NULL,        -- 0-100, % of invariants passing (severity-weighted)
  invariants_run  INTEGER NOT NULL,
  findings        JSONB NOT NULL,               -- full InvariantResult[] payload
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_started_at
  ON audit_runs (started_at DESC);

COMMIT;
