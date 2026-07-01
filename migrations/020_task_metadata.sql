-- migrations/020_task_metadata.sql
-- Add operator-defined metadata classification to tasks.
--
-- Context: The tasks table had no classification mechanism beyond status,
-- project_id, and assignee. This migration adds a JSONB metadata column
-- following the identical pattern used by the memories and thoughts tables
-- (migration 001_init.sql). The column is domain-agnostic — operators define
-- their own key/value vocabulary (tags, priority_label, type, etc.).
--
-- Integration adapters (e.g. ClickUp) use reserved keys prefixed with
-- 'source_' to preserve external classification data on inbound sync:
--   source_provider   TEXT    — originating provider (e.g. 'clickup')
--   source_priority   TEXT    — priority label from the external system
--   source_tags       TEXT[]  — tag names from the external system
--
-- Recommended (non-enforced) keys for agent use:
--   tags              TEXT[]  — general-purpose classification labels
--   priority_label    TEXT    — operator-defined priority vocabulary
--   type              TEXT    — operator-defined work type
--
-- Queried via JSONB containment: metadata @> '{"tags": ["backend"]}'::jsonb
-- GIN index makes all key-path lookups fast.
--
-- This migration must run after 019_triage_status.sql.

BEGIN;

ALTER TABLE tasks
  ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';

CREATE INDEX idx_tasks_metadata ON tasks USING gin(metadata);

COMMIT;
