-- migrations/015_external_task_links.sql
-- ARCH-024: External Task Sync — Provider-agnostic task link table
--
-- Context: ARCH-024 introduces bidirectional sync with external task providers
-- (ClickUp, JIRA, etc.). This table joins OpenHiveOS tasks to their provider
-- counterparts, preserving sync state and metadata.
--
-- The external_task_links table serves three purposes:
--   1. Links an OpenHiveOS task (by id) to an external provider's task (by external_id)
--   2. Tracks sync state and last sync timestamp for observability
--   3. Provides the join path for queries like "show all tasks linked to ClickUp"
--
-- Design notes (ARCH-024 Amendment 1.2):
--   - provider is TEXT, not a PG enum (future-proof for JIRA, etc.)
--   - external_id is provider-specific (ClickUp task ID, JIRA issue key, etc.)
--   - sync_state is TEXT with CHECK constraint (sync health indicator)
--   - Unique constraint on (task_id, provider) ensures at most one external link per provider
--   - ON DELETE CASCADE ensures cleanup when the OpenHiveOS task is deleted
--
-- This migration must run after 014 (task status state machine).
-- No data seeding required — links are created by API handlers and SyncWorker.

BEGIN;

-- Create external_task_links table
CREATE TABLE external_task_links (
  id                BIGSERIAL       PRIMARY KEY,
  task_id           BIGINT          NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider          TEXT            NOT NULL,
  external_id       TEXT            NOT NULL,
  external_url      TEXT,
  sync_state        TEXT            NOT NULL DEFAULT 'in_sync',
  last_synced_at    TIMESTAMPTZ,
  created_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

  -- Constraint: valid sync states
  CONSTRAINT chk_external_task_links_sync_state CHECK (
    sync_state IN ('in_sync', 'drift', 'error')
  ),

  -- Constraint: provider must be lowercase, no spaces
  CONSTRAINT chk_external_task_links_provider CHECK (
    provider ~ '^[a-z][a-z0-9]*$'
  ),

  -- Constraint: external_id must not be empty
  CONSTRAINT chk_external_task_links_external_id CHECK (
    external_id ~ '^\S+$'
  ),

  -- Unique: one external link per task per provider
  UNIQUE (task_id, provider)
);

-- Index for join queries: "find all external links for a task"
CREATE INDEX idx_external_task_links_task_id ON external_task_links(task_id);

-- Index for provider-specific queries: "find all ClickUp-linked tasks"
CREATE INDEX idx_external_task_links_provider ON external_task_links(provider);

-- Index for sync operations: "find links needing refresh (last sync > N minutes ago)"
CREATE INDEX idx_external_task_links_last_synced ON external_task_links(last_synced_at);

-- Index for error tracking: "find all links in error state"
CREATE INDEX idx_external_task_links_sync_state ON external_task_links(sync_state);

COMMIT;
