-- Rollback for 030_audit_runs.sql (S18-QA-01, #2567)

BEGIN;

DROP INDEX IF EXISTS idx_audit_runs_started_at;
DROP TABLE IF EXISTS audit_runs;

COMMIT;
