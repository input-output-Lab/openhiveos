/**
 * src/integrations/jira/client.ts
 *
 * JIRA REST API wrapper for outbound synchronization (ARCH-024, Sprint N+2 stub).
 *
 * Provides:
 * - getTask(taskKey) — fetch task metadata
 * - updateTask(taskKey, updates) — update task status and fields
 * - getProject(projectKey) — fetch project metadata
 *
 * STUB: All methods throw "not yet implemented" with clear Sprint N+2 message.
 * Structure mirrors ClickUp client.ts exactly so replacement is mechanical.
 *
 * Features (planned, not implemented):
 * - Exponential backoff retry (3 attempts, 1s base delay)
 * - Safe error logging (no API tokens, payloads, or sensitive data)
 * - Fail-safe: all errors are logged but not thrown (caller decides retry logic)
 *
 * Design rationale (planned):
 * - Caller is responsible for transaction semantics (sync_queue write)
 * - Client does not throw; instead returns success/failure in result object
 * - This allows SyncWorker to make a single transactional decision: insert sync_queue row
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const JIRA_API_BASE = process.env['JIRA_BASE_URL'] || 'https://jira.example.com/rest/api/2'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const JIRA_API_TOKEN = process.env['JIRA_API_TOKEN']

interface ApiResult<T> {
  success: boolean
  data?: T
  statusCode?: number
  message?: string
}

/**
 * Fetch a JIRA task by task key (e.g., "PROJ-123").
 * Returns task metadata (status, custom fields, etc.).
 *
 * STUB: Throws "not yet implemented" message.
 * Implementation deferred to Sprint N+2.
 *
 * Used to verify a task exists before syncing.
 * Safe: does not throw on implementation; all errors would be logged and returned as { success: false }.
 */
// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
export async function getTask(taskKey: string): Promise<
  ApiResult<{
    key: string
    fields: {
      summary: string
      status: { name: string }
      customfield_?: unknown
    }
  }>
> {
  throw new Error('[ARCH-024] JIRA getTask() not yet implemented (Sprint N+2)')
}

/**
 * Update a JIRA task by task key.
 * Applies status changes, custom fields, and other metadata updates.
 *
 * STUB: Throws "not yet implemented" message.
 * Implementation deferred to Sprint N+2.
 */
// eslint-disable-next-line @typescript-eslint/require-await
export async function updateTask(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  taskKey: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  updates: Record<string, unknown>,
): Promise<ApiResult<{ key: string }>> {
  throw new Error('[ARCH-024] JIRA updateTask() not yet implemented (Sprint N+2)')
}

/**
 * Fetch a JIRA project by project key.
 * Returns project metadata (name, issue types, custom fields, etc.).
 *
 * STUB: Throws "not yet implemented" message.
 * Implementation deferred to Sprint N+2.
 *
 * Used by sync logic to understand available issue types and field structure.
 */
// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
export async function getProject(projectKey: string): Promise<
  ApiResult<{
    key: string
    name: string
    issueTypes: Array<{ name: string; id: string }>
  }>
> {
  throw new Error('[ARCH-024] JIRA getProject() not yet implemented (Sprint N+2)')
}
