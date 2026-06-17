-- Migration 017: Add unique constraint on (task_id, provider) to sync_queue
-- Purpose: Enable ON CONFLICT logic for task sync deduplication

-- Add unique constraint on sync_queue
ALTER TABLE sync_queue
ADD CONSTRAINT sync_queue_task_provider_unique UNIQUE (task_id, provider);

-- Verify constraint is in place
SELECT constraint_name, constraint_type
FROM information_schema.table_constraints
WHERE table_name = 'sync_queue'
  AND constraint_name = 'sync_queue_task_provider_unique';
