/**
 * src/integrations/clickup/index.ts
 *
 * ClickUp integration adapter (ARCH-024).
 *
 * Stub for Sprint N (registration only).
 * Full implementation (dispatch + handleWebhook) is Task #1762, Task #1763.
 *
 * This file establishes:
 * - Provider name and enabled flag (env-driven)
 * - Placeholder methods (throw "not yet implemented")
 * - Zod config validation for required env vars
 */

import { z } from 'zod'
import { pool } from '../../db/client.js'
import type { IntegrationAdapter, SyncQueueRow, WebhookPayload } from '../adapter.js'
import { syncToClickUp } from './sync.js'

/**
 * Configuration schema for ClickUp integration.
 * All three vars are required if CLICKUP_ENABLED=true.
 * Validation happens at registry boot — fail fast if incomplete.
 */
const ClickUpConfigSchema = z.object({
  CLICKUP_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  CLICKUP_BOT_API_TOKEN: z.string().optional(),
  CLICKUP_BOT_USER_ID: z.string().optional(),
  CLICKUP_WEBHOOK_SECRET: z.string().optional(),
})

/**
 * Validate ClickUp config from environment.
 * If CLICKUP_ENABLED=true, all other fields must be present (no partially-configured adapter).
 */
export function validateClickUpConfig(): z.infer<typeof ClickUpConfigSchema> {
  const raw = {
    CLICKUP_ENABLED: process.env['CLICKUP_ENABLED'],
    CLICKUP_BOT_API_TOKEN: process.env['CLICKUP_BOT_API_TOKEN'],
    CLICKUP_BOT_USER_ID: process.env['CLICKUP_BOT_USER_ID'],
    CLICKUP_WEBHOOK_SECRET: process.env['CLICKUP_WEBHOOK_SECRET'],
  }

  const parsed = ClickUpConfigSchema.parse(raw)

  // Validation: if enabled, all three secret vars must be present
  if (parsed.CLICKUP_ENABLED) {
    if (!parsed.CLICKUP_BOT_API_TOKEN) {
      throw new Error(
        'CLICKUP_ENABLED=true but CLICKUP_BOT_API_TOKEN is missing. Set all three or set CLICKUP_ENABLED=false.',
      )
    }
    if (!parsed.CLICKUP_BOT_USER_ID) {
      throw new Error(
        'CLICKUP_ENABLED=true but CLICKUP_BOT_USER_ID is missing. Set all three or set CLICKUP_ENABLED=false.',
      )
    }
    if (!parsed.CLICKUP_WEBHOOK_SECRET) {
      throw new Error(
        'CLICKUP_ENABLED=true but CLICKUP_WEBHOOK_SECRET is missing. Set all three or set CLICKUP_ENABLED=false.',
      )
    }
  }

  return parsed
}

/**
 * Mapping of ClickUp list IDs to OpenHiveOS project IDs.
 * Used to route incoming ClickUp tasks to the correct project.
 */
const LIST_ID_TO_PROJECT_MAPPING: Record<string, number> = {
  '901327582339': 71, // Default ClickUp list → project 71 (IO FMS API)
  // Add more mappings as needed for multi-workspace support
}

