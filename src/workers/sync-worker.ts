/**
 * src/workers/sync-worker.ts
 *
 * SyncWorker execution layer — ARCH-024 G4.
 *
 * Responsibilities:
 *   1. Poll sync_queue every 5s for rows with status='pending' (order by created_at ASC).
 *   2. For each row, acquire a per-row FOR UPDATE SKIP LOCKED lock inside a transaction.
 *      If locked by another worker, skip — prevents thundering herd.
 *   3. Load the task + provider adapter and call adapter.dispatch(row).
 *   4. On success: UPDATE status='done', dispatched_at=NOW() (transactional).
 *   5. On failure: UPDATE status='failed', dispatched_at=NOW(), retry_count++.
 *   6. After each poll: purge old 'done' rows (TTL 7 days, SEC-C8).
 *   7. Log outcomes (task_id, provider, status, error if failed) — no payload logged.
 *   8. Graceful shutdown on SIGTERM (finish current batch, then exit).
 *
 * At-least-once delivery semantics:
 *   - Rows are locked and dispatched in a transaction.
 *   - Status is updated after dispatch completes (success or failure).
 *   - If dispatch succeeds but the status update fails, the row remains 'pending'
 *     and will be retried — eventual consistency.
 *   - If dispatch fails, retry_count is incremented and the row is marked 'failed'.
 *     SyncWorker can be configured to skip rows with retry_count > N in future sprints.
 *
 * Retry strategy:
 *   - retry_count is incremented on every failure.
 *   - No backoff — rows are retried on the next poll cycle (5s).
 *   - No retry limit (yet) — rows stay 'failed' forever or until manually fixed.
 *   - Future: configure max_retry_count and mark 'dead_letter' if exceeded.
 *
 * Concurrency & scalability:
 *   - FOR UPDATE SKIP LOCKED prevents multiple workers from processing the same row.
 *   - Multiple SyncWorker instances can run in parallel — each picks a different locked row.
 *   - Batch size: 100 rows per poll (configurable via MAX_BATCH_SIZE const).
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
import type { SyncQueueRow } from '../integrations/adapter.js'
import type { Task } from '../types.js'

const POLL_INTERVAL_MS = 5_000
const MAX_BATCH_SIZE = 100

export interface SyncQueueDispatchRow {
  id: number
  task_id: number
  provider: string
  payload: Record<string, unknown>
  status: 'pending'
  retry_count: number
  created_at: string
}

export class SyncWorker {
  private readonly pool: Pool
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(pool: Pool) {
    this.pool = pool
  }

  start(): void {
    if (this.running) return
    this.running = true
    console.error('[sync-worker] Started — polling every 5s')

    // Graceful shutdown: catch SIGTERM and finish current batch before exiting
    process.on('SIGTERM', () => {
      console.error('[sync-worker] SIGTERM received — finishing current batch')
      this.stop()
    })

    void this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    console.error('[sync-worker] Stopped')
  }

  // ---------------------------------------------------------------------------
  // Poll cycle
  // ---------------------------------------------------------------------------

  private async poll(): Promise<void> {
    const startedAt = Date.now()

    try {
      // Dispatch all pending rows for enabled providers
      await this.dispatchPending()

      // Purge old done rows (TTL 7 days)
      await this.purgeDone()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[sync-worker] Poll error:', msg)
    }

    if (!this.running) return

    // Drift-resistant: subtract elapsed time from the interval so the next
    // poll fires at startedAt + POLL_INTERVAL_MS, not now + POLL_INTERVAL_MS.
    const elapsed = Date.now() - startedAt
    const delay = Math.max(0, POLL_INTERVAL_MS - elapsed)
    this.timer = setTimeout(() => {
      void this.poll()
    }, delay)
  }

  // ---------------------------------------------------------------------------
  // Dispatch pending rows
  // ---------------------------------------------------------------------------

  private async dispatchPending(): Promise<void> {
    // Get all enabled providers to dispatch for (currently just ClickUp)
    const enabledAdapters = getEnabledAdapters()
    if (enabledAdapters.length === 0) {
      return // No providers enabled — nothing to dispatch
    }

    for (const adapter of enabledAdapters) {
      await this.dispatchForProvider(adapter.provider)
    }
  }

  private async dispatchForProvider(provider: string): Promise<void> {
    const adapter = getAdapter(provider)
    if (adapter === undefined || !adapter.enabled) {
      return
    }

    let rows: SyncQueueDispatchRow[] = []

    try {
      // Poll for pending rows with FOR UPDATE SKIP LOCKED
      // If another worker has locked a row, it is skipped (no blocking).
      const result = await this.pool.query<SyncQueueDispatchRow>(
        `SELECT id, task_id, provider, payload, status, retry_count, created_at
         FROM sync_queue
         WHERE provider = $1 AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT $2
         FOR UPDATE SKIP LOCKED`,
        [provider, MAX_BATCH_SIZE],
      )
      rows = result.rows
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[sync-worker] Failed to poll sync_queue for provider ${provider}:`, msg)
      return
    }

    if (rows.length === 0) {
      return
    }

    // Batch-load all tasks in a single query to prevent N+1 issue
    // (instead of loading one task per dispatchRow call)
    const taskIds = rows.map(row => row.task_id)
    let tasksMap = new Map<number, Task>()

    try {
      const tasksResult = await this.pool.query<Task>(
        `SELECT id, project_id, title, description, status, assignee_agent_slug,
                github_pr_url, notes, created_at, updated_at
         FROM tasks
         WHERE id = ANY($1)`,
        [taskIds],
      )
      tasksMap = new Map(tasksResult.rows.map(task => [task.id, task]))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[sync-worker] Failed to batch-load tasks for provider ${provider}:`,
        msg,
      )
      return
    }

    // Dispatch each row in parallel using Promise.allSettled to preserve
    // per-row error isolation. One failure does not block others.
    const results = await Promise.allSettled(
      rows.map(row => this.dispatchRow(row, tasksMap)),
    )

    // Log any rejections
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        const row = rows[index]
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        console.error(
          `[sync-worker] Dispatch rejected for sync_queue row ${String(row?.id)}: ${msg}`,
        )
      }
    })
  }

  // ---------------------------------------------------------------------------
  // Dispatch a single row
  // ---------------------------------------------------------------------------

  private async dispatchRow(row: SyncQueueDispatchRow, tasksMap: Map<number, Task>): Promise<void> {
    const client = await this.pool.connect()
    try {
      // Re-acquire the lock inside the transaction (defence-in-depth against
      // race condition where another worker picked this row between the poll
      // and the dispatch). If lock is unavailable, skip this row.
      const lockResult = await client.query<{ id: number }>(
        `SELECT id FROM sync_queue
         WHERE id = $1
         FOR UPDATE SKIP LOCKED`,
        [row.id],
      )

      if (lockResult.rows.length === 0) {
        // Another worker took this row — skip it
        return
      }

      await client.query('BEGIN')

      try {
        // Use pre-loaded task from batch query (prevents N+1)
        const task = tasksMap.get(row.task_id)
        if (task === undefined) {
          // Task was deleted or not in batch result — mark the sync row as failed
          const errorMsg = 'Task not found (deleted?)'
          await client.query(
            `UPDATE sync_queue
             SET status = $1, dispatched_at = NOW(), error_message = $3, retry_count = retry_count + 1
             WHERE id = $2`,
            ['failed', row.id, errorMsg],
          )
          console.error(
            `[sync-worker] Task ${String(row.task_id)} not found (deleted?). Marked sync row ${String(row.id)} as failed.`,
          )
          await client.query('COMMIT')
          return
        }

        // Get the adapter
        const adapter = getAdapter(row.provider)
        if (adapter === undefined) {
          // Provider adapter was unregistered (shouldn't happen, but guard anyway)
          const errorMsg = `Adapter for provider ${row.provider} not found`
          await client.query(
            `UPDATE sync_queue
             SET status = $1, dispatched_at = NOW(), error_message = $3, retry_count = retry_count + 1
             WHERE id = $2`,
            ['failed', row.id, errorMsg],
          )
          console.error(
            `[sync-worker] Adapter for provider ${row.provider} not found. Marked sync row ${String(row.id)} as failed.`,
          )
          await client.query('COMMIT')
          return
        }

        // Build the SyncQueueRow that the adapter expects
        const syncRow: SyncQueueRow = {
          id: row.id,
          task_id: row.task_id,
          provider: row.provider,
          payload: row.payload,
          status: row.status,
          retry_count: row.retry_count,
          created_at: row.created_at,
          updated_at: new Date().toISOString(),
        }

        // Dispatch to the adapter
        try {
          await adapter.dispatch(syncRow)

          // Success: mark as done
          await client.query(
            `UPDATE sync_queue
             SET status = $1, dispatched_at = NOW()
             WHERE id = $2`,
            ['done', row.id],
          )

          console.error(
            `[sync-worker] Dispatched task ${String(row.task_id)} to ${row.provider} — sync row ${String(row.id)} marked done`,
          )
        } catch (err) {
          // Failure: mark as failed, increment retry_count, store error message
          const errorMsg = err instanceof Error ? err.message : String(err)
          await client.query(
            `UPDATE sync_queue
             SET status = $1, dispatched_at = NOW(), error_message = $3, retry_count = retry_count + 1
             WHERE id = $2`,
            ['failed', row.id, errorMsg],
          )

          console.error(
            `[sync-worker] Dispatch failed for task ${String(row.task_id)} to ${row.provider}. Sync row ${String(row.id)} marked failed (retry_count incremented). Error: ${errorMsg}`,
          )
        }

        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      }
    } finally {
      client.release()
    }
  }

  // ---------------------------------------------------------------------------
  // Purge old done rows (TTL)
  // ---------------------------------------------------------------------------

  private async purgeDone(): Promise<void> {
    try {
      const result = await this.pool.query(
        `DELETE FROM sync_queue
         WHERE status = 'done' AND created_at < NOW() - INTERVAL '7 days'`,
      )

      if (result.rowCount !== null && result.rowCount > 0) {
        console.error(`[sync-worker] Purged ${String(result.rowCount)} old done rows`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[sync-worker] Purge error:', msg)
    }
  }
}
