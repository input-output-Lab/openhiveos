-- rollback_015_external_task_links.sql
-- Rollback for migration 015_external_task_links.sql
-- Drops the external_task_links table and all associated indexes.

BEGIN;

DROP TABLE IF EXISTS external_task_links CASCADE;

COMMIT;
