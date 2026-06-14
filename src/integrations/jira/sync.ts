/**
 * src/integrations/jira/sync.ts
 *
 * Outbound sync orchestration for JIRA (ARCH-024, Sprint N+2 stub).
 *
 * Called by JiraAdapter.dispatch() when SyncWorker polls sync_queue.
 * The function will orchestrate:
 * 1. Look up the external task link
 * 2. Build the update payload
 * 3. Call the JIRA API
 * 4. Insert a sync_queue row with status 'done' or 'failed'
 *
 * STUB: Throws "not yet implemented" with clear Sprint N+2 message.
 * Structure mirrors ClickUp sync.ts exactly so replacement is mechanical.
 *
 * Design rationale (planned):
 * - Inserted AFTER the API call (so we know success/failure status)
 * - Inserted even on failure (so SyncWorker can track retries)
 * - status 'done' = successful sync; status 'failed' = retry needed
 * - SyncWorker increments retry_count and reschedules failed rows
 *
 * Errors are caught and logged, but not thrown.
 * The caller (JiraAdapter) is responsible for any retry logic.
 */

interface Task {
  id: number
  title: string
  description?: string
  status: string
}

/**
 * Main outbound sync function for JIRA.
 *
 * STUB: Throws "not yet implemented" message.
 * Implementation deferred to Sprint N+2.
 */
// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
export async function syncToJira(task: Task): Promise<void> {
  throw new Error('[ARCH-024] syncToJira() not yet implemented (Sprint N+2)')
}
