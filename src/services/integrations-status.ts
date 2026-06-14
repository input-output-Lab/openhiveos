/**
 * src/services/integrations-status.ts
 *
 * Status computation for all registered integration providers.
 * Queries sync_queue to build per-provider health statistics.
 * Used by GET /api/integrations/status endpoint (ARCH-024).
 */

import { QueryResult, PoolClient } from 'pg'
import { getAllAdapters } from '../integrations/index.js'

/**
 * Provider status calculated from sync_queue state.
 */
export type ProviderStatus = 'healthy' | 'degraded' | 'failed' | 'disabled'

/**
 * Per-provider integration health snapshot.
 */
export interface ProviderHealthSnapshot {
  provider: string
  enabled: boolean
  last_sync?: string // ISO 8601 timestamp
  pending_count: number
  failed_count: number
  failed_oldest_at?: string // ISO 8601 timestamp
  last_error?: string
  status: ProviderStatus
}

/**
 * System-wide integration health summary.
 */
export interface IntegrationStatusResponse {
  timestamp: string // ISO 8601
  providers: ProviderHealthSnapshot[]
  summary: {
    total_pending: number
    total_failed: number
    status: ProviderStatus
  }
}

/**
 * Query result for sync_queue stats.
 */
interface SyncQueueStats {
  pending_count: string // COUNT(*) returns text in pg
  failed_count: string
  failed_oldest_at: string | null
  last_error: string | null
  last_sync: string | null
}

/**
 * Compute full integration status from all providers.
 *
 * For each enabled provider:
 * 1. Query sync_queue for provider-specific stats
 * 2. Determine status based on thresholds
 * 3. Roll up to system summary
 *
 * Disabled providers are included in the response with status='disabled'.
 *
 * Query performance: O(adapters.length) queries, each scans partial index.
 * Expected <100ms with proper indexing (idx_sync_queue_provider_status).
 */
export async function getIntegrationsStatus(
  client: PoolClient,
): Promise<IntegrationStatusResponse> {
  const adapters = getAllAdapters()
  const timestamp = new Date().toISOString()

  const providers: ProviderHealthSnapshot[] = []
  let totalPending = 0
  let totalFailed = 0
  let overallStatus: ProviderStatus = 'healthy'

  // Query stats for each provider (enabled and disabled)
  for (const adapter of adapters) {
    if (!adapter.enabled) {
      // Disabled provider — no query needed
      providers.push({
        provider: adapter.provider,
        enabled: false,
        pending_count: 0,
        failed_count: 0,
        status: 'disabled',
      })
      continue
    }

    // Query sync_queue for this provider
    const statsQuery = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::text as pending_count,
        COUNT(*) FILTER (WHERE status = 'failed')::text as failed_count,
        MIN(created_at) FILTER (WHERE status = 'failed') as failed_oldest_at,
        (
          SELECT error_message
            FROM (
              SELECT error_message, created_at
                FROM sync_queue
               WHERE provider = $1
                 AND status = 'failed'
               ORDER BY created_at DESC
               LIMIT 1
            ) sub
        ) as last_error,
        MAX(updated_at) FILTER (WHERE status = 'done') as last_sync
        FROM sync_queue
       WHERE provider = $1
    `

    let stats: QueryResult<SyncQueueStats>
    try {
      stats = await client.query<SyncQueueStats>(statsQuery, [adapter.provider])
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'unknown error'
      console.error(
        `[integrations-status] Failed to query stats for ${adapter.provider}:`,
        message,
      )
      throw err
    }

    // Parse counts (COUNT(*) returns text in pg client)
    const defaultRow: SyncQueueStats = {
      pending_count: '0',
      failed_count: '0',
      failed_oldest_at: null,
      last_error: null,
      last_sync: null,
    }
    const row = stats.rows[0] ?? defaultRow
    const pendingCount = parseInt(row.pending_count, 10)
    const failedCount = parseInt(row.failed_count, 10)

    // Determine provider status
    let providerStatus: ProviderStatus = 'healthy'

    if (pendingCount > 50) {
      // Queue backing up — treat as failed
      providerStatus = 'failed'
    } else if (failedCount > 0) {
      // Failures present — degraded (whether or not there are pending items)
      providerStatus = 'degraded'
    }

    // Build provider health snapshot
    const snapshot: ProviderHealthSnapshot = {
      provider: adapter.provider,
      enabled: true,
      pending_count: pendingCount,
      failed_count: failedCount,
      status: providerStatus,
    }

    // Add optional fields if present
    if (row.last_sync) {
      snapshot.last_sync = row.last_sync
    }
    if (row.failed_oldest_at) {
      snapshot.failed_oldest_at = row.failed_oldest_at
    }
    if (row.last_error) {
      snapshot.last_error = row.last_error
    }

    providers.push(snapshot)

    // Accumulate totals
    totalPending += pendingCount
    totalFailed += failedCount

    // Update overall status (failed wins, then degraded, then healthy)
    if (providerStatus === 'failed') {
      overallStatus = 'failed'
    } else if (providerStatus === 'degraded' && overallStatus !== 'failed') {
      overallStatus = 'degraded'
    }
  }

  return {
    timestamp,
    providers,
    summary: {
      total_pending: totalPending,
      total_failed: totalFailed,
      status: overallStatus,
    },
  }
}
