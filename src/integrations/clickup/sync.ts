import { pool } from '../../db/client.js'
import * as client from './client.js'
import { mapOpenHiveOSStatusToClickUp } from './status-map.js'

interface Task {
  id: number
  title: string
  description?: string
  status: string
}

interface ExternalTaskLink {
  id: number
  task_id: number
  external_id: string
  provider: string
}

/**
 * Main outbound sync function.
 *
 * Called by ClickUpAdapter.dispatch() when SyncWorker polls sync_queue.
 * The function orchestrates:
 * 1. Look up the external task link
 * 2. Build the update payload
 * 3. Call the ClickUp API
 * 4. Insert a sync_queue row with status 'done' or 'failed'
 *
 * Design rationale for sync_queue insert:
 * - Inserted AFTER the API call (so we know success/failure status)
 * - Inserted even on failure (so SyncWorker can track retries)
 * - status 'done' = successful sync; status 'failed' = retry needed
 * - SyncWorker increments retry_count and reschedules failed rows
 *
 * Errors are caught and logged, but not thrown.
 * The caller (ClickUpAdapter) is responsible for any retry logic.
 */
export async function syncToClickUp(task: Task): Promise<void> {
  try {
    // Step 1: Look up the external task link
    const linkResult = await pool.query<ExternalTaskLink>(
      `SELECT id, task_id, external_id, provider
       FROM external_task_links
       WHERE task_id = $1 AND provider = 'clickup'
       LIMIT 1`,
      [task.id],
    )

    if (linkResult.rowCount === 0) {
      // Task is not linked to ClickUp; nothing to sync
      console.error(`[clickup-sync] Task ${String(task.id)} not linked to ClickUp`)
      return
    }

    // rowCount > 0 guarantees at least one row
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const link = linkResult.rows[0]!
    const clickupTaskId = link.external_id

    // Step 2: Build the update payload
    // For now, we sync title, description, and status.
    // Custom field ID is stubbed (will be resolved in a future task).
    const payload = {
      name: task.title,
      description: task.description || '',
      status: mapOpenHiveOSStatusToClickUp(task.status),
    }

    // Step 3: Call ClickUp API
    const updateResult = await client.updateTask(clickupTaskId, {
      name: payload.name,
      description: payload.description,
      // custom_field_id and custom_field_value will be populated when
      // we have the field ID from the provider (ARCH-024 Amendment 1.3)
      // For now, status is passed but not written to the custom field.
    })

    // Step 4: Insert sync_queue row
    const queueStatus = updateResult.success ? 'done' : 'failed'
    const queuePayload = {
      task_id: task.id,
      openHiveOS_status: task.status,
      clickup_status: payload.status,
      title: task.title,
    }

    await pool.query(
      `INSERT INTO sync_queue (task_id, provider, payload, status)
       VALUES ($1, $2, $3, $4)`,
      [task.id, 'clickup', JSON.stringify(queuePayload), queueStatus],
    )

    if (updateResult.success) {
      console.error(`[clickup-sync] Task ${String(task.id)} synced to ClickUp successfully`)
    } else {
      const errorMsg = updateResult.message || 'unknown error'
      console.error(
        `[clickup-sync] Task ${String(task.id)} sync to ClickUp failed: ${errorMsg}`,
      )
    }
  } catch (err) {
    // Catch any unexpected errors (DB, networking, etc.)
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error(
      `[clickup-sync] Unexpected error syncing task ${String(task.id)}: ${message}`,
    )

    // Attempt to write a failed sync_queue row
    try {
      const queuePayload = {
        task_id: task.id,
        openHiveOS_status: task.status,
        error: message,
      }
      await pool.query(
        `INSERT INTO sync_queue (task_id, provider, payload, status)
         VALUES ($1, $2, $3, $4)`,
        [task.id, 'clickup', JSON.stringify(queuePayload), 'failed'],
      )
    } catch (queueErr) {
      const queueMsg = queueErr instanceof Error ? queueErr.message : 'unknown queue error'
      console.error(`[clickup-sync] Failed to insert sync_queue row: ${queueMsg}`)
    }
  }
}
