-- migrations/011_grant_openhiveos_runtime.sql
-- Murphy — 2026-06-08
--
-- Root cause: Tables created by the host OS user (e.g. "richo") are owned by
-- that user, not by "openhiveos". PostgreSQL does not automatically grant
-- permissions to other roles just because they own the database. Migration 010
-- fixed openhiveos_reader but left the runtime openhiveos user without DML on
-- tables created after 003_squad_api_role.sql ran (ethos_seals, llm_usage,
-- sops, etc.).
--
-- Fix 1: Grant DML on all currently existing tables to openhiveos.
-- Fix 2: Set default privileges so future tables are covered automatically.
--
-- Note: Migration 007 (SEC-7) intends to eventually replace the openhiveos
-- runtime user with opensquad_app. Until that operator cutover is completed,
-- openhiveos must retain full DML access. This migration is safe to re-run
-- (GRANT on already-held privilege is a no-op in PostgreSQL).

BEGIN;

-- Current tables
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO openhiveos;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO openhiveos;

-- Future tables created by the host operator
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openhiveos;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO openhiveos;

COMMIT;
