-- migrations/010_reader_grant_all_tables.sql
-- Cooper — 2026-05-25
--
-- Fix: openhiveos_reader was missing SELECT on tables created after
-- 003_squad_api_role.sql ran (ethos_seals, llm_usage, etc.).
--
-- Root cause: ALTER DEFAULT PRIVILEGES FOR ROLE openhiveos in migration 003
-- only covers tables created BY the openhiveos user. Migrations run as the
-- host operator (e.g. "richo"), so all tables are owned by that user — the
-- default privilege grant never fires for them.
--
-- Fix: run GRANT SELECT ON ALL TABLES at the end of every migration set.
-- This is idempotent — granting an already-held privilege is a no-op in PG.
--
-- Post-migration checklist:
--   After any migration that creates a new table, re-run this migration OR
--   manually run: GRANT SELECT ON ALL TABLES IN SCHEMA public TO openhiveos_reader;

BEGIN;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO openhiveos_reader;

COMMIT;
