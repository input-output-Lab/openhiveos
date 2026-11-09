-- Rollback for 029_dashboard_sessions.sql (S18-SEC-03, #2642)

BEGIN;

DROP INDEX IF EXISTS idx_dashboard_sessions_expires_at;
DROP INDEX  IF EXISTS idx_dashboard_sessions_token_hash;
DROP TABLE IF EXISTS dashboard_sessions;

COMMIT;
