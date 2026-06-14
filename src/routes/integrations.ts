/**
 * src/routes/integrations.ts
 *
 * GET /api/integrations/status — integration health status endpoint
 *
 * Returns per-provider integration health snapshots and system-wide summary.
 * Used by dashboard and operators to monitor sync queue health.
 *
 * No authentication required (mounted behind /api with authMiddleware,
 * so caller is already authenticated — this is an internal-only endpoint).
 *
 * Response times: <100ms expected (simple aggregation queries + partial indexes).
 * No write operations — read-only via withReaderRole().
 */

import { Router } from 'express'
import { withReaderRole } from '../squad-api/db.js'
import { getIntegrationsStatus } from '../services/integrations-status.js'
import { getTriageInbox } from '../services/integrations-triage.js'

export const integrationsRouter = Router()

/**
 * GET /api/integrations/status
 *
 * Response: IntegrationStatusResponse
 * - timestamp: ISO 8601 timestamp of status snapshot
 * - providers: array of per-provider health snapshots
 *   - provider: 'clickup' | 'jira' | ...
 *   - enabled: boolean
 *   - last_sync?: ISO 8601 (most recent 'done' status)
 *   - pending_count: number
 *   - failed_count: number
 *   - failed_oldest_at?: ISO 8601 (oldest failed row)
 *   - last_error?: string (most recent error message)
 *   - status: 'healthy' | 'degraded' | 'failed' | 'disabled'
 * - summary:
 *   - total_pending: sum of all provider pending_counts
 *   - total_failed: sum of all provider failed_counts
 *   - status: 'healthy' | 'degraded' | 'failed' (system-wide rollup)
 */
integrationsRouter.get('/status', async (_req, res) => {
  try {
    const result = await withReaderRole(async (client) => {
      return await getIntegrationsStatus(client)
    })

    // SEC-B1: never expose raw error_message column name or internal state details
    // The response already excludes sensitive data (payload, secrets, etc.)
    res.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('[integrations/status] Failed to compute status:', message)
    res.status(500).json({
      error: 'Failed to retrieve integration status',
    })
  }
})

/**
 * GET /api/integrations/triage
 *
 * Fetch triage inbox: all tasks with status='triage' pending agent promotion (ARCH-024).
 * These are external tasks (from ClickUp webhooks) that have been ingested but not yet
 * promoted to the active task set.
 *
 * Response: TriageInboxResponse
 * - count: number of tasks in triage
 * - tasks: array of tasks with external links
 *   - id: OpenHiveOS task ID
 *   - title: task title
 *   - description?: task description (nullable)
 *   - external_links: array of provider links
 *     - provider: 'clickup', 'jira', etc.
 *     - external_id: provider-specific task ID
 *     - external_url?: link to external task (nullable)
 *     - sync_state: 'in_sync' | 'drift' | 'error'
 *     - last_synced_at?: ISO 8601 timestamp
 *   - created_at: ISO 8601 (when task was created)
 */
integrationsRouter.get('/triage', async (_req, res) => {
  try {
    const result = await withReaderRole(async (client) => {
      return await getTriageInbox(client)
    })

    res.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error'
    console.error('[integrations/triage] Failed to fetch triage inbox:', message)
    res.status(500).json({
      error: 'Failed to retrieve triage inbox',
    })
  }
})
