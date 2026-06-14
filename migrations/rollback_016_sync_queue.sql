-- rollback_016_sync_queue.sql
-- Rollback for migration 016_sync_queue.sql
-- Drops the sync_queue table and all associated indexes.

BEGIN;

DROP TABLE IF EXISTS sync_queue CASCADE;

COMMIT;
