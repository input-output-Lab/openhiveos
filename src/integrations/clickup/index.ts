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
