/**
 * src/integrations/clickup/client.ts
 *
 * ClickUp REST API v2 wrapper for outbound synchronization.
 *
 * Provides:
 * - getTask(taskId) — fetch task metadata
 * - updateTask(taskId, updates) — update task status and fields
 * - getList(listId) — fetch list metadata
 *
 * Features:
 * - Exponential backoff retry (3 attempts, 1s base delay)
 * - Safe error logging (no API tokens, payloads, or sensitive data)
 * - Fail-safe: all errors are logged but not thrown (caller decides retry logic)
 *
 * Design rationale:
 * - Caller is responsible for transaction semantics (sync_queue write)
 * - Client does not throw; instead returns success/failure in result object
 * - This allows SyncWorker to make a single transactional decision: insert sync_queue row
 */

const CLICKUP_API_BASE = 'https://api.clickup.com/api/v2'
const CLICKUP_API_TOKEN = process.env['CLICKUP_BOT_API_TOKEN']
const MAX_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000

interface ApiResult<T> {
  success: boolean
  data?: T
  statusCode?: number
  message?: string
}

/**
 * Exponential backoff delay calculation.
 * delay = baseDelay * (2 ^ attemptNumber)
 * e.g., attempt 0 -> 1000ms, attempt 1 -> 2000ms, attempt 2 -> 4000ms
 */
function getBackoffDelay(attempt: number): number {
  return RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
}

/**
 * Sleep for N milliseconds (async pause).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch a ClickUp task by task ID.
 * Returns task metadata (status, custom fields, etc.).
 *
 * Used to verify a task exists before syncing.
 * Safe: does not throw; all errors are logged and returned as { success: false }.
 */
export async function getTask(taskId: string): Promise<
  ApiResult<{
    id: string
    name: string
    status: { status: string }
    custom_fields?: Array<{ id: string; value: unknown }>
  }>
> {
  if (!CLICKUP_API_TOKEN) {
    return {
      success: false,
      message: 'ClickUp API token not configured',
    }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}`, {
        method: 'GET',
        headers: {
          Authorization: CLICKUP_API_TOKEN,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = (await response.json()) as {
          id: string
          name: string
          status: { status: string }
          custom_fields?: Array<{ id: string; value: unknown }>
        }
        return { success: true, data }
      }

      // Non-2xx response: log and retry
      const statusCode = response.status
      console.error(`[clickup-client] getTask(${taskId}) HTTP ${String(statusCode)}`)
      if (statusCode >= 500 && attempt < MAX_RETRIES - 1) {
        const delay = getBackoffDelay(attempt)
        await sleep(delay)
        continue
      }

      return {
        success: false,
        statusCode,
        message: `getTask failed: HTTP ${String(statusCode)}`,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error(`[clickup-client] getTask(${taskId}) error: ${message}`)

      if (attempt < MAX_RETRIES - 1) {
        const delay = getBackoffDelay(attempt)
        await sleep(delay)
        continue
      }

      return {
        success: false,
        message: `getTask failed after ${String(MAX_RETRIES)} attempts: ${message}`,
      }
    }
  }

  return {
    success: false,
    message: `getTask failed: max retries exceeded`,
  }
}

/**
 * Update a ClickUp task.
 *
 * Supports:
 * - status: update via custom field (field ID to be determined by provider)
 * - name: update task title
 * - description: update task description
 *
 * The caller passes custom_field_id and custom_field_value directly.
 * This adapter does not hardcode field IDs (provider-specific, managed externally).
 *
 * Safe: does not throw; all errors are logged and returned as { success: false }.
 */
export async function updateTask(
  taskId: string,
  updates: {
    name?: string
    description?: string
    custom_field_id?: string
    custom_field_value?: string
  },
): Promise<ApiResult<{ id: string }>> {
  if (!CLICKUP_API_TOKEN) {
    return {
      success: false,
      message: 'ClickUp API token not configured',
    }
  }

  // Build ClickUp API payload
  const payload: Record<string, unknown> = {}
  if (updates.name) payload.name = updates.name
  if (updates.description) payload.description = updates.description

  // Custom field update (if provided)
  if (updates.custom_field_id && updates.custom_field_value) {
    payload.custom_fields = [
      {
        id: updates.custom_field_id,
        value: updates.custom_field_value,
      },
    ]
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${CLICKUP_API_BASE}/task/${taskId}`, {
        method: 'PUT',
        headers: {
          Authorization: CLICKUP_API_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        const data = (await response.json()) as { id: string }
        return { success: true, data }
      }

      // Non-2xx response: log and retry
      const statusCode = response.status
      console.error(`[clickup-client] updateTask(${taskId}) HTTP ${String(statusCode)}`)
      if (statusCode >= 500 && attempt < MAX_RETRIES - 1) {
        const delay = getBackoffDelay(attempt)
        await sleep(delay)
        continue
      }

      return {
        success: false,
        statusCode,
        message: `updateTask failed: HTTP ${String(statusCode)}`,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error(`[clickup-client] updateTask(${taskId}) error: ${message}`)

      if (attempt < MAX_RETRIES - 1) {
        const delay = getBackoffDelay(attempt)
        await sleep(delay)
        continue
      }

      return {
        success: false,
        message: `updateTask failed after ${String(MAX_RETRIES)} attempts: ${message}`,
      }
    }
  }

  return {
    success: false,
    message: `updateTask failed: max retries exceeded`,
  }
}

/**
 * Fetch a ClickUp list (collection of tasks).
 * Returns list metadata.
 *
 * Safe: does not throw; all errors are logged and returned as { success: false }.
 */
export async function getList(listId: string): Promise<
  ApiResult<{
    id: string
    name: string
    folder_id: string
  }>
> {
  if (!CLICKUP_API_TOKEN) {
    return {
      success: false,
      message: 'ClickUp API token not configured',
    }
  }

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(`${CLICKUP_API_BASE}/list/${listId}`, {
        method: 'GET',
        headers: {
          Authorization: CLICKUP_API_TOKEN,
          'Content-Type': 'application/json',
        },
      })

      if (response.ok) {
        const data = (await response.json()) as {
          id: string
          name: string
          folder_id: string
        }
        return { success: true, data }
      }

      // Non-2xx response: log and retry
      const statusCode = response.status
      console.error(`[clickup-client] getList(${listId}) HTTP ${String(statusCode)}`)
      if (statusCode >= 500 && attempt < MAX_RETRIES - 1) {
        const delay = getBackoffDelay(attempt)
        await sleep(delay)
        continue
      }

      return {
        success: false,
        statusCode,
        message: `getList failed: HTTP ${String(statusCode)}`,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error(`[clickup-client] getList(${listId}) error: ${message}`)

      if (attempt < MAX_RETRIES - 1) {
        const delay = getBackoffDelay(attempt)
        await sleep(delay)
        continue
      }

      return {
        success: false,
        message: `getList failed after ${String(MAX_RETRIES)} attempts: ${message}`,
      }
    }
  }

  return {
    success: false,
    message: `getList failed: max retries exceeded`,
  }
}
