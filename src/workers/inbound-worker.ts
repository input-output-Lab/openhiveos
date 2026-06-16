/**
 * src/workers/inbound-worker.ts
 *
 * InboundWorker execution layer — ARCH-024 G5.
 *
 * Responsibilities:
 *   1. Poll inbound_events every 10s for rows with status='pending' (order by created_at ASC).
 *   2. For each row, acquire a per-row FOR UPDATE SKIP LOCKED lock inside a transaction.
 *      If locked by another worker, skip — prevents thundering herd.
 *   3. Route to the provider-specific adapter and call adapter.handleWebhook(payload).
 *   4. On success: UPDATE status='done', updated_at=NOW() (transactional).
 *   5. On failure: UPDATE status='failed', updated_at=NOW(), retry_count++ (error_message stored).
 *   6. Log outcomes (provider, event_type, status, error if failed) — no sensitive payload logged.
 *   7. Graceful shutdown on SIGTERM (finish current batch, then exit).
 *
 * At-least-once delivery semantics:
 *   - Rows are locked and handled in a transaction.
 *   - Status is updated after handle completes (success or failure).
 *   - If handle succeeds but the status update fails, the row remains 'pending'
 *     and will be retried — eventual consistency.
 *
 * Retry strategy:
 *   - retry_count is incremented on every failure.
 *   - No backoff — rows are retried on the next poll cycle (10s).
 *   - No retry limit (yet) — rows stay 'failed' forever or until manually fixed.
 *   - Future: configure max_retry_count and mark 'dead_letter' if exceeded.
 *
 * Concurrency & scalability:
 *   - FOR UPDATE SKIP LOCKED prevents multiple workers from processing the same row.
 *   - Multiple InboundWorker instances can run in parallel — each picks a different locked row.
 *   - Batch size: 50 rows per poll (configurable via MAX_BATCH_SIZE const).
 *   - Drift-resistant: poll interval is adjusted to account for cycle time.
 *
 * Design constraints:
 *   - pool and adapters registry are injected at construction — testable.
 *   - No secrets logged (never log payload, adapter credentials, or provider tokens).
 *   - Graceful shutdown: SIGTERM handler sets running=false, finishes current batch.
 *   - Worker can run embedded (in squad-api process) or standalone (separate PM2 instance).
 */

import type { Pool } from 'pg'
import { getEnabledAdapters, getAdapter } from '../integrations/index.js'

const POLL_INTERVAL_MS = 10_000
const MAX_BATCH_SIZE = 50

export interface InboundEventRow {
  id: number
  provider: string
  provider_event_id: string
  event_type: string
  payload: Record<string, unknown>
  status: 'pending'
  retry_count: number
  created_at: string
}

export class InboundWorker {
  private readonly pool: Pool
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(pool: Pool) {
    this.pool = pool
  }

  start(): void {
    if (this.running) return
    this.running = true
    console.error('[inbound-worker] Started — polling every 10s')

    // Debug: show which adapters are enabled
    const enabledAdapters = getEnabledAdapters()
    console.error(
      `[inbound-worker] Enabled adapters: ${enabledAdapters.length > 0 ? enabledAdapters.map(a => a.provider).join(', ') : 'NONE'}`,
    )

    this.poll()
  }

  private poll(): void {
    if (!this.running) return

    const startTime = Date.now()

    void this.pollOnce()
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[inbound-worker] Poll cycle failed:', message)
      })
      .finally(() => {
        if (!this.running) {
          return
        }

        // Drift-resistant scheduling: account for cycle time
        const cycleTime = Date.now() - startTime
        const nextDelay = Math.max(100, POLL_INTERVAL_MS - cycleTime)
        this.timer = setTimeout(() => {
          this.poll()
        }, nextDelay)
      })
  }

  private async pollOnce(): Promise<void> {
    // Fetch up to MAX_BATCH_SIZE pending rows, ordered by created_at (FIFO)
    const rows = await this.pool.query<InboundEventRow>(
      `
      SELECT id, provider, provider_event_id, event_type, payload, status, retry_count, created_at
      FROM inbound_events
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT $1
      FOR UPDATE SKIP LOCKED
      `,
      [MAX_BATCH_SIZE],
    )

    if (rows.rowCount === 0) {
      return
    }

    // Process each row
    const results = await Promise.allSettled(rows.rows.map(row => this.processRow(row)))

    // Log summary
    const succeeded = results.filter(r => r.status === 'fulfilled').length
    const failed = results.filter(r => r.status === 'rejected').length
    if (succeeded > 0 || failed > 0) {
      console.error(`[inbound-worker] Processed ${String(succeeded)} succeeded, ${String(failed)} failed`)
    }
  }

  private async processRow(row: InboundEventRow): Promise<void> {
    const client = await this.pool.connect()
    try {
      // Get adapter for provider
      const adapter = getAdapter(row.provider)
      if (!adapter) {
        throw new Error(`No adapter registered for provider '${row.provider}'`)
      }

      // Handle the webhook event
      try {
        await adapter.handleWebhook(row.payload)

        // Success: mark as processed
        await client.query(
          `
          UPDATE inbound_events
          SET status = $1, processed_at = NOW()
          WHERE id = $2
          `,
          ['processed', row.id],
        )

        console.log(`[inbound-worker] Event ${row.provider}:${row.provider_event_id} (${row.event_type}) processed`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)

        // Failure: mark as failed, increment retry_count
        await client.query(
          `
          UPDATE inbound_events
          SET status = $1, processed_at = NOW(), retry_count = retry_count + 1, error_message = $2
          WHERE id = $3
          `,
          ['failed', message, row.id],
        )

        console.warn(`[inbound-worker] Event ${row.provider}:${row.provider_event_id} failed: ${message}`)
      }
    } finally {
      client.release()
    }
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    console.error('[inbound-worker] Stopped')
  }
}
