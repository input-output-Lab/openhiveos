-- migrations/003_squad_api_role.sql
-- ARCH-012 SEC-A3, SEC-A5: squad-api SELECT-only database principal
--
-- Creates the openhiveos_reader role that squad-api assumes per-request
-- via SET LOCAL ROLE openhiveos_reader. This confines every dashboard
-- query to SELECT — no INSERT, UPDATE, or DELETE is possible regardless
-- of application-level bugs or injection attempts.
--
-- How it is used:
--   The squad-api connects to Postgres as the openhiveos user. On each
--   authenticated request the auth middleware executes:
--     SET LOCAL ROLE openhiveos_reader
--   This downgrades the connection to SELECT-only for the duration of that
--   request. The SET LOCAL is scoped to the transaction — it cannot leak
--   across pool connections.
--
-- The GRANT ... TO openhiveos line is required for SET ROLE to work.
-- Without it PostgreSQL rejects the SET ROLE with "permission denied".
--
-- ALTER DEFAULT PRIVILEGES ensures that tables added by subsequent
-- migrations (004_ethos_seal, 005_llm_usage, etc.) are automatically
-- covered without a manual GRANT after each migration.
--
-- Idempotent: CREATE ROLE IF NOT EXISTS is a no-op on re-run.
-- GRANT on an already-granted privilege is also a no-op in PostgreSQL.
--
-- Applies as: migration 003 (first of two 003-prefixed files)
-- Alphabetical order: 003_dashboard_agent.sql runs first — no dependency.

BEGIN;

-- ---------------------------------------------------------------------------
-- Create the SELECT-only role
-- ---------------------------------------------------------------------------
CREATE ROLE IF NOT EXISTS openhiveos_reader;

-- Allow the openhiveos runtime user to assume the reader role per-request.
-- Required for SET LOCAL ROLE openhiveos_reader to succeed in auth middleware.
GRANT openhiveos_reader TO openhiveos;

-- ---------------------------------------------------------------------------
-- Database and schema access
-- ---------------------------------------------------------------------------
-- Use current_database() so this migration is portable across environments
-- (production DB: openhiveos, CI DB: openhiveos_ci, dev DB: operator-named).
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO openhiveos_reader', current_database());
END;
$$;
GRANT USAGE ON SCHEMA public TO openhiveos_reader;

-- ---------------------------------------------------------------------------
-- SELECT on all currently existing tables
-- ---------------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA public TO openhiveos_reader;

-- ---------------------------------------------------------------------------
-- SELECT on all tables added by future migrations (004, 005, etc.)
-- ALTER DEFAULT PRIVILEGES applies to tables created by the openhiveos user.
-- ---------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE openhiveos IN SCHEMA public
  GRANT SELECT ON TABLES TO openhiveos_reader;

COMMIT;
