/**
 * src/workers/index.ts
 *
 * Worker startup utilities (ARCH-011, ARCH-024).
 *
 * Exports:
 *   - startSyncWorker(pool, interval?) — Start the SyncWorker
 *   - startCronWorker(pool, dispatcher) — Start the CronWorker
 *
 * Usage (squad-api main.ts, after database connected):
 *   import { startSyncWorker } from './workers/index.js'
 *   import { pool } from './db/client.js'
 *   ...
 *   const stopSyncWorker = startSyncWorker(pool)
 */

import { pool as defaultPool } from '../db/client.js'
import { SyncWorker } from './sync-worker.js'
import { CronWorker } from './cron.worker.js'
import type { Pool } from 'pg'
import type { ToolDispatcher } from './tool-dispatcher.js'

/**
 * Start the SyncWorker background process.
 *
 * Returns a stop function that can be called to gracefully shutdown the worker.
 * The worker will finish its current batch before stopping.
 *
 * @param pool — Database pool (optional, defaults to src/db/client.js pool)
 * @param interval — Poll interval in ms (optional, defaults to 5000ms)
 * @returns A function that stops the worker
 */
export function startSyncWorker(pool: Pool = defaultPool, interval?: number): () => void {
  const worker = new SyncWorker(pool)

  // If a custom interval is provided, we'd need to extend SyncWorker to accept it.
  // For now, interval is fixed at 5000ms in the SyncWorker class constant.
  // Future: make POLL_INTERVAL_MS configurable.
  if (interval !== undefined && interval !== 5000) {
    console.warn('[sync-worker] Custom interval provided but not yet supported — using 5000ms')
  }

  worker.start()

  return () => {
    worker.stop()
  }
}

/**
 * Start the CronWorker background process.
 *
 * Returns a stop function that can be called to gracefully shutdown the worker.
 *
 * @param pool — Database pool
 * @param dispatcher — ToolDispatcher for executing cron handlers
 * @returns A function that stops the worker
 */
export function startCronWorker(pool: Pool, dispatcher: ToolDispatcher): () => void {
  const worker = new CronWorker(pool, dispatcher)
  worker.start()
  return () => {
    worker.stop()
  }
}
