-- Migration 016: Add trigger to populate sync_queue when tasks are updated
-- Purpose: Enable automatic sync of task changes to external providers (ClickUp, etc.)

-- Create trigger function that inserts into sync_queue when a task is updated
CREATE OR REPLACE FUNCTION trigger_task_updated_sync_queue()
RETURNS TRIGGER AS $$
BEGIN
  -- Queue all task updates for syncing to external providers
  -- The SyncWorker will filter by project and provider
  INSERT INTO sync_queue (task_id, provider, payload, status, retry_count)
  VALUES (NEW.id, 'clickup', '{}'::jsonb, 'pending', 0)
  ON CONFLICT (task_id, provider) 
  DO UPDATE SET status = 'pending', retry_count = 0, created_at = NOW();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on tasks table for UPDATE events
DROP TRIGGER IF EXISTS task_updated_sync_queue ON tasks;
CREATE TRIGGER task_updated_sync_queue
AFTER UPDATE ON tasks
FOR EACH ROW
WHEN (OLD.* IS DISTINCT FROM NEW.*)
EXECUTE FUNCTION trigger_task_updated_sync_queue();

-- Also trigger on INSERT for new tasks
CREATE OR REPLACE FUNCTION trigger_task_created_sync_queue()
RETURNS TRIGGER AS $$
BEGIN
  -- Queue new tasks for syncing to external providers
  INSERT INTO sync_queue (task_id, provider, payload, status, retry_count)
  VALUES (NEW.id, 'clickup', '{}'::jsonb, 'pending', 0)
  ON CONFLICT (task_id, provider) 
  DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_created_sync_queue ON tasks;
CREATE TRIGGER task_created_sync_queue
AFTER INSERT ON tasks
FOR EACH ROW
EXECUTE FUNCTION trigger_task_created_sync_queue();

-- Verify the triggers are in place
SELECT trigger_name, event_object_table, event_manipulation
FROM information_schema.triggers
WHERE trigger_name LIKE 'task_%sync_queue'
ORDER BY trigger_name;
