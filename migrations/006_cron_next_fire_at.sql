-- migrations/006_cron_next_fire_at.sql
-- OpenHiveOS — Cron Worker execution schema: next_fire_at
--
-- Adds next_fire_at TIMESTAMPTZ to the crons table.
--
-- Architecture decision: ARCH-011 G1 (Silas ruling 2026-05-21)
--   Option A — persisted next_fire_at column enables FOR UPDATE SKIP LOCKED
--   concurrency guard without dynamic cron-parser computation per poll cycle.
--   Dynamic computation (Option B) is rejected because it cannot serve as a
--   stable database value for multi-instance double-fire prevention.
--
-- Column semantics:
--   next_fire_at — the absolute UTC timestamp at which this cron is next due.
--   Set on INSERT by the application layer (cron-parser.getNextDate from NOW()).
--   Updated by markCronFired() after each successful execution.
--   NULL only on rows created before this migration (backfilled to NOW() below).
--
-- Execution hot path:
--   getDueCrons()  → SELECT ... WHERE status = 'active' AND next_fire_at <= NOW()
--   markCronFired() → UPDATE crons SET last_run_at = NOW(), next_fire_at = $next
--                     inside a BEGIN transaction with FOR UPDATE SKIP LOCKED re-lock
--
-- The FOR UPDATE SKIP LOCKED guard in markCronFired() is the double-fire protection.
-- getDueCrons() runs in autocommit — it provides candidates, not a durable lock.
--
-- Run with:
--   psql -h $PGHOST -p $PGPORT -U $PGUSER -d $PGDATABASE -f migrations/006_cron_next_fire_at.sql
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE crons ADD COLUMN next_fire_at TIMESTAMPTZ;

-- Backfill: set to NOW() so the first worker poll computes the real next tick
-- via cron-parser and updates next_fire_at immediately after the first execution.
-- Active crons only — paused/deleted crons are not polled.
UPDATE crons SET next_fire_at = NOW() WHERE status = 'active';

-- Partial index: only active crons are polled by the worker.
-- Excludes paused/deleted rows to reduce write amplification on status changes
-- and improve index locality for the getDueCrons() hot path.
CREATE INDEX idx_crons_next_fire ON crons(next_fire_at) WHERE status = 'active';

COMMIT;
