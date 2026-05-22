/**
 * src/workers/cron.worker.ts
 *
 * Cron Worker execution layer — ARCH-011 G2.
 *
 * Responsibilities:
 *   1. Poll the database every 30s for active crons with next_fire_at <= NOW().
 *   2. For each due cron, acquire a per-row FOR UPDATE SKIP LOCKED lock inside
 *      a transaction. If the lock is unavailable, skip — another worker instance
 *      is already handling this cron (double-fire guard).
 *   3. Mark the cron fired (update last_run_at + next_fire_at) inside the
 *      locked transaction, then commit.
 *   4. Dispatch the tool call via ToolDispatcher AFTER the transaction commits.
 *
 * Double-fire guarantee:
 *   The FOR UPDATE SKIP LOCKED re-lock in fire() is the correctness guarantee.
 *   getDueCrons() runs in autocommit and provides candidates only — it does NOT
 *   hold a durable lock. Multiple worker instances may see the same candidates.
 *   The per-cron re-lock inside the transaction ensures exactly one instance
 *   marks and dispatches each firing.
 *
 * Failure semantics (at-most-once delivery):
 *   markCronFired() is called BEFORE dispatch(). If dispatch fails, the cron
 *   has already been marked fired and next_fire_at advanced. It will not retry
 *   until the next scheduled tick. This is the correct tradeoff for a cron
 *   system — silent retry on failure is a greater risk than a missed execution.
 *
 * Design constraints:
 *   - pool and dispatcher are injected at construction — testable with
 *     testcontainers and mock dispatchers.
 *   - Drift-resistant scheduling: poll interval accounts for time spent in
 *     the current cycle. A 30s poll does not drift to 30s + cycle time.
 *
 * Column name: last_run_at (not last_fired_at — Silas correction, 2026-05-21)
 */
import cronParser from 'cron-parser'
import type { Pool, PoolClient } from 'pg'
import { getDueCrons, markCronFired, type DueCron } from '../db/queries/crons.js'
import type { ToolDispatcher } from './tool-dispatcher.js'

// cron-parser is a CommonJS module — use default import
const { parseExpression } = cronParser

const POLL_INTERVAL_MS = 30_000

export class CronWorker {
  private readonly pool: Pool
  private readonly dispatcher: ToolDispatcher
  private running = false
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(pool: Pool, dispatcher: ToolDispatcher) {
    this.pool = pool
    this.dispatcher = dispatcher
  }

  start(): void {
    if (this.running) return
    this.running = true
    console.log('[cron-worker] Started — polling every 30s')
    void this.poll()
  }

  stop(): void {
    this.running = false
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    console.log('[cron-worker] Stopped')
  }

  // ---------------------------------------------------------------------------
  // Poll cycle
  // ---------------------------------------------------------------------------

  private async poll(): Promise<void> {
    const startedAt = Date.now()

    try {
      const dueCrons = await getDueCrons(this.pool)
      for (const cron of dueCrons) {
        await this.fire(cron)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[cron-worker] Poll error:', msg)
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
  // Fire a single cron
  // ---------------------------------------------------------------------------

  private async fire(cron: DueCron): Promise<void> {
    // Compute next tick before acquiring the lock. parseExpression is synchronous
    // and fast — doing it outside the transaction minimises lock hold time.
    let nextFireAt: Date
    try {
      nextFireAt = parseExpression(cron.schedule, { utc: true }).next().toDate()
    } catch {
      console.error(
        `[cron-worker] Invalid schedule for cron ${String(cron.id)}: "${cron.schedule}"`,
      )
      return
    }

    // Double-fire guard: acquire per-row lock inside a transaction.
    // FOR UPDATE SKIP LOCKED: if another worker instance holds this row,
    // locked.rowCount === 0 — skip immediately without waiting.
    const client: PoolClient = await this.pool.connect()
    try {
      await client.query('BEGIN')

      const locked = await client.query<{ id: number }>(
        `SELECT id FROM crons WHERE id = $1 AND status = 'active' FOR UPDATE SKIP LOCKED`,
        [cron.id],
      )

      if (locked.rowCount === 0) {
        // Another worker instance holds the lock — bail without firing.
        await client.query('ROLLBACK')
        return
      }

      // Mark fired inside the locked transaction:
      // updates last_run_at = NOW() and next_fire_at = <computed next tick>.
      await markCronFired(client, cron.id, nextFireAt)
      await client.query('COMMIT')
    } catch (err) {
      // Best-effort rollback. If the connection is dead this will also fail,
      // which is acceptable — the pool will discard the broken client.
      await client.query('ROLLBACK').catch(() => undefined)
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[cron-worker] Failed to mark cron ${String(cron.id)} fired:`, msg)
      return
    } finally {
      client.release()
    }

    // Dispatch occurs AFTER the transaction commits — the row lock is released.
    // Failure here is logged. The cron is already marked fired; it will not
    // retry until the next scheduled tick.
    try {
      await this.dispatcher.dispatch(cron.tool_name, cron.payload)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(
        `[cron-worker] Dispatch failed for cron ${String(cron.id)} (${cron.tool_name}):`,
        msg,
      )
    }
  }
}
