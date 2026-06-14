/**
 * src/integrations/jira/index.ts
 *
 * JIRA integration adapter (ARCH-024, planned for Sprint N+2).
 *
 * Stub for Sprint N (registration only).
 * Full implementation deferred until Task #TBD (JIRA adapter).
 *
 * This file establishes:
 * - Provider name and enabled flag (always false for this sprint)
 * - Placeholder methods (throw "not yet implemented")
 * - Zod config validation for required env vars
 */

import { z } from 'zod'
import type { IntegrationAdapter, SyncQueueRow, WebhookPayload } from '../adapter.js'

/**
 * Configuration schema for JIRA integration.
 * All vars are optional (JIRA is not yet implemented).
 * Placeholder structure prepared for future implementation.
 */
const JiraConfigSchema = z.object({
  JIRA_ENABLED: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  JIRA_BASE_URL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_BOT_USER_ID: z.string().optional(),
  JIRA_WEBHOOK_SECRET: z.string().optional(),
})

/**
 * Validate JIRA config from environment.
 * Currently always disabled; validation prepared for future enablement.
 */
export function validateJiraConfig(): z.infer<typeof JiraConfigSchema> {
  const raw = {
    JIRA_ENABLED: process.env['JIRA_ENABLED'],
    JIRA_BASE_URL: process.env['JIRA_BASE_URL'],
    JIRA_API_TOKEN: process.env['JIRA_API_TOKEN'],
    JIRA_BOT_USER_ID: process.env['JIRA_BOT_USER_ID'],
    JIRA_WEBHOOK_SECRET: process.env['JIRA_WEBHOOK_SECRET'],
  }

  const parsed = JiraConfigSchema.parse(raw)

  // Validation: if enabled, all four secret vars must be present
  // This check is a no-op for Sprint N (JIRA_ENABLED cannot be true until implementation).
  // Included here for future-proofing (Sprint N+2 when JIRA adapter is implemented).
  if (parsed.JIRA_ENABLED) {
    if (!parsed.JIRA_BASE_URL || !parsed.JIRA_API_TOKEN || !parsed.JIRA_BOT_USER_ID || !parsed.JIRA_WEBHOOK_SECRET) {
      throw new Error(
        'JIRA_ENABLED=true but one or more required env vars are missing (JIRA_BASE_URL, JIRA_API_TOKEN, JIRA_BOT_USER_ID, JIRA_WEBHOOK_SECRET).',
      )
    }
  }

  return parsed
}

/**
 * JIRA integration adapter.
 * Exported and registered in src/integrations/registry.ts.
 *
 * Methods are stubs (throw "not yet implemented").
 * Full implementation deferred to Sprint N+2.
 */
export const jiraAdapter: IntegrationAdapter = {
  provider: 'jira',
  enabled: process.env['JIRA_ENABLED'] === 'true',

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async dispatch(row: SyncQueueRow): Promise<void> {
    throw new Error('[ARCH-024] JIRA dispatch() not yet implemented (Sprint N+2)')
  },

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async handleWebhook(payload: WebhookPayload): Promise<void> {
    throw new Error('[ARCH-024] JIRA handleWebhook() not yet implemented (Sprint N+2)')
  },
}
