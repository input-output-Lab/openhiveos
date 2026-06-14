-- migrations/016_sync_queue.sql
-- ARCH-024: External Task Sync — Async queue for outbound task synchronization
--
-- Context: ARCH-024 Decision adopts the Async Queue Worker pattern.
-- Instead of synchronously calling external provider APIs inside request handlers,
-- all state changes are written to sync_queue. A background SyncWorker process
-- polls this queue and dispatches the API calls asynchronously.
--
-- Trade-offs accepted (ARCH-024):
--   - OpenHiveOS-to-provider sync latency: 10–30 seconds (eventually consistent)
--   - This latency is acceptable because OpenHiveOS is the system of record
--   - Provider is a view layer for external stakeholders
--
-- Queue lifecycle:
--   1. Handler writes row with status: 'pending' + payload (same transaction as DB write)
--   2. SyncWorker polls for pending rows, marks as 'dispatched', calls provider API
--   3. On API success, mark 'done'; on failure, increment retry_count, reschedule
--   4. After 30 days (TTL), cleanup cron purges 'done' and 'failed' rows
--
-- Security notes (per Locksmith pre-implementation conditions):
--   - C3: clickup_event_id UNIQUE for deduplication (prevents replay attacks)
--   - payload must never be logged at INFO or DEBUG level (contains sensitive task data)
--   - SyncWorker must not expose payload in error logs — only metadata
--
-- This migration must run after 015_external_task_links.sql.

BEGIN;

-- Create sync_queue table
CREATE TABLE sync_queue (
  id                BIGSERIAL       PRIMARY KEY,
  task_id           BIGINT          NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider          TEXT            NOT NULL,
  payload           JSONB           NOT NULL,
  status            TEXT            NOT NULL DEFAULT 'pending',
  clickup_event_id  TEXT,
  retry_count       INT             NOT NULL DEFAULT 0,
  dispatched_at     TIMESTAMPTZ,
  error_message     TEXT,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- Constraint: valid queue states
  CONSTRAINT chk_sync_queue_status CHECK (
    status IN ('pending', 'dispatched', 'done', 'failed')
  ),

  -- Constraint: provider must be lowercase, no spaces
  CONSTRAINT chk_sync_queue_provider CHECK (
    provider ~ '^[a-z][a-z0-9]*$'
  ),

  -- Constraint: retry count must be non-negative
  CONSTRAINT chk_sync_queue_retry_count CHECK (
    retry_count >= 0
  )
);

-- Unique partial index: Locksmith C3 — deduplication on clickup_event_id (when present)
-- If clickup_event_id is NULL, no constraint (nullable unique allows multiple NULLs)
CREATE UNIQUE INDEX idx_sync_queue_clickup_event_id_unique ON sync_queue(clickup_event_id) WHERE clickup_event_id IS NOT NULL;

-- Index for SyncWorker polling: "find all pending rows for a provider"
CREATE INDEX idx_sync_queue_provider_status ON sync_queue(provider, status) WHERE status IN ('pending', 'dispatched');

-- Index for task-specific queries: "find all sync operations for a task"
CREATE INDEX idx_sync_queue_task_id ON sync_queue(task_id);

COMMIT;