/**
 * Handle taskCreated event: create a new OpenHiveOS task and link it
 * Fetches full task details from ClickUp API to preserve title, description, and attachments
 * Exported for testing purposes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleClickUpTaskCreated(clickupTaskId: string, payload: WebhookPayload): Promise<void> {
  console.log(`[clickup-adapter] Processing taskCreated: ${clickupTaskId}`)

  // Check if already linked
  const existingLink = await pool.query(
    'SELECT id FROM external_task_links WHERE external_id = $1 AND provider = $2',
    [clickupTaskId, 'clickup'],
  )

  if (existingLink.rows.length > 0) {
    console.log(`[clickup-adapter] Task ${clickupTaskId} already linked`)
    return
  }

  // Fetch full task details from ClickUp API
  const botToken = process.env['CLICKUP_BOT_API_TOKEN']
  if (!botToken) {
    throw new Error('CLICKUP_BOT_API_TOKEN not configured')
  }

  let clickupTask: {
    name: string
    description: string | null
    list?: { id: string }
    attachments?: Array<{ id: string; title: string; url: string }>
    priority?: { priority: string } | null
    tags?: Array<{ name: string }>
  }

  try {
    const response = await fetch(`https://api.clickup.com/api/v2/task/${clickupTaskId}`, {
      method: 'GET',
      headers: {
        Authorization: botToken,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`ClickUp API error: ${String(response.status)} ${response.statusText}`)
    }

    clickupTask = (await response.json()) as typeof clickupTask
  } catch (err) {
    console.error(`[clickup-adapter] Failed to fetch ClickUp task ${clickupTaskId}:`, err)
    throw err
  }

  // Build enriched description with attachments
  let description = clickupTask.description || ''

  if (clickupTask.attachments && clickupTask.attachments.length > 0) {
    if (description) {
      description += '\n\n---\n\n**Attachments:**\n'
    } else {
      description = '**Attachments:**\n'
    }

    description += clickupTask.attachments
      .map((att) => `- [${att.title || att.id}](${att.url})`)
      .join('\n')
  }

  // Determine project_id from ClickUp list_id
  let projectId = 71 // default fallback
  if (clickupTask.list?.id) {
    const mappedProjectId = LIST_ID_TO_PROJECT_MAPPING[clickupTask.list.id]
    if (mappedProjectId !== undefined) {
      projectId = mappedProjectId
    }
  }

  // Build metadata — preserve ClickUp classification data that would otherwise
  // be discarded. source_* keys are reserved for integration adapters.
  const taskMetadata: Record<string, unknown> = {
    source_provider: 'clickup',
  }
  if (clickupTask.priority?.priority) {
    taskMetadata['source_priority'] = clickupTask.priority.priority
  }
  if (clickupTask.tags && clickupTask.tags.length > 0) {
    taskMetadata['source_tags'] = clickupTask.tags.map((t) => t.name)
  }

  // Create task in OpenHiveOS with preserved title, enriched description, and metadata
  const taskResult = await pool.query<{ id: number }>(
    `
    INSERT INTO tasks (project_id, title, description, status, metadata)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
    `,
    [projectId, clickupTask.name, description, 'todo', JSON.stringify(taskMetadata)],
  )

  if (!taskResult.rows[0]) {
    throw new Error('Failed to create task in OpenHiveOS')
  }

  const taskId = taskResult.rows[0].id
  if (!taskId) {
    throw new Error('Failed to retrieve created task ID')
  }

  // Create external link
  const botUserId = process.env['CLICKUP_BOT_USER_ID'] ?? ''
  const clickUpUrl = `https://app.clickup.com/${botUserId}/v/t/${clickupTaskId}`

  await pool.query(
    `
    INSERT INTO external_task_links (task_id, provider, external_id, external_url, sync_state, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    `,
    [taskId, 'clickup', clickupTaskId, clickUpUrl, 'in_sync'],
  )

  console.log(
    `[clickup-adapter] Created task ${String(taskId)} linked to ClickUp ${clickupTaskId}`,
  )
}

/**
 * Handle taskUpdated event: update the linked OpenHiveOS task
 * Exported for testing purposes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleClickUpTaskUpdated(clickupTaskId: string, payload: WebhookPayload): Promise<void> {
  console.log(`[clickup-adapter] Processing taskUpdated: ${clickupTaskId}`)

  // Find linked task
  const linkResult = await pool.query<{ task_id: number }>(
    'SELECT task_id FROM external_task_links WHERE external_id = $1 AND provider = $2',
    [clickupTaskId, 'clickup'],
  )

  if (!linkResult.rows[0]) {
    console.log(`[clickup-adapter] No linked task for ${clickupTaskId} — skipping update`)
    return
  }

  const taskId = linkResult.rows[0].task_id
  if (!taskId) {
    throw new Error('Failed to retrieve task ID from link')
  }

  // TODO: Extract updates from history_items and apply to task
  // For now, just mark as synced
  await pool.query('UPDATE tasks SET updated_at = NOW() WHERE id = $1', [taskId])

  console.log(`[clickup-adapter] Updated task ${String(taskId)}`)
}

/**
 * Handle taskDeleted event: soft-delete the linked OpenHiveOS task
 * Exported for testing purposes.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function handleClickUpTaskDeleted(clickupTaskId: string, payload: WebhookPayload): Promise<void> {
  console.log(`[clickup-adapter] Processing taskDeleted: ${clickupTaskId}`)

  // Find linked task
  const linkResult = await pool.query<{ task_id: number }>(
    'SELECT task_id FROM external_task_links WHERE external_id = $1 AND provider = $2',
    [clickupTaskId, 'clickup'],
  )

  if (!linkResult.rows[0]) {
    console.log(`[clickup-adapter] No linked task for ${clickupTaskId} — skipping delete`)
    return
  }

  const taskId = linkResult.rows[0].task_id
  if (!taskId) {
    throw new Error('Failed to retrieve task ID from link')
  }

  // Soft-delete by marking status as pending-close
  await pool.query('UPDATE tasks SET status = $1 WHERE id = $2', ['pending-close', taskId])

  console.log(`[clickup-adapter] Marked task ${String(taskId)} as pending-close`)
}

/**
 * ClickUp integration adapter (ARCH-024).
 * Exported and registered in src/integrations/registry.ts.
 *
 * Task #1762 implementation:
 * - dispatch() calls syncToClickUp() to sync a task from OpenHiveOS to ClickUp
 *
 * Stub methods:
 * - handleWebhook() not yet implemented (Task #1763)
 */
export const clickupAdapter: IntegrationAdapter = {
  provider: 'clickup',
  enabled: process.env['CLICKUP_ENABLED'] === 'true',

  async dispatch(row: SyncQueueRow): Promise<void> {
    // Reconstruct the task object from the sync_queue row
    // The payload contains the task data that needs to be synced
    const payload = row.payload
    const title = typeof payload.title === 'string' ? payload.title : ''
    const description = typeof payload.description === 'string' ? payload.description : ''
    const status = typeof payload.openHiveOS_status === 'string' ? payload.openHiveOS_status : 'todo'
    const task = {
      id: row.task_id,
      title,
      description,
      status,
    }

    // Call the sync function to update the external task
    await syncToClickUp(task)
  },

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    throw new Error('[ARCH-024] ClickUp handleWebhook() not yet implemented (Task #1763)')
  },
}
