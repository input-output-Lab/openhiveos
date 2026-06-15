-- migrations/019_triage_status.sql
-- ARCH-024: Add `triage` to the task status state machine.
--
-- `triage` is an inbound-only status. Tasks land here from the inbound
-- processor (ClickUp webhook → inbound_events → task creation).
-- They are not reachable via normal task creation or the update_task MCP tool.
-- The only valid transition OUT of triage is via PATCH /api/integrations/triage/:id/promote.
--
-- State machine after this migration:
--   [inbound_processor] → triage → todo → wip → review → pending-close → done | rework
--
-- Guard required in application code:
--   1. `update_task` route must reject `triage` as a settable value (400)
--   2. `get_project_board` and MCP `query_tasks` must exclude triage-status tasks
--      from board-facing queries (WHERE t.status != 'triage')
--
-- Root cause: inbound processor could not INSERT tasks with status='triage'
-- (CHECK violation) and the promote endpoint was untestable with 0 triage rows.
-- Diagnosed by Silas on 2026-06-14 during Sprint 14 DoR review.
--
-- Run with:
--   psql "$DATABASE_URL" -f migrations/019_triage_status.sql
-- ---------------------------------------------------------------------------

BEGIN;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status;

ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_status
    CHECK (status IN ('todo', 'wip', 'review', 'done', 'rework', 'pending-close', 'triage'));

COMMIT;
