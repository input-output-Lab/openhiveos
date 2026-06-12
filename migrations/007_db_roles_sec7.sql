-- migrations/007_db_roles_sec7.sql
-- OpenHiveOS — Database credential isolation (SEC-7)
--
-- SEC-7 ruling (Silas, 2026-05-21): credential-level isolation required.
-- Structural isolation (separate roles in application code) is NOT sufficient.
-- Two distinct database principals must exist with different passwords and
-- permissions — one for runtime DML, one for migration DDL.
--
-- This migration creates:
--
--   opensquad_app
--     Purpose:    Runtime database principal for the MCP server and squad-api.
--     Grants:     SELECT, INSERT, UPDATE, DELETE on all current + future tables.
--     NOT granted: CREATE, DROP, ALTER (no DDL at runtime).
--     CONNECTION LIMIT: 25  (caps pool exhaustion blast radius — Silas ruling)
--     Password:   Set by operator via psql after provisioning:
--                   ALTER ROLE opensquad_app PASSWORD '<APP_PASSWORD>';
--
--   opensquad_migrate
--     Purpose:    Migration-only principal. Runs at deploy time, not at runtime.
--     Grants:     CREATE ON SCHEMA public (DDL to create/alter tables and indexes).
--                 CONNECT ON DATABASE (required to connect at all).
--                 No SELECT, INSERT, UPDATE, DELETE — cannot read or write data.
--     CONNECTION LIMIT: 1  (single migration process at a time — prevents
--                          concurrent migrations from causing partial state)
--     Password:   Set by operator via psql after provisioning:
--                   ALTER ROLE opensquad_migrate PASSWORD '<MIGRATE_PASSWORD>';
--
-- Runtime configuration (docker-compose.yml / .env):
--   MCP server:      DATABASE_URL=postgresql://opensquad_app:<APP_PASSWORD>@...
--   Migration runner: PGUSER=opensquad_migrate PGPASSWORD=<MIGRATE_PASSWORD>
--
-- CI: Migration validation job continues to use the openhiveos_ci superuser.
-- Production: Only opensquad_app and opensquad_migrate credentials are used
--             after this migration is applied.
--
-- Idempotent: CREATE ROLE IF NOT EXISTS is safe to re-run.
--
-- OPERATOR ACTION REQUIRED after applying this migration:
--   1. SET passwords for both roles (see above)
--   2. Update DATABASE_URL in .env to use opensquad_app
--   3. Update MIGRATE_PGUSER/MIGRATE_PGPASSWORD in .env for the migrate service
--   4. Rotate the openhiveos superuser password (it is no longer needed at runtime)

BEGIN;

-- ---------------------------------------------------------------------------
-- opensquad_app — runtime DML principal (SEC-7)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opensquad_app') THEN
    CREATE ROLE opensquad_app WITH LOGIN CONNECTION LIMIT 25;
  END IF;
END
$$;

-- Database + schema access
DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO opensquad_app',
    current_database()
  );
END;
$$;
GRANT USAGE ON SCHEMA public TO opensquad_app;

-- DML on all current tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO opensquad_app;

-- DML on all future tables (migrations 008+)
ALTER DEFAULT PRIVILEGES FOR ROLE opensquad_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO opensquad_app;

-- Sequences (required for SERIAL / GENERATED columns)
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO opensquad_app;
ALTER DEFAULT PRIVILEGES FOR ROLE opensquad_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO opensquad_app;

-- ---------------------------------------------------------------------------
-- opensquad_migrate — DDL-only migration principal (SEC-7)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'opensquad_migrate') THEN
    CREATE ROLE opensquad_migrate WITH LOGIN CONNECTION LIMIT 1;
  END IF;
END
$$;

-- Database + schema access
DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO opensquad_migrate',
    current_database()
  );
END;
$$;
GRANT USAGE, CREATE ON SCHEMA public TO opensquad_migrate;

-- opensquad_migrate does NOT get DML grants (SELECT, INSERT, UPDATE, DELETE).
-- It can create and modify schema objects only — never read or write row data.

-- The openhiveos_reader role (003_squad_api_role.sql) stays wired to openhiveos.
-- squad-api uses SET LOCAL ROLE openhiveos_reader per-request — unchanged.

COMMIT;
