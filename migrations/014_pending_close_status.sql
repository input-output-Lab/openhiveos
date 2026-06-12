-- migrations/014_pending_close_status.sql
-- ARCH-023: Add `pending-close` to the task status state machine.
--
-- Context: ARCH-023 introduces a two-step close workflow. Assignees submit
-- `pending-close`; only the project owner (Elizabeth) may approve the
-- transition to `done`. This encodes separation of duties in the state
-- machine rather than in SOP text alone.
--
-- The status column is TEXT with a CHECK constraint (not a PG enum), so
-- this migration:
--   1. Drops the existing check constraint
--   2. Re-adds it with `pending-close` included
--   3. Updates the lifecycle comment (no data change — existing rows are valid)
--
-- State machine after this migration:
--   todo → wip → review → pending-close → done | rework
--
-- See ARCH-023 for ruling authority.

BEGIN;

-- Step 1: Drop the existing constraint
ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS chk_tasks_status;

-- Step 2: Re-add with pending-close included
ALTER TABLE tasks
  ADD CONSTRAINT chk_tasks_status
    CHECK (status IN ('todo', 'wip', 'review', 'done', 'rework', 'pending-close'));

COMMIT;
