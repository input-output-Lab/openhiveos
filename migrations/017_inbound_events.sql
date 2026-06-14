-- migrations/017_inbound_events.sql
-- ARCH-024 Inbound: Storage for webhook events from external providers
--
-- Webhook flow:
-- 1. POST /webhooks/clickup receives HMAC-verified event
-- 2. Event stored in inbound_events table (raw payload, minimal metadata)
-- 3. Deduplication via provider_event_id UNIQUE constraint
-- 4. Background inbound_processor polls, looks up external_task_links,
--    creates/updates OpenHiveOS tasks, and marks rows as processed
--
-- This table is separate from sync_queue (which is for outbound sync).
--
-- Lifecycle:
--   - Status: 'pending' (received) → 'processing' (claimed by handler) → 'processed' (done) or 'failed'
--   - Rows retained for 7 days for replay/audit, then auto-purged

BEGIN;

CREATE TABLE inbound_events (
  id                  BIGSERIAL       PRIMARY KEY,
  provider            TEXT            NOT NULL,
  provider_event_id   TEXT            NOT NULL,
  event_type          TEXT            NOT NULL,
  payload             JSONB           NOT NULL,
  status              TEXT            NOT NULL DEFAULT 'pending',
  error_message       TEXT,
  processed_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- Deduplication: one row per (provider, event_id) pair
  CONSTRAINT uq_inbound_event_id UNIQUE (provider, provider_event_id),

  -- Status must be one of: pending, processing, processed, failed
  CONSTRAINT chk_inbound_status CHECK (
    status IN ('pending', 'processing', 'processed', 'failed')
  ),

  -- Provider must be lowercase alphanumeric (e.g., 'clickup', 'jira')
  CONSTRAINT chk_inbound_provider CHECK (
    provider ~ '^[a-z][a-z0-9]*$'
  )
);

-- Index for polling (ScanDirection: processing → pending)
CREATE INDEX idx_inbound_status_created
  ON inbound_events (status, created_at)
  WHERE status IN ('pending', 'failed');

-- Index for cleanup queries (retention: 7 days)
CREATE INDEX idx_inbound_created_at
  ON inbound_events (created_at DESC);

COMMIT;
